const FALLBACK = "Something on this page failed. Try again, or reload.";

/** First line of an error, shortened. Stack traces stay off the screen. */
export function plainError(error: unknown, fallback = FALLBACK): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const line = raw.split("\n").find((row) => row.trim() && !row.trim().startsWith("at "))?.trim() ?? "";
  if (!line) return fallback;
  if (line.length > 220) return `${line.slice(0, 217)}…`;
  return line;
}
