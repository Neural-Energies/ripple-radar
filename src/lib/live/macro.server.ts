import { loadHlwRstar } from "./macro-hlw.ts";
import { volRead, type VolRead } from "./vol-regime.ts";
import { conflictGap, taylorRule } from "./macro-models.ts";
import {
  cfnaiStatus,
  curveStatus,
  nberDuring,
  sahmStatus,
  stressStatus,
} from "./macro-monitors.ts";
import {
  basketRegime,
  directionOf,
  lastOfMonth,
  legPath,
  parseFredCsv,
  QUAD_NAME,
  yearOverYear,
  type Quad,
} from "./macro-regime.ts";

const GROWTH = [
  { id: "INDPRO", label: "Industrial production" },
  { id: "PAYEMS", label: "Payrolls" },
  { id: "RRSFS", label: "Real retail sales" },
  { id: "HOUST", label: "Housing starts" },
  { id: "ICSA", label: "Claims, flipped", invert: true },
] as const;

const INFLATION = [
  { id: "CPIAUCSL", label: "CPI" },
  { id: "CPILFESL", label: "Core CPI" },
  { id: "PPIACO", label: "PPI" },
  { id: "DCOILWTICO", label: "WTI" },
  { id: "T10YIE", label: "10y breakeven" },
] as const;

const POLICY = [
  { id: "FEDFUNDS", label: "Fed funds", unit: "%" },
  { id: "T10Y2Y", label: "10y–2y", unit: "pp" },
  { id: "VIXCLS", label: "VIX", unit: "" },
  { id: "BAA10Y", label: "Baa spread", unit: "pp" },
] as const;

export type MacroLeg = {
  id: string;
  label: string;
  side: "growth" | "inflation";
  yoy: number;
  level: number;
  delta: number;
  direction: string;
};

export type MacroRead = {
  status: "ok" | "unavailable";
  detail: string;
  quad?: Quad;
  name?: string;
  date?: string;
  growth?: { yoy: number; delta: number; direction: string; up: number; n: number };
  inflation?: { yoy: number; delta: number; direction: string; up: number; n: number };
  legs?: MacroLeg[];
  path?: { date: string; quad: Quad }[];
  prints?: { id: string; label: string; date: string; value: number; unit: string }[];
  sahm?: {
    value: number;
    date: string;
    tripped: boolean;
    gap: number;
    lastTrip?: { start: string; end: string; peak: number; nber: boolean };
  };
  cfnai?: { value: number; date: string; tripped: boolean; gap: number };
  recessionProbability?: { value: number; date: string };
  stress?: { value: number; date: string; aboveAverage: boolean };
  curve?: { value: number; date: string; inverted: boolean; lastNegative?: string };
  policyRule?: {
    date: string;
    funds: number;
    rule: number;
    stance: number;
    inflation: number;
    unemployment: number;
    nairu: number;
    rStar: number;
    rStarDate: string;
    gap: number;
  };
  conflict?: {
    date: string;
    wageYoy: number;
    priceYoy: number;
    real: number;
    wageDelta: number;
    priceDelta: number;
  };
  vol?: VolRead;
};

const TTL_MS = 30 * 60 * 1000;
let cache: { at: number; read: MacroRead } | null = null;

async function fredCsv(id: string): Promise<string> {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, {
    headers: { "User-Agent": "AlphaRecon", Accept: "text/csv" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`FRED ${id} ${res.status}`);
  return res.text();
}

async function loadCsv(id: string): Promise<ReturnType<typeof parseFredCsv>> {
  try {
    return parseFredCsv(await fredCsv(id));
  } catch {
    return [];
  }
}

function monitors(points: Record<string, { date: string; value: number }[]>): Pick<
  MacroRead,
  "sahm" | "cfnai" | "recessionProbability" | "stress" | "curve"
> {
  const sahm = sahmStatus(points.SAHMREALTIME ?? []);
  const cfnai = cfnaiStatus(points.CFNAIMA3 ?? []);
  const stress = stressStatus(points.STLFSI4 ?? []);
  const curve = curveStatus(points.T10Y3M ?? []);
  const probability = points.RECPROUSM156N?.at(-1);
  const trip = sahm?.lastTrip;
  return {
    ...(sahm
      ? {
          sahm: {
            value: sahm.value,
            date: sahm.date,
            tripped: sahm.tripped,
            gap: sahm.gap,
            ...(trip
              ? {
                  lastTrip: {
                    start: trip.start,
                    end: trip.end,
                    peak: trip.peak,
                    nber: nberDuring(points.USREC ?? [], trip.start, trip.end),
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(cfnai ? { cfnai } : {}),
    ...(probability ? { recessionProbability: { value: probability.value, date: probability.date } } : {}),
    ...(stress ? { stress } : {}),
    ...(curve ? { curve } : {}),
  };
}

function onOrBefore(points: { date: string; value: number }[], date: string) {
  let best: { date: string; value: number } | undefined;
  for (const point of points) {
    if (point.date <= date && (!best || point.date > best.date)) best = point;
  }
  return best;
}

function volFields(points: Record<string, { date: string; value: number }[]>): Pick<MacroRead, "vol"> {
  const vol = volRead(points.VIXCLS ?? [], points.VXVCLS ?? [], points.SP500 ?? []);
  return vol ? { vol } : {};
}

async function liveModels(points: Record<string, { date: string; value: number }[]>): Promise<
  Pick<MacroRead, "policyRule" | "conflict">
> {
  const out: Pick<MacroRead, "policyRule" | "conflict"> = {};
  const inflation = yearOverYear(lastOfMonth(points.PCEPILFE ?? [])).at(-1);
  const funds = inflation ? onOrBefore(points.FEDFUNDS ?? [], inflation.date) : undefined;
  const unemployment = inflation ? onOrBefore(points.UNRATE ?? [], inflation.date) : undefined;
  const nairu = inflation ? onOrBefore(points.NROU ?? [], inflation.date) : undefined;
  let rstar: { value: number; date: string } | null = null;
  try {
    rstar = await loadHlwRstar();
  } catch {
    rstar = null;
  }
  if (inflation && funds && unemployment && nairu && rstar && rstar.date <= inflation.date) {
    const rule = taylorRule({
      funds: funds.value,
      inflation: inflation.rate,
      unemployment: unemployment.value,
      nairu: nairu.value,
      rStar: rstar.value,
    });
    out.policyRule = {
      date: inflation.date,
      funds: funds.value,
      rule: rule.rule,
      stance: rule.stance,
      inflation: inflation.rate,
      unemployment: unemployment.value,
      nairu: nairu.value,
      rStar: rstar.value,
      rStarDate: rstar.date,
      gap: rule.gap,
    };
  }

  const wages = legPath(points.CES0500000003 ?? []);
  const prices = legPath(points.CPIAUCSL ?? []);
  const wage = wages.at(-1);
  const price = wage ? prices.find((row) => row.date === wage.date) : undefined;
  if (wage && price) {
    out.conflict = {
      date: wage.date,
      wageYoy: wage.rate,
      priceYoy: price.rate,
      real: conflictGap(wage.rate, price.rate),
      wageDelta: wage.delta,
      priceDelta: price.delta,
    };
  }
  return out;
}

export async function loadMacroRegime(): Promise<MacroRead> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.read;
  try {
    const extra = ["SAHMREALTIME", "CFNAIMA3", "RECPROUSM156N", "STLFSI4", "T10Y3M", "USREC", "UNRATE", "NROU", "CES0500000003", "PCEPILFE", "VXVCLS", "SP500"] as const;
    const ids = [...GROWTH.map((s) => s.id), ...INFLATION.map((s) => s.id), ...POLICY.map((s) => s.id), ...extra];
    const loaded = await Promise.all(ids.map((id) => loadCsv(id)));
    const points = Object.fromEntries(ids.map((id, i) => [id, loaded[i] ?? []]));

    const growthPaths = GROWTH.map((s) => legPath(points[s.id] ?? [], "invert" in s && s.invert));
    const inflationPaths = INFLATION.map((s) => legPath(points[s.id] ?? []));
    const regime = basketRegime(growthPaths, inflationPaths);
    if (!regime) {
      return {
        status: "unavailable",
        detail: "FRED did not return enough history to score the baskets.",
      };
    }

    const legs: MacroLeg[] = [];
    const pushLeg = (
      side: "growth" | "inflation",
      spec: { id: string; label: string },
      path: { date: string; rate: number; delta: number }[],
    ) => {
      const onDate = path.find((row) => row.date === regime.date);
      const level = lastOfMonth(points[spec.id] ?? []).find((row) => row.date === regime.date)?.value;
      if (!onDate || level == null) return;
      legs.push({
        id: spec.id,
        label: spec.label,
        side,
        yoy: onDate.rate,
        level,
        delta: onDate.delta,
        direction: directionOf(onDate.delta),
      });
    };
    GROWTH.forEach((spec, i) => pushLeg("growth", spec, growthPaths[i] ?? []));
    INFLATION.forEach((spec, i) => pushLeg("inflation", spec, inflationPaths[i] ?? []));

    const yoyOf = (side: "growth" | "inflation") => {
      const rows = legs.filter((leg) => leg.side === side).map((leg) => leg.yoy);
      if (!rows.length) return 0;
      const sorted = [...rows].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)]!;
    };

    const prints = POLICY.map((spec) => {
      const last = points[spec.id]?.at(-1);
      if (!last) return null;
      return { id: spec.id, label: spec.label, date: last.date, value: last.value, unit: spec.unit };
    }).filter((row): row is NonNullable<typeof row> => row != null);

    const read: MacroRead = {
      status: "ok",
      detail:
        "Equal-weight FRED basket. A leg is accelerating when its year-over-year rate is higher than three months ago. Claims are flipped. Not a proprietary nowcast.",
      quad: regime.quad,
      name: QUAD_NAME[regime.quad],
      date: regime.date,
      growth: {
        yoy: yoyOf("growth"),
        delta: regime.growth.median,
        direction: regime.growth.direction,
        up: regime.growth.up,
        n: regime.growth.n,
      },
      inflation: {
        yoy: yoyOf("inflation"),
        delta: regime.inflation.median,
        direction: regime.inflation.direction,
        up: regime.inflation.up,
        n: regime.inflation.n,
      },
      legs,
      path: regime.path.slice(-36),
      prints,
      ...monitors(points),
      ...(await liveModels(points)),
      ...volFields(points),
    };
    cache = { at: Date.now(), read };
    return read;
  } catch (err) {
    return {
      status: "unavailable",
      detail: err instanceof Error ? err.message : "FRED did not answer.",
    };
  }
}
