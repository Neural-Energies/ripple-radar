/**
 * ACE forecast bands (§12) — credible intervals on scenario probability.
 *
 * These are not decorative and not invented. The probability engine holds a
 * Dirichlet posterior over the scenario set; the marginal distribution of any
 * single component of Dir(α) is exactly Beta(αᵢ, α₀ − αᵢ). So P10/P50/P90 on
 * "how likely is this scenario" are quantiles of a distribution the model
 * genuinely has, computed by inverting the regularized incomplete beta.
 *
 * What the width means, honestly: the band reflects how much evidence the
 * posterior rests on, nothing more. Thin evidence gives a wide band — that is
 * the correct answer to "how sure are you", not a failure to render. It does
 * NOT claim the scenario is calibrated against realized outcomes; that lives
 * behind the calibration ledger and its own provenance tier.
 *
 * Deterministic: no sampling, no RNG. Same α in, same band out.
 */
import type { ForecastBand } from "@/data/types";


/** Lanczos log-gamma — standard coefficients, accurate to ~15 digits. */
function logGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = c[0]!;
  const t = z + g + 0.5;
  for (let i = 1; i < g + 2; i += 1) a += c[i]! / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta (modified Lentz). */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const TINY = 1e-30;
  const EPS = 3e-12;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I(x; a, b) — the Beta CDF. */
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(x, a, b)) / a
    : 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

/** Beta quantile by bisection on the CDF. Monotone, so this always converges. */
export function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (betaCdf(mid, a, b) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-10) break;
  }
  return (lo + hi) / 2;
}

/**
 * Credible bands for each scenario from the Dirichlet concentration vector.
 *
 * `alpha` must be the posterior concentration the probability engine actually
 * used — passing renormalized display percentages here would silently invent
 * precision the model never had.
 */
export function forecastBands(scenarioIds: string[], alpha: number[]): ForecastBand[] {
  const total = alpha.reduce((a, n) => a + n, 0);
  if (!Number.isFinite(total) || total <= 0) return [];
  return scenarioIds.map((id, i) => {
    const ai = alpha[i] ?? 0;
    const bi = Math.max(total - ai, 1e-9);
    const pct = (q: number) => Math.round(betaQuantile(q, Math.max(ai, 1e-9), bi) * 1000) / 10;
    const p10 = pct(0.1);
    const p50 = pct(0.5);
    const p90 = pct(0.9);
    return { scenarioId: id, p10, p50, p90, width: Math.round((p90 - p10) * 10) / 10 };
  });
}
