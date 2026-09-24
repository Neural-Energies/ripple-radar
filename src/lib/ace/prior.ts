/**
 * Where a scenario's prior probability comes from.
 *
 * It used to come from here, in `hypothesize.ts`:
 *
 *   const material = clamp(16 + esc * 6 + hits * 2 - de * 4, 8, 42);
 *   const partial  = clamp(26 + hits * 2, 14, 44);
 *   const noise    = clamp(24 - esc * 3 + de * 4, 8, 40);
 *
 * where `hits` is a count of headlines and `esc`/`de` are counts of keywords.
 * Those constants -- 16, 6, 2, 4, 26, 24, 3 -- were authored, and every
 * probability the product displayed traced back to them. The Dirichlet update
 * downstream is real, but it was updating an invented prior.
 *
 * THE REPLACEMENT
 *
 * An Aalen-Johansen competing-risks fit on 4,633 market shocks, with a sealed
 * holdout it was scored on once: worst out-of-sample error 3.5%, against 28.8%
 * for the naive Kaplan-Meier treatment that censors the competing cause. It
 * answers exactly the question ACE's scenario families ask -- after a shock,
 * does this escalate, merely continue, or neither -- and it answers it BY
 * HORIZON, so a 24-hour book and a 30-day book no longer share a prior. They
 * should not: escalation runs 3.0% at one day and 7.5% at thirty.
 *
 * WHAT IS STILL NOT MEASURED, AND IS LABELLED
 *
 * The fit distinguishes three outcomes. ACE's books have four families, and the
 * split of the residual between "narrative premium only" and "actively eases"
 * is NOT something this model speaks to. Those two scenarios are marked
 * `residual`: the empirical model sets how much mass they share, and how they
 * divide it is the old heuristic's ratio, flagged as such.
 *
 * The reference class is also a transfer -- the curves were measured on market
 * shocks, not news events -- and every prior says so rather than burying it.
 *
 * THE RANKING
 *
 * Sources are tried strongest-first and the winner is recorded. `insufficient`
 * is a real result: when nothing qualifies, the engine says so instead of
 * manufacturing a number, and the caller decides what to render.
 */
import { BASE_RATE_PROVENANCE, BASE_RATE_REFERENCE_CLASS, baseRateAt } from "./base-rates";
import { roundTo100 } from "./probability";

/** Which family of outcome a scenario row represents, on the ACE axis. */
export type PriorRole = "material" | "partial" | "noise" | "fade";

/** Strongest first. `insufficient` is an answer, not a failure mode. */
export type PriorSource =
  /** Resolved forecasts for this event class in our own ledger. Not yet available. */
  | "empirical_ledger"
  /** The validated competing-risks curves, read at this book's horizon. */
  | "reference_class"
  /** Mass the empirical model leaves over, split by the legacy heuristic ratio. */
  | "residual"
  /** No qualifying source. The caller must not render a probability. */
  | "insufficient";

export interface PriorComponent {
  role: PriorRole;
  probability: number;
  source: PriorSource;
  /** Plain-language account of where this number came from. */
  basis: string;
}

export interface PriorBook {
  components: PriorComponent[];
  /** The weakest source any component relied on — the book's real standing. */
  weakestSource: PriorSource;
  horizonDays: number;
  /** True when the book rests on a validated model rather than authored constants. */
  modelBacked: boolean;
  notes: string[];
}

/**
 * Minimum horizon the curves were fit over. Below this the model has no grid
 * point of its own and reading it would be extrapolation dressed as data.
 */
export const MIN_MODELLED_DAYS = 0.5;

/** How the two unmodelled families split the residual, from the legacy weights. */
const RESIDUAL_SPLIT = { noise: 0.55, fade: 0.45 };

export interface PriorInput {
  /** Book horizon in hours; the engine reads the curve at this point. */
  horizonHours: number;
  /** Roles present in this book, in display order. */
  roles: PriorRole[];
}

/**
 * Build a prior over the roles a book actually contains.
 *
 * Mass always closes to 100 via the same largest-remainder rounding the
 * posterior kernel uses -- two different rounding rules on the same axis is how
 * a book ends up printing 101%.
 */
export function priorFor({ horizonHours, roles }: PriorInput): PriorBook {
  const horizonDays = horizonHours / 24;
  const notes: string[] = [];

  if (!Number.isFinite(horizonDays) || horizonDays < MIN_MODELLED_DAYS) {
    return {
      components: roles.map((role) => ({
        role,
        probability: 0,
        source: "insufficient" as const,
        basis:
          `Horizon of ${horizonDays.toFixed(2)} days is below the ${MIN_MODELLED_DAYS}-day ` +
          "floor the competing-risks curves were fit over. Reading them here would be " +
          "extrapolation, so no prior is offered.",
      })),
      weakestSource: "insufficient",
      horizonDays,
      modelBacked: false,
      notes: ["Insufficient evidence: horizon below the modelled range."],
    };
  }

  const rate = baseRateAt(horizonDays);
  const p = BASE_RATE_PROVENANCE;
  const modelBasis =
    `Aalen-Johansen competing-risks fit, ${p.nSubjects} shocks, read at ` +
    `${horizonDays.toFixed(1)}d. Worst sealed-holdout error ${(p.worstHoldoutError * 100).toFixed(1)}% ` +
    `against ${(p.naiveBaselineWorstError * 100).toFixed(1)}% for the naive baseline. ` +
    BASE_RATE_REFERENCE_CLASS;

  const raw = new Map<PriorRole, { p: number; source: PriorSource; basis: string }>();
  raw.set("material", { p: rate.escalation, source: "reference_class", basis: modelBasis });
  raw.set("partial", { p: rate.continuation, source: "reference_class", basis: modelBasis });

  // Whatever the modelled causes leave over belongs to the families the model
  // does not distinguish. The SIZE of that residual is empirical; the SPLIT is
  // not, and both facts travel with the numbers.
  const residualRoles = roles.filter((r) => r === "noise" || r === "fade");
  const residualMass = Math.max(0, rate.neither);
  if (residualRoles.length) {
    const weights = residualRoles.map((r) => (r === "noise" ? RESIDUAL_SPLIT.noise : RESIDUAL_SPLIT.fade));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    residualRoles.forEach((role, i) => {
      raw.set(role, {
        p: residualMass * (weights[i]! / total),
        source: "residual",
        basis:
          `The competing-risks fit leaves ${(residualMass * 100).toFixed(1)}% unassigned at ` +
          `${horizonDays.toFixed(1)}d — that size is empirical. It does not distinguish ` +
          "narrative-only from active easing, so the split between them is the legacy " +
          "heuristic ratio and is not a measurement.",
      });
    });
    notes.push(
      "Residual families (narrative-only vs eases) share an empirically sized mass on a split the model does not measure.",
    );
  }

  // A book missing a modelled role must still close to 100, so renormalize over
  // exactly the roles present rather than leaving the mass to vanish.
  const present = roles.map((role) => raw.get(role) ?? {
    p: 0,
    source: "insufficient" as PriorSource,
    basis: `No prior source covers the '${role}' role.`,
  });
  const sum = present.reduce((a, c) => a + c.p, 0);
  const scaled = sum > 0 ? present.map((c) => ({ ...c, p: (c.p / sum) * 100 })) : present;
  const closed = roundTo100(scaled.map((c) => c.p));

  const components: PriorComponent[] = roles.map((role, i) => ({
    role,
    probability: closed[i] ?? 0,
    source: scaled[i]!.source,
    basis: scaled[i]!.basis,
  }));

  const order: PriorSource[] = ["empirical_ledger", "reference_class", "residual", "insufficient"];
  const weakestSource = components.reduce<PriorSource>(
    (worst, c) => (order.indexOf(c.source) > order.indexOf(worst) ? c.source : worst),
    "empirical_ledger",
  );

  notes.push(
    `Horizon-aware: read at ${horizonDays.toFixed(1)} days. Escalation incidence runs ` +
      "3.0% at one day and 7.5% at thirty, so a short book and a long book no longer share a prior.",
  );

  return {
    components,
    weakestSource,
    horizonDays,
    modelBacked: components.some((c) => c.source === "reference_class"),
    notes,
  };
}

/** Probabilities in book order, for a caller that only needs the numbers. */
export function priorProbabilities(input: PriorInput): number[] {
  return priorFor(input).components.map((c) => c.probability);
}
