import type {
  ExpectedEvidence,
  ForecastSnapshot,
  GameTheory,
  HorizonProbability,
  KnowledgeItem,
  ResearchQuestion,
  Scenario,
} from "@/data/types";
import type { EventFamily } from "./extract";
import type { Tag } from "./ontology";

type TapeTone = "up" | "down" | "neutral";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function cell(label: string, a: number, b: number) {
  return { label, a, b };
}

function auditOf(p: number, evidence: string, tone: TapeTone): Scenario["audit"] {
  return {
    previous: p,
    updated: p,
    evidence,
    direction: tone === "down" ? "down" : "up",
    weight: 1,
    affectedNodes: [],
    rescoredAssets: [],
  };
}

function normalize(rows: Omit<Scenario, "audit" | "prevProbability">[], tone: TapeTone, evidence: string): Scenario[] {
  const sum = rows.reduce((a, s) => a + s.probability, 0) || 1;
  return rows.map((s) => {
    const p = Math.round((s.probability / sum) * 100);
    return { ...s, probability: p, prevProbability: p, audit: auditOf(p, evidence, tone) };
  });
}

export function scenariosFor(opts: {
  entity: string;
  tags: Tag[];
  family: EventFamily;
  tone: TapeTone;
  hits: number;
  esc: number;
  de: number;
}): Scenario[] {
  const label = opts.entity || opts.tags[0] || "the development";
  const material = clamp(16 + opts.esc * 6 + opts.hits * 2 - opts.de * 4, 8, 42);
  const partial = clamp(26 + opts.hits * 2, 14, 44);
  const noise = clamp(24 - opts.esc * 3 + opts.de * 4, 8, 40);
  const fade = clamp(100 - material - partial - noise, 6, 36);
  const evidence = `${opts.hits} live items. Tone ${opts.tone}.`;
  const first = opts.tags[0] ?? "the first-order print";

  const byFamily: Record<EventFamily, Omit<Scenario, "audit" | "prevProbability">[]> = {
    physical: [
      { id: "s1", name: `Binding physical constraint from ${label}`, detail: "Throughput, insurance, or hulls actually ration. First print is confirmation, not the book.", probability: material, range: "Hours → two quarters", keyOutcomes: `Crowded ${first}; bottleneck still open` },
      { id: "s2", name: `Harassment / delays, throughput mostly holds`, detail: "Premia and tonne-miles move; molecules still move.", probability: partial, range: "Sessions → weeks", keyOutcomes: "Spreads > directional headline" },
      { id: "s3", name: "Insurance / narrative premium only", detail: "No binding node. The tape fades the first print.", probability: noise, range: "Same session → days", keyOutcomes: "AIS, inventories, or the next print invalidate" },
      { id: "s4", name: `${label} eases / spare capacity offsets`, detail: "Talks, SPR, exemption, or spare barrels kill the thesis.", probability: fade, range: "Days → weeks", keyOutcomes: "Unwind the crowded name first" },
    ],
    policy: [
      { id: "s1", name: `Hawkish surprise vs ${label}`, detail: "Path re-prices higher. Duration and high-beta are the first machines.", probability: material, range: "Minutes → weeks", keyOutcomes: "Curve, USD, financial conditions" },
      { id: "s2", name: "Hold with hawkish guidance", detail: "No move, tighter reaction function. The dots do the work.", probability: partial, range: "Minutes → a quarter", keyOutcomes: "Front-end vs long-end split" },
      { id: "s3", name: "On-consensus print", detail: "The statement matches the board. Fade the event-vol.", probability: noise, range: "Same session", keyOutcomes: "Vol crush; no new path" },
      { id: "s4", name: "Dovish surprise / offset", detail: "Cut, pause language, or a liquidity backstop.", probability: fade, range: "Minutes → weeks", keyOutcomes: "Duration bid; fade the hawkish names" },
    ],
    credit: [
      { id: "s1", name: `Funding run / contagion from ${label}`, detail: "Uninsured deposits and AFS holes transmit. KRE is the crowded print.", probability: material, range: "Hours → weeks", keyOutcomes: "Regionals, credit, small-cap beta" },
      { id: "s2", name: "Contained recap / ring-fence", detail: "One name, a facility, no system event.", probability: partial, range: "Days", keyOutcomes: "Single-name > index" },
      { id: "s3", name: "Forced merger / resolution", detail: "Weekend deal. Equity wiped, deposits migrate.", probability: noise, range: "Days → weeks", keyOutcomes: "Acquirer vs failed name" },
      { id: "s4", name: "Policy backstop inside the horizon", detail: "Guarantee, window, or BTFP-like tool arrives.", probability: fade, range: "Days", keyOutcomes: "Short the panic, not the solvency" },
    ],
    tech: [
      { id: "s1", name: `Binding restriction on ${label}`, detail: "Licenses, foundry, or midstream actually ration.", probability: material, range: "Weeks → quarters", keyOutcomes: "The bottleneck, not the headline chip" },
      { id: "s2", name: "Quota / delay, workaround exists", detail: "Substitution and inventory stretch the lag.", probability: partial, range: "Weeks → quarters", keyOutcomes: "Second-source and inventory names" },
      { id: "s3", name: "Headline without a binding node", detail: "Speech, draft, or leak. No rule in force.", probability: noise, range: "Days", keyOutcomes: "Mean-revert the first ticker" },
      { id: "s4", name: "Exemption / reverse", detail: "Carve-out, license grant, or diplomatic unwind.", probability: fade, range: "Weeks", keyOutcomes: "Unwind crowded restriction trades" },
    ],
    fx: [
      { id: "s1", name: `Successful official intervention in ${label}`, detail: "The print sticks. Path, not a one-print fade.", probability: material, range: "Minutes → weeks", keyOutcomes: "Spot, vol, then correlated duration" },
      { id: "s2", name: "Failed / repeat intervention", detail: "One print, then the trend resumes. Options > spot.", probability: partial, range: "Hours → days", keyOutcomes: "Vol stays bid" },
      { id: "s3", name: "Verbal only — no follow-through", detail: "Talks, no size. Fade.", probability: fade, range: "Same session", keyOutcomes: "Spot mean-reverts" },
    ],
    weather: [
      { id: "s1", name: `Catastrophic landfall / outage from ${label}`, detail: "Plants, ports, or grids actually stop.", probability: material, range: "Hours → weeks", keyOutcomes: "Power, refined product, ag" },
      { id: "s2", name: "Glancing blow — delays, not destruction", detail: "Premia, then fade if AIS and outages stay modest.", probability: partial, range: "Days", keyOutcomes: "Crack / freight over directional" },
      { id: "s3", name: "Miss / recurve", detail: "The cone is wrong. Unwind.", probability: fade, range: "Hours → days", keyOutcomes: "Event-vol crush" },
    ],
    kinetic: [
      { id: "s1", name: `Sustained kinetic / blockade path for ${label}`, detail: "Capability plus willingness. Insurance and hulls ration first.", probability: material, range: "Hours → quarters", keyOutcomes: "Haven, defense, physical bottleneck" },
      { id: "s2", name: "Probe / gray-zone, no rupture", detail: "Drills, harassment, signaling. The market overfits the first print.", probability: partial, range: "Days → weeks", keyOutcomes: "Spreads and vol > directional" },
      { id: "s3", name: "De-escalation / talks", detail: "Off-ramp. Unwind the crowded haven and first-order names.", probability: fade, range: "Days", keyOutcomes: "Keep optionality on the bottleneck" },
    ],
    corporate: [
      { id: "s1", name: `Material restatement / failure of ${label}`, detail: "Earnings, fraud, or going-concern. Credit first.", probability: material, range: "Hours → weeks", keyOutcomes: "Single-name, then sector" },
      { id: "s2", name: "Contained — one name, no sector", detail: "Idiosyncratic. Fade the basket.", probability: partial, range: "Days", keyOutcomes: "Name vs peers" },
      { id: "s3", name: "Noise / rumor", detail: "No filing, no print. Invalidation is the 8-K that never comes.", probability: fade, range: "Same session", keyOutcomes: "Mean-revert" },
    ],
    commodity: [
      { id: "s1", name: `Binding supply loss in ${label}`, detail: "The tonne or the barrel is missing.", probability: material, range: "Hours → quarters", keyOutcomes: "Curve, then equities" },
      { id: "s2", name: "Temporary disruption", detail: "Force majeure that repairs.", probability: partial, range: "Days → weeks", keyOutcomes: "Calendar spreads" },
      { id: "s3", name: "Demand scare, not supply", detail: "The other side of the book. Don't confuse them.", probability: noise, range: "Days", keyOutcomes: "Industrial vs the commodity" },
      { id: "s4", name: "Offset / spare capacity", detail: "Someone else fills the hole.", probability: fade, range: "Weeks", keyOutcomes: "Unwind" },
    ],
    other: [
      { id: "s1", name: `Sustained materialization of ${label}`, detail: "The causal path keeps transmitting.", probability: material, range: "Days → quarters", keyOutcomes: "First-order crowded; second-order open" },
      { id: "s2", name: `Partial / contained ${label}`, detail: "A one-session print. Constraint mostly holds.", probability: partial, range: "Days → weeks", keyOutcomes: "Spreads > directional" },
      { id: "s3", name: `${label} fades / is reversed`, detail: "Talks, spare capacity, or a policy offset.", probability: fade, range: "Days", keyOutcomes: "Unwind the crowded name" },
    ],
  };

  return normalize(byFamily[opts.family] ?? byFamily.other, opts.tone, evidence);
}

export function gameTheoryFor(opts: {
  family: EventFamily;
  players: GameTheory["players"];
}): GameTheory {
  const actor = opts.players[0]?.name ?? "Primary actor";
  const counterpart = opts.players[1]?.name ?? "Counterpart";
  const insightFor: Record<EventFamily, string> = {
    physical: `${actor} rarely wants the tail — they want ${counterpart} and the market to do the rationing. Rank the bottleneck, not the first print.`,
    policy: `The product is the reaction function, not the meeting. ${actor} vs ${counterpart} is a path fight.`,
    credit: `${actor} wants time. ${counterpart} wants not to be next. The backstop is an outside option, not a given.`,
    tech: `Licenses and wafers, not speeches. ${actor} can delay; ${counterpart} can substitute — slowly.`,
    fx: `Official FX is a print, then a path. ${actor} has size; ${counterpart} has the trend.`,
    weather: `The cone is not the outage. ${actor} is the storm; ${counterpart} is spare capacity and logistics.`,
    kinetic: `${actor} wants leverage without the war they cannot finish. ${counterpart} wants deterrence without a rupture.`,
    corporate: `${actor} wants survival optionality. ${counterpart} (creditors, peers, the tape) prices the hole.`,
    commodity: `The tonne confirms the story. ${actor} controls supply; ${counterpart} is demand and inventories.`,
    other: `${actor} wants optionality without a catastrophic own-goal. Rank what they can actually change.`,
  };

  const matrices: Record<EventFamily, Pick<GameTheory, "columns" | "rows">> = {
    physical: {
      columns: ["Hold throughput", "Bargain", "Ration / force"],
      rows: [
        { name: "Escalate", cells: [cell("Max leverage, self-harm", 3, -3), cell("Cash for de-escalation", 2, -1), cell("Rupture risk", 1, -4)] },
        { name: "Probe / delay", cells: [cell("Sustainable pressure", 4, -2), cell("Incremental deal", 2, 0), cell("Escalation lottery", 0, -3)] },
        { name: "Stand down", cells: [cell("Status quo", 1, 1), cell("Loss of leverage", -2, 1), cell("Deterrence holds", 0, 2)] },
      ],
    },
    policy: {
      columns: ["Market prices ease", "Market prices hold", "Market prices tighten"],
      rows: [
        { name: "Ease", cells: [cell("Delivered cut", 3, 2), cell("Behind the curve", 1, 0), cell("Financial-conditions fight", -1, -2)] },
        { name: "Hold", cells: [cell("Hawkish hold works", 2, -1), cell("On-consensus", 1, 1), cell("Tightening by inaction", 0, -2)] },
        { name: "Hike / tighten", cells: [cell("Overkill if market eased", -2, 2), cell("Re-anchor", 2, -1), cell("Hard landing risk", -1, -3)] },
      ],
    },
    credit: {
      columns: ["Depositor stay", "Slow run", "Fast run"],
      rows: [
        { name: "Raise / recap", cells: [cell("Survive, dilute", 2, 1), cell("Buy time", 1, 0), cell("Too late", -3, -2)] },
        { name: "Seek merger", cells: [cell("Optional", 1, 1), cell("Weekend deal", 0, 1), cell("Forced, equity zero", -4, 2)] },
        { name: "Wait for backstop", cells: [cell("Free option", 3, 0), cell("Moral hazard tax", 1, -1), cell("If it does not arrive", -5, -3)] },
      ],
    },
    tech: {
      columns: ["Comply / substitute", "Lobby / delay", "Retaliate"],
      rows: [
        { name: "Restrict", cells: [cell("Binding, slow", 3, -2), cell("Quota theater", 1, 0), cell("Tit-for-tat", 0, -3)] },
        { name: "License / quota", cells: [cell("Ration without rupture", 4, -1), cell("Workaround race", 2, 1), cell("Leakage", 0, 1)] },
        { name: "Exempt", cells: [cell("Lost leverage", -2, 2), cell("Carve-out politics", 0, 1), cell("Status quo", 1, 2)] },
      ],
    },
    fx: {
      columns: ["Fade the print", "Follow", "Add size"],
      rows: [
        { name: "Verbal", cells: [cell("Cheap talk", 0, 1), cell("One-print bounce", 1, 0), cell("Credibility burn", -2, 2)] },
        { name: "Sterilized print", cells: [cell("Spot jumps, fades", 2, 0), cell("Path changes", 3, -1), cell("Trend fights back", 0, -2)] },
        { name: "Unsterilized / repeat", cells: [cell("Overkill", 1, -1), cell("Regime change", 4, -3), cell("Reserve burn", -1, -2)] },
      ],
    },
    weather: {
      columns: ["Spare capacity holds", "Local outage", "Regional halt"],
      rows: [
        { name: "Landfall cat", cells: [cell("Overfit", -1, 2), cell("Cracks / power", 3, -2), cell("System event", 4, -4)] },
        { name: "Glancing", cells: [cell("Premia fade", 1, 1), cell("Delays paid", 2, -1), cell("Lucky miss vs model", 0, -2)] },
        { name: "Miss", cells: [cell("Vol crush", -2, 2), cell("Inventory rebuild", 0, 1), cell("False alarm", -3, 2)] },
      ],
    },
    kinetic: {
      columns: ["Contain / hold", "Bargain", "Force"],
      rows: [
        { name: "Escalate", cells: [cell("Max leverage, self-harm", 3, -3), cell("Cash for off-ramp", 2, -1), cell("War / rupture", 1, -4)] },
        { name: "Probe", cells: [cell("Sustainable pressure", 4, -2), cell("Incremental deal", 2, 0), cell("Escalation lottery", 0, -3)] },
        { name: "Stand down", cells: [cell("Status quo", 1, 1), cell("Loss of leverage", -2, 1), cell("Deterrence holds", 0, 2)] },
      ],
    },
    corporate: {
      columns: ["Creditors stay calm", "Demand recap", "Accelerate claims"],
      rows: [
        { name: "Disclose / recap", cells: [cell("Survive", 2, 1), cell("Dilution tax", 0, 1), cell("Too late", -3, -1)] },
        { name: "Deny / delay", cells: [cell("Optional", 1, 0), cell("Trust tax", -1, 1), cell("Run", -4, -2)] },
        { name: "Sell / merge", cells: [cell("Optional exit", 2, 2), cell("Weekend deal", 0, 2), cell("Fire sale", -2, 3)] },
      ],
    },
    commodity: {
      columns: ["Inventories absorb", "Tight but flowing", "Physical ration"],
      rows: [
        { name: "Outage persists", cells: [cell("Overfit", 0, 1), cell("Curve pays", 3, -2), cell("Squeeze", 4, -4)] },
        { name: "Repair path", cells: [cell("Fade the spike", 1, 1), cell("Spreads", 2, 0), cell("False all-clear", -1, -2)] },
        { name: "Spare fills", cells: [cell("Thesis dead", -2, 2), cell("Partial offset", 0, 1), cell("Who fills?", 1, -1)] },
      ],
    },
    other: {
      columns: ["Contain", "Bargain", "Force"],
      rows: [
        { name: "Press", cells: [cell("Leverage", 3, -2), cell("Deal", 2, 0), cell("Tail", 0, -3)] },
        { name: "Wait", cells: [cell("Option value", 2, -1), cell("Drift", 1, 1), cell("Overrun", -2, -2)] },
        { name: "Concede", cells: [cell("Status quo", 1, 1), cell("Lost leverage", -2, 2), cell("Peace", 0, 2)] },
      ],
    },
  };

  const m = matrices[opts.family] ?? matrices.other;
  return {
    actor,
    counterpart,
    columns: m.columns,
    rows: m.rows,
    insight: insightFor[opts.family],
    players: opts.players,
  };
}

export function playersFor(entities: string[], tags: Tag[], family: EventFamily): GameTheory["players"] {
  const names = entities.slice(0, 3);
  if (!names.length) names.push(tags[0] ? `${tags[0]} actor` : "Primary actor");
  if (names.length === 1) names.push(family === "policy" ? "Market / path" : "Counterpart / policy");
  names.push("Market / positioning");
  const uniq = [...new Set(names)].slice(0, 4);
  return uniq.map((name, i) => {
    if (i === uniq.length - 1) {
      return {
        name,
        objective: "Be paid for the constraint, not the headline",
        incentives: "Crowd the first print, underown the bottleneck",
        constraints: "Liquidity, positioning, and the next data print",
        moves: ["Chase headline", "Fade", "Rotate to distance 2–3"],
        batna: "Flat; wait for confirmation",
      };
    }
    return {
      name,
      objective: "Change the outcome at acceptable cost",
      incentives: incentiveOf(name, tags, family),
      constraints: "Capability, coalitions, cash, time",
      moves: movesOf(family),
      batna: "Outside option: delay, substitute, or accept the status quo",
    };
  });
}

function incentiveOf(name: string, tags: Tag[], family: EventFamily) {
  if (family === "policy") return "Inflation vs growth vs financial stability";
  if (family === "credit") return "Survival, franchise, not being next";
  if (family === "tech") return "Capacity, licenses, and national compute";
  if (family === "fx") return "Path of the currency vs imported inflation / reserves";
  if (family === "physical" || tags.includes("energy")) return "Revenue, leverage, and not losing customers forever";
  return `${name} wants optionality without a catastrophic own-goal`;
}

function movesOf(family: EventFamily): string[] {
  if (family === "policy") return ["Ease", "Hold / guide", "Tighten"];
  if (family === "credit") return ["Recap", "Merge", "Wait for backstop"];
  if (family === "fx") return ["Verbal", "Sterilized print", "Repeat / size"];
  if (family === "tech") return ["Restrict", "Quota", "Exempt"];
  return ["Escalate", "Probe / delay", "Stand down / deal"];
}

export function horizonsFor(family: EventFamily, probability: number, scenarios: Scenario[]): HorizonProbability[] {
  const top = scenarios[0];
  const fade = scenarios.find((s) => /fade|reverse|miss|exempt|backstop|dovish|verbal/i.test(s.name));
  const short = clamp(Math.round(probability * 0.55 + (fade?.probability ?? 20) * 0.25), 6, 70);
  const mid = clamp(Math.round(probability * 0.9), 8, 82);
  const longH = clamp(Math.round((top?.probability ?? probability) * 1.05), 8, 86);
  const unit = family === "policy" || family === "fx" ? "minutes–days" : family === "weather" ? "hours–days" : "days–weeks";
  return [
    { horizon: family === "policy" || family === "fx" ? "24h" : "7d", probability: short, note: `Near-term print. ${unit}.` },
    { horizon: family === "tech" ? "90d" : "30d", probability: mid, note: "Whether the constraint is still binding." },
    { horizon: family === "tech" || family === "kinetic" ? "12m" : "2q", probability: longH, note: "Capex, policy, and second-order transmission." },
  ];
}

export function expectedEvidenceFor(scenarios: Scenario[], headlineTicker: string, family: EventFamily): ExpectedEvidence[] {
  const lag = family === "policy" || family === "fx" ? "minutes–hours" : family === "weather" ? "hours–days" : "1–10 sessions";
  return scenarios.slice(0, 4).map((s, i) => ({
    id: `ee-${s.id}`,
    scenarioId: s.id,
    ifTrue: s.name,
    observe:
      i === 0
        ? `${headlineTicker} holds the move AND a second-order node confirms (freight, cracks, funding, or licenses).`
        : i === 1
          ? `Spreads/vol move more than the headline ticker; physical or policy throughput mostly holds.`
          : `The first print mean-reverts; AIS, inventories, filings, or the next official print contradict the thesis.`,
    lag,
    appeared: false,
  }));
}

export function knowledgeFor(opts: {
  claims: { text: string }[];
  entity: string;
  headlineTicker: string;
  family: EventFamily;
  hits: number;
}): KnowledgeItem[] {
  const known = opts.claims[0]?.text ?? `Tape is clustering around ${opts.entity}.`;
  return [
    { kind: "known", text: known, value: "high" },
    { kind: "likely", text: `${opts.headlineTicker} is the crowded first print for this family (${opts.family}).`, value: "medium" },
    { kind: "uncertain", text: `Whether the constraint is physical/policy or only narrative. ${opts.hits} items is not proof.`, value: "high" },
    { kind: "unknown", text: `Who controls the next material move, and on what lag.`, value: "high" },
    { kind: "critical", text: `The observable that would most change scenario probabilities — the binding node, not the speech.`, value: "critical" },
  ];
}

export function questionsFor(opts: {
  entity: string;
  actor: string;
  counterpart: string;
  headlineTicker: string;
  nextTicker?: string;
  invalidation: string;
}): ResearchQuestion[] {
  return [
    { q: `What would have to be true for sustained ${opts.entity}?`, value: "critical", unknown: "The binding physical or policy constraint, not the speech." },
    { q: `Which actor controls the next material move — ${opts.actor} or ${opts.counterpart}?`, value: "high", unknown: "Capability vs willingness." },
    { q: `If the thesis is correct, which market prints after ${opts.headlineTicker}?`, value: "high", unknown: opts.nextTicker ? `${opts.nextTicker} or the next tagged bottleneck.` : "A second-order ticker on this graph." },
    { q: "What observable would invalidate the first causal edge this session?", value: "critical", unknown: opts.invalidation },
  ];
}

export function snapshotOf(probability: number, importance: number, scenarios: Scenario[], evidence: string, at: string): ForecastSnapshot {
  const top = [...scenarios].sort((a, b) => b.probability - a.probability)[0];
  return {
    at,
    probability,
    importance,
    scenarioTop: top ? `${top.name} ${top.probability}%` : "—",
    evidence,
  };
}

export function importanceOf(opts: {
  significance: number;
  hits: number;
  nodes: number;
  absMove: number;
  probability: number;
  sources: number;
}): number {
  const breadth = opts.nodes * 3;
  const mag = Math.abs(opts.absMove) * 4 + opts.probability * 0.15;
  const vel = opts.hits * 3 + opts.sources * 2;
  return Math.round(clamp(opts.significance * 0.45 + breadth + mag + vel, 4, 99));
}
