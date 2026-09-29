/**
 * Book horizons, parsed. Shared by the forecast ledger (when a book can be
 * graded) and saved theses (when one is due for review), so both read the
 * engine's horizon labels the same way.
 */

/**
 * How long to wait before this book can be graded.
 *
 * A flat 72h was wrong in both directions: a weather book is knowable inside a
 * day, and a licensing or capex book is not settled in three. Grading too
 * early produces an inconclusive verdict that is really just "nothing has
 * happened yet", and those verdicts are what keep calibration empty.
 *
 * The engine already states each book's own horizons (`horizons[].horizon`,
 * e.g. 24h / 7d / 30d / 2q / 12m). Grade at the SHORTEST one — the first
 * checkpoint the book itself claims is meaningful — clamped so a malformed or
 * absurd horizon cannot make a forecast ungradeable or instantly due.
 */
export const MIN_HORIZON_HOURS = 12;
export const MAX_HORIZON_HOURS = 24 * 30;

export function parseHorizonHours(label: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|d|day|days|w|wk|week|weeks|m|mo|month|months|q|quarter|quarters|y|yr|year|years)\s*$/i.exec(
    label,
  );
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2]!.toLowerCase();
  const perUnit = unit.startsWith("h")
    ? 1
    : unit.startsWith("d")
      ? 24
      : unit.startsWith("w")
        ? 24 * 7
        : unit.startsWith("q")
          ? 24 * 91
          : unit.startsWith("y")
            ? 24 * 365
            : 24 * 30; // m / mo / month
  return n * perUnit;
}

export function horizonHoursFor(event: {
  horizons?: { horizon: string }[];
  forecastHorizon?: string;
}): number {
  const labels = [
    ...(event.horizons ?? []).map((h) => h.horizon),
    ...(event.forecastHorizon ? event.forecastHorizon.split(/[\s/·,]+/) : []),
  ];
  const parsed = labels
    .map(parseHorizonHours)
    .filter((n): n is number => n != null && n > 0);
  if (parsed.length === 0) return 72; // no stated horizon: the previous default
  const shortest = Math.min(...parsed);
  return Math.round(Math.min(MAX_HORIZON_HOURS, Math.max(MIN_HORIZON_HOURS, shortest)));
}
