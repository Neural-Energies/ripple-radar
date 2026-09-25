/**
 * Formatting shared by the macro panel and the macro route.
 *
 * Separate from the components so a fast-refresh boundary is not broken by
 * exporting constants alongside them — and so the colour mapping has one
 * definition. A second copy of QUAD_TINT would let the dashboard strip and the
 * detail timeline drift into different colours for the same regime, which is
 * the one thing a legend cannot survive.
 */
import type { Quad } from "./macro-quads";

/**
 * One colour per quad. Deliberately not a red/green good/bad scale: no quad is
 * good or bad here, and the positioning test is exactly what failed.
 */
export const QUAD_TINT: Record<Quad, string> = {
  1: "bg-up/60",
  2: "bg-primary/60",
  3: "bg-warn/60",
  4: "bg-core/60",
};

export const signed = (n: number | null | undefined, digits = 2) =>
  n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;

export const pct = (n: number | null | undefined, digits = 0) =>
  n == null ? "—" : `${(n * 100).toFixed(digits)}%`;

/** "Aug 2026" from an ISO date, in UTC so the month never slips a timezone. */
export const monthLabel = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
};

/** "1st", "2nd", "3rd", "11th", "52nd" — English ordinals, teens included. */
export const ordinal = (n: number) => {
  const abs = Math.abs(Math.round(n));
  const tens = abs % 100;
  if (tens >= 11 && tens <= 13) return `${abs}th`;
  return `${abs}${["th", "st", "nd", "rd"][abs % 10] ?? "th"}`;
};
