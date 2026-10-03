/**
 * Free and delayed feeds fail in ordinary ways: a timeout, a 429, a 5xx,
 * an empty body. Callers retry the transient cases, and a total outage keeps
 * the last non-empty payload instead of caching a blank tape over a good one.
 */

export const FEED_ATTEMPTS = 3;
export const NEWS_FRESH_TTL_MS = 40_000;
export const NEWS_STALE_TTL_MS = 8_000;

export function backoffMs(attempt: number, baseMs = 200): number {
  const n = Math.max(0, attempt);
  return Math.min(2_000, baseMs * 2 ** n);
}

/** Retry network failures and transient HTTP statuses. A 404 is the feed's answer. */
export function shouldRetryHttp(status: number | null, attempt: number, attempts = FEED_ATTEMPTS): boolean {
  if (attempt >= attempts - 1) return false;
  if (status === null) return true;
  if (status === 408 || status === 425 || status === 429) return true;
  return status >= 500;
}

export interface FetchTextOk {
  ok: true;
  text: string;
  attempts: number;
}

export interface FetchTextErr {
  ok: false;
  error: string;
  attempts: number;
}

export async function fetchTextResilient(
  url: string,
  opts: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    attempts?: number;
    headers?: HeadersInit;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<FetchTextOk | FetchTextErr> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const attempts = opts.attempts ?? FEED_ATTEMPTS;
  const timeoutMs = opts.timeoutMs ?? 7_000;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let last = "request failed";
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetchImpl(url, {
        headers: opts.headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        last = `${res.status} ${url}`;
        if (shouldRetryHttp(res.status, attempt, attempts)) {
          await sleep(backoffMs(attempt));
          continue;
        }
        return { ok: false, error: last, attempts: attempt + 1 };
      }
      return { ok: true, text: await res.text(), attempts: attempt + 1 };
    } catch (err) {
      last = err instanceof Error ? err.message : "request failed";
      if (shouldRetryHttp(null, attempt, attempts)) {
        await sleep(backoffMs(attempt));
        continue;
      }
    }
  }
  return { ok: false, error: last, attempts };
}

export interface Retained<T> {
  value: T;
  /** True when `value` is a previous payload kept because the new pull was empty. */
  stale: boolean;
}

/** An empty pull must not erase a tape we already have. */
export function retainList<T>(previous: T[] | null, next: T[]): Retained<T[]> {
  if (next.length === 0 && previous && previous.length > 0) {
    return { value: previous, stale: true };
  }
  return { value: next, stale: false };
}

export function retainRecord<T extends object>(
  previous: Record<string, T> | null,
  next: Record<string, T>,
): Retained<Record<string, T>> {
  const nextCount = Object.keys(next).length;
  const prevCount = previous ? Object.keys(previous).length : 0;
  if (nextCount === 0 && prevCount > 0 && previous) {
    return { value: previous, stale: true };
  }
  return { value: next, stale: false };
}

export function cacheTtlMs(stale: boolean): number {
  return stale ? NEWS_STALE_TTL_MS : NEWS_FRESH_TTL_MS;
}

/** One line for the desk status. Names the outage; does not invent a reading. */
export function feedStatusNote(news: { stale: boolean; failed: string[] }, quotes: { stale: boolean }): string {
  const bits: string[] = [];
  if (news.failed.length) {
    const shown = news.failed.slice(0, 3).join(", ");
    const more = news.failed.length > 3 ? ` +${news.failed.length - 3}` : "";
    bits.push(`${news.failed.length} feed${news.failed.length === 1 ? "" : "s"} down (${shown}${more})`);
  }
  if (news.stale) bits.push("news is the last good pull");
  if (quotes.stale) bits.push("quotes are the last good pull");
  return bits.join(" · ");
}
