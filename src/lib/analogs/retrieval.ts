/**
 * Historical analog retrieval: which past states resemble this one, and what
 * followed each.
 *
 * Ported from the validated Python engine because the request path cannot call
 * Python. A port is where a validated method quietly stops being the validated
 * method, so `retrieval.test.ts` checks this against reference answers the
 * Python run exported for nine query dates spread across regimes. If the two
 * diverge the test fails rather than the product shipping a second, subtly
 * different metric under the same name.
 *
 * WHAT MAKES THIS MORE THAN "ARTICLES THAT SOUND SIMILAR"
 *
 * The state is structural, not semantic: rolling momentum and volatility across
 * five channels. Distance is Mahalanobis, so a one-sigma move in a quiet
 * channel counts as much as a one-sigma move in a noisy one, and correlated
 * channels are not double-counted.
 *
 * TWO LEAKAGE GUARDS, BOTH LOAD BEARING
 *
 * Candidates are restricted to dates whose OWN forward window has already
 * closed. Without that, an analog from last week would be retrieved with a
 * forward return that has not finished happening.
 *
 * The covariance is estimated on the candidate window only. Using the full
 * sample would let the present influence the metric used to retrieve its own
 * analogs — a subtle leak that makes every query look better than it is.
 *
 * WHAT IT REFUSES TO DO
 *
 * It returns a distribution, never a direction. On the nine reference queries
 * the analogs agreed on direction between 10% and 60% of the time; a median
 * dressed up as a forecast would be the product lying about what it found.
 */

export interface PoolRow {
  /** ISO date of the historical state. */
  d: string;
  /** Forward return over the closed window, or null if it never closed. */
  f: number | null;
  /** State features, in the pool's declared feature order. */
  x: number[];
}

export interface AnalogHit {
  date: string;
  /** Mahalanobis distance. Smaller is more similar. */
  distance: number;
  forwardReturn: number;
  /**
   * Per-feature share of the squared distance, largest first.
   *
   * This is what "why is it different" means concretely: the features doing
   * the most work to separate this analog from the query.
   */
  drivers: { feature: string; share: number; queryValue: number; analogValue: number }[];
}

export interface AnalogResult {
  available: boolean;
  reason?: string;
  asOf?: string;
  analogs: AnalogHit[];
  /** The spread IS the finding. Never collapsed to a point. */
  distribution?: {
    p10: number;
    p25: number;
    median: number;
    p75: number;
    p90: number;
    mean: number;
    sharePositive: number;
    n: number;
  };
  /**
   * How much the analogs agree on direction: 0 = an even split, 1 = unanimous.
   * Reported so a wide, contradictory set cannot read like a signal.
   */
  agreement?: number;
  /** Candidate dates considered after the forward-window filter. */
  nCandidates?: number;
}

/** Matches numpy's `np.cov(..., rowvar=False)` — ddof = 1. */
export function covariance(rows: number[][]): number[][] {
  const n = rows.length;
  const p = rows[0]?.length ?? 0;
  if (n < 2 || p === 0) return [];
  const mean = new Array<number>(p).fill(0);
  for (const r of rows) for (let j = 0; j < p; j++) mean[j]! += r[j]! / n;
  const cov: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (const r of rows) {
    for (let i = 0; i < p; i++) {
      const di = r[i]! - mean[i]!;
      for (let j = i; j < p; j++) cov[i]![j]! += (di * (r[j]! - mean[j]!)) / (n - 1);
    }
  }
  for (let i = 0; i < p; i++) for (let j = 0; j < i; j++) cov[i]![j] = cov[j]![i]!;
  return cov;
}

/**
 * Eigendecomposition of a symmetric matrix by the cyclic Jacobi method.
 *
 * Chosen over a plain inverse because a covariance over correlated channels can
 * be near-singular, and inverting it would blow one direction up to dominate
 * every distance. Jacobi is exact for symmetric input and gives the
 * eigenvalues a pseudo-inverse needs to discard.
 */
export function jacobiEigen(
  input: number[][],
  { sweeps = 100, tol = 1e-12 }: { sweeps?: number; tol?: number } = {},
): { values: number[]; vectors: number[][] } {
  const n = input.length;
  const a = input.map((r) => [...r]);
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );

  for (let sweep = 0; sweep < sweeps; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i]![j]! ** 2;
    if (off < tol) break;

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: a.map((r, i) => r[i]!), vectors: v };
}

/**
 * Moore-Penrose pseudo-inverse of a symmetric matrix.
 *
 * `rcond` mirrors numpy's default for a square matrix so this and the Python
 * engine discard the same near-zero directions; a different cutoff would give
 * a different metric and the reference test would catch it.
 */
export function pseudoInverseSymmetric(m: number[][], rcond?: number): number[][] {
  const n = m.length;
  const { values, vectors } = jacobiEigen(m);
  const maxAbs = Math.max(...values.map(Math.abs), 0);
  const cut = (rcond ?? 1e-15 * n) * maxAbs;
  const inv: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let k = 0; k < n; k++) {
    const lam = values[k]!;
    if (Math.abs(lam) <= cut) continue;
    const invLam = 1 / lam;
    for (let i = 0; i < n; i++) {
      const vik = vectors[i]![k]!;
      if (vik === 0) continue;
      for (let j = 0; j < n; j++) inv[i]![j]! += vik * invLam * vectors[j]![k]!;
    }
  }
  return inv;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export interface RetrievalOptions {
  features: string[];
  forwardDays: number;
  k?: number;
  /** Candidate cutoff multiplier on the forward window. Mirrors the engine. */
  closedWindowFactor?: number;
}

/**
 * K nearest historical states strictly before `asOf`, and what followed each.
 */
export function retrieveAnalogs(
  pool: PoolRow[],
  asOf: string,
  { features, forwardDays, k = 20, closedWindowFactor = 1.6 }: RetrievalOptions,
): AnalogResult {
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(asOfMs)) {
    return { available: false, reason: `unparseable as_of '${asOf}'`, analogs: [] };
  }

  // Snap to the latest state on or before the query, as the engine does.
  const priors = pool.filter((r) => Date.parse(r.d) <= asOfMs);
  if (priors.length === 0) {
    return { available: false, reason: "no state history before as_of", analogs: [] };
  }
  const current = priors[priors.length - 1]!;
  const currentMs = Date.parse(current.d);

  // Only dates whose own forward window has closed. Without this an analog
  // from last week arrives with a forward return still in progress.
  const cutoffMs = currentMs - Math.trunc(forwardDays * closedWindowFactor) * 86_400_000;
  const candidates = pool.filter((r) => Date.parse(r.d) < cutoffMs);
  if (candidates.length < k * 3) {
    return {
      available: false,
      reason: `only ${candidates.length} eligible historical states`,
      analogs: [],
      nCandidates: candidates.length,
    };
  }

  // Covariance from the candidate window only: the full sample would let the
  // present shape the metric used to find its own analogs.
  const inv = pseudoInverseSymmetric(covariance(candidates.map((r) => r.x)));
  if (inv.length === 0) {
    return { available: false, reason: "state covariance is singular", analogs: [] };
  }

  const p = features.length;
  const scored = candidates.map((row) => {
    const delta = row.x.map((v, i) => v - current.x[i]!);
    // Per-feature contribution to d², so "why is it different" is answerable.
    const contrib = new Array<number>(p).fill(0);
    let d2 = 0;
    for (let i = 0; i < p; i++) {
      let acc = 0;
      for (let j = 0; j < p; j++) acc += inv[i]![j]! * delta[j]!;
      const c = delta[i]! * acc;
      contrib[i] = c;
      d2 += c;
    }
    return { row, distance: Math.sqrt(Math.max(d2, 0)), contrib };
  });

  scored.sort((a, b) => a.distance - b.distance);

  const analogs: AnalogHit[] = [];
  for (const s of scored.slice(0, k * 3)) {
    if (s.row.f === null || !Number.isFinite(s.row.f)) continue;
    const total = s.contrib.reduce((a, c) => a + Math.abs(c), 0) || 1;
    analogs.push({
      date: s.row.d,
      distance: Number(s.distance.toFixed(4)),
      forwardReturn: s.row.f,
      drivers: s.contrib
        .map((c, i) => ({
          feature: features[i] ?? `f${i}`,
          share: Math.abs(c) / total,
          queryValue: current.x[i]!,
          analogValue: s.row.x[i]!,
        }))
        .sort((a, b) => b.share - a.share)
        .slice(0, 3),
    });
    if (analogs.length >= k) break;
  }

  if (analogs.length < Math.max(5, Math.floor(k / 3))) {
    return {
      available: false,
      reason: `only ${analogs.length} analogs have a closed forward window`,
      analogs: [],
      nCandidates: candidates.length,
    };
  }

  const outcomes = analogs.map((a) => a.forwardReturn).sort((x, y) => x - y);
  const positive = outcomes.filter((o) => o > 0).length;
  const sharePositive = positive / outcomes.length;

  return {
    available: true,
    asOf: current.d,
    analogs,
    nCandidates: candidates.length,
    distribution: {
      p10: quantile(outcomes, 0.1),
      p25: quantile(outcomes, 0.25),
      median: quantile(outcomes, 0.5),
      p75: quantile(outcomes, 0.75),
      p90: quantile(outcomes, 0.9),
      mean: outcomes.reduce((a, b) => a + b, 0) / outcomes.length,
      sharePositive,
      n: outcomes.length,
    },
    // 0 when the set splits evenly, 1 when it is unanimous.
    agreement: Math.abs(2 * sharePositive - 1),
  };
}
