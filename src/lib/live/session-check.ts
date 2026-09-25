import type { Quad } from "./macro-regime.ts";

/** What the quad's usual pattern says should lead today. Not an order. */
export type SessionLeg = {
  label: string;
  tickers: string[];
  expect: "up" | "down";
};

export const SESSION_LEGS: Record<Quad, SessionLeg[]> = {
  1: [
    { label: "Equities", tickers: ["SPX", "QQQ"], expect: "up" },
    { label: "Credit", tickers: ["KRE", "XLF"], expect: "up" },
    { label: "Long duration", tickers: ["TLT"], expect: "down" },
  ],
  2: [
    { label: "Commodities", tickers: ["CL", "HG"], expect: "up" },
    { label: "Cyclicals", tickers: ["XLE", "IWM"], expect: "up" },
    { label: "Long duration", tickers: ["TLT"], expect: "down" },
  ],
  3: [
    { label: "Real assets", tickers: ["GLD", "CL"], expect: "up" },
    { label: "Credit", tickers: ["KRE", "XLF"], expect: "down" },
  ],
  4: [
    { label: "Duration", tickers: ["TLT"], expect: "up" },
    { label: "Cyclicals", tickers: ["XLE", "IWM"], expect: "down" },
  ],
};

export type SessionRow = {
  label: string;
  ticker: string;
  changePct: number;
  expect: "up" | "down";
  met: boolean;
};

export type SessionCheck = {
  rows: SessionRow[];
  met: number;
  n: number;
  read: "agrees" | "fights" | "split" | "no tape";
};

function firstPrint(tickers: string[], tape: Record<string, number | undefined>) {
  for (const ticker of tickers) {
    const change = tape[ticker];
    if (change != null && Number.isFinite(change)) return { ticker, change };
  }
  return null;
}

/** A flat print confirms nothing. Missing prints are left off the vote. */
export function sessionCheck(quad: Quad, tape: Record<string, number | undefined>): SessionCheck {
  const rows: SessionRow[] = [];
  for (const leg of SESSION_LEGS[quad]) {
    const print = firstPrint(leg.tickers, tape);
    if (!print) continue;
    const met = leg.expect === "up" ? print.change > 0 : print.change < 0;
    rows.push({ label: leg.label, ticker: print.ticker, changePct: print.change, expect: leg.expect, met });
  }
  if (!rows.length) return { rows, met: 0, n: 0, read: "no tape" };
  const met = rows.filter((row) => row.met).length;
  const read = met === rows.length ? "agrees" : met === 0 ? "fights" : "split";
  return { rows, met, n: rows.length, read };
}
