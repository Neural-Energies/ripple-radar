/**
 * Futures are first-class instruments (PR #5 B06): ES/NQ and the other index,
 * rates and metals contracts map to an explicit front-month feed symbol, carry
 * their contract conventions, and do not displace the engine's default
 * expression for any tag.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { instrumentOf, tickersForTag } from "../engine/instruments.ts";
import { TICKER_META } from "../engine/ontology.ts";
import { DESK_TICKERS, fromYahoo, FUTURES, QUOTABLE, toYahoo, YAHOO_SYMBOL } from "./symbols.ts";

test("ES and NQ resolve to their front-month futures, not to an equity symbol", () => {
  assert.equal(toYahoo("ES"), "ES=F");
  assert.equal(toYahoo("NQ"), "NQ=F");
  assert.equal(fromYahoo("ES=F"), "ES");
  assert.equal(fromYahoo("NQ=F"), "NQ");
  for (const t of ["ES", "NQ", "ZN"]) assert.ok((DESK_TICKERS as readonly string[]).includes(t), `${t} is quoted on the desk`);
  assert.equal(instrumentOf("es")?.category, "futures");
  assert.match(instrumentOf("NQ")!.name, /front month/);
});

test("every futures instrument with a feed symbol states its contract conventions", () => {
  for (const [ticker, meta] of Object.entries(TICKER_META)) {
    if (meta.kind !== "futures" || !YAHOO_SYMBOL[ticker]?.endsWith("=F")) continue;
    const c = FUTURES[ticker];
    assert.ok(c, `${ticker} has conventions`);
    assert.ok(c.exchange && c.roll && c.session && c.delayMinutes > 0, `${ticker} conventions are complete`);
  }
});

test("the engine's first choice for each tag is unchanged by the new contracts", () => {
  const first = (tag: string) => tickersForTag(tag, new Set(), 1)[0];
  assert.equal(first("equity"), "SPX");
  assert.equal(first("rates"), "TNX");
  assert.equal(first("gold"), "GC");
  assert.equal(first("crude"), "CL");
  assert.equal(first("duration"), "TLT");
  assert.ok(!tickersForTag("equity", new Set(), 3).includes("ES"), "ES ranks behind the cash-index expressions");
});

test("on-demand quote requests accept only plain symbols", () => {
  for (const ok of ["ES", "NQ=F", "BRK.B", "^GSPC", "EURUSD=X", "BTC-USD"]) assert.ok(QUOTABLE.test(ok), ok);
  for (const bad of ["", "es ", "A B", "../x", "ES;DROP", "X".repeat(20)]) assert.ok(!QUOTABLE.test(bad), bad);
});
