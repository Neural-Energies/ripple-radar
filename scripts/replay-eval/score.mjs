/**
 * Score frozen engine books against cached Yahoo closes.
 * Arithmetic only. No engine imports, so the test can run without tsx.
 */
import { readFileSync, writeFileSync } from "node:fs";

export const DEADBAND = 0.0005;

/** Pre-set naive cards. Keys match events.json `naive`. Empty means abstain. */
export const NAIVE_RULES = {
  hot_inflation: { SPY: -1, QQQ: -1, TNX: 1, DXY: 1, GLD: -1, CL: 1 },
  cool_inflation: { SPY: 1, QQQ: 1, TNX: -1, DXY: -1, GLD: 1, CL: -1 },
  inline: {},
  hot_labor: { SPY: -1, QQQ: -1, TNX: 1, DXY: 1, GLD: -1 },
  cold_labor: { SPY: -1, QQQ: -1, TNX: -1, DXY: -1, GLD: 1 },
  hawkish: { SPY: -1, QQQ: -1, TNX: 1, DXY: 1, GLD: -1 },
  dovish: { SPY: 1, QQQ: 1, TNX: -1, DXY: -1, GLD: 1 },
  hold: {},
  oil_cut: { SPY: -1, QQQ: -1, TNX: 1, GLD: 1, CL: 1 },
  geo_shock: { SPY: -1, QQQ: -1, TNX: -1, DXY: 1, GLD: 1, CL: 1 },
  long_nvda: { NVDA: 1, QQQ: 1, SPY: 1 },
  short_tsla: { TSLA: -1, QQQ: -1, SPY: -1 },
  tariff: { SPY: -1, QQQ: -1, TNX: -1, DXY: 1, GLD: 1 },
  none: {},
};

const BASKET_ASSETS = ["SPY", "QQQ", "TNX", "DXY", "GLD", "CL"];

const BASKET_MAP = {
  SPY: [{ symbols: ["SPY", "SPX", "ES"], invert: false }],
  QQQ: [{ symbols: ["QQQ", "NQ"], invert: false }],
  TNX: [
    { symbols: ["TNX"], invert: false },
    { symbols: ["TLT", "ZN", "ZB"], invert: true },
  ],
  GLD: [{ symbols: ["GLD", "GC"], invert: false }],
  CL: [{ symbols: ["CL", "USO", "BZ"], invert: false }],
  DXY: [
    { symbols: ["UUP"], invert: false },
    { symbols: ["EUR"], invert: true },
  ],
};

const PRICE_SYMBOL = {
  SPY: "SPY",
  QQQ: "QQQ",
  TNX: "^TNX",
  DXY: "DX-Y.NYB",
  GLD: "GLD",
  CL: "CL=F",
  NVDA: "NVDA",
  TSLA: "TSLA",
};

export function nyDate(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function nyMinutes(ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const hour = Number(parts.find((p) => p.type === "hour").value);
  const minute = Number(parts.find((p) => p.type === "minute").value);
  return hour * 60 + minute;
}

/** First SPY session that can contain the cash reaction. */
export function cashSession(spyDates, releaseUtc) {
  const ms = Date.parse(releaseUtc);
  const ymd = nyDate(ms);
  const minutes = nyMinutes(ms);
  const openThatDay = spyDates.includes(ymd) && minutes < 16 * 60;
  if (openThatDay) return ymd;
  return spyDates.find((d) => d > ymd) ?? null;
}

export function shiftSession(spyDates, session, steps) {
  const i = spyDates.indexOf(session);
  if (i < 0) return null;
  return spyDates[i + steps] ?? null;
}

export function priceReturn(series, fromDate, toDate) {
  if (!series || !fromDate || !toDate) return null;
  const a = series[fromDate];
  const b = series[toDate];
  if (a == null || b == null || a === 0) return null;
  return b / a - 1;
}

export function directionHit(predicted, ret) {
  if (predicted !== 1 && predicted !== -1) return { hit: null, flat: false, skipped: true };
  if (ret == null || Number.isNaN(ret)) return { hit: null, flat: false, skipped: true };
  if (Math.abs(ret) < DEADBAND) return { hit: null, flat: true, skipped: false };
  return { hit: Math.sign(ret) === predicted, flat: false, skipped: false };
}

export function engineBasketCall(trades, asset) {
  const specs = BASKET_MAP[asset];
  if (!specs) return 0;
  for (const spec of specs) {
    const hits = trades.filter((t) => spec.symbols.includes(t.ticker));
    if (!hits.length) continue;
    const signs = new Set(hits.map((t) => (t.side === "short" ? -1 : 1) * (spec.invert ? -1 : 1)));
    if (signs.size !== 1) return 0;
    return [...signs][0];
  }
  return 0;
}

export function wilson(hits, n, z = 1.96) {
  if (!n) return null;
  const p = hits / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: (centre - margin) / d, high: (centre + margin) / d };
}

function erf(x) {
  const sign = Math.sign(x);
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

export function binomialP(hits, n) {
  if (!n) return null;
  const z = (hits / n - 0.5) / Math.sqrt(0.25 / n);
  const tail = 1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2));
  return Math.min(1, 2 * tail);
}

export function spearman(xs, ys) {
  if (xs.length !== ys.length || xs.length < 3) return null;
  return pearson(ranks(xs), ranks(ys));
}

function ranks(xs) {
  const order = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = Array(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[order[k][1]] = avg;
    i = j + 1;
  }
  return out;
}

function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

export function hourWindow(bars, releaseMs) {
  const hour = 3_600_000;
  if (!bars?.length) return null;
  let pre = null;
  for (const bar of bars) {
    if (bar.t + hour <= releaseMs) pre = bar;
    else break;
  }
  let post = null;
  for (const bar of bars) {
    if (bar.t + hour >= releaseMs + hour && bar.t >= releaseMs - hour) {
      post = bar;
      break;
    }
  }
  if (!pre || !post || pre.c == null || post.c == null || pre.c === 0) return null;
  const gapMin = (releaseMs - (pre.t + hour)) / 60_000;
  const spanMin = (post.t + hour - (pre.t + hour)) / 60_000;
  let kind = "in_session";
  if (gapMin > 90) kind = "stale_pre";
  else if (spanMin < 30 || spanMin > 150) kind = "bad_span";
  return {
    preT: pre.t,
    postT: post.t,
    ret: post.c / pre.c - 1,
    gapMin: Math.round(gapMin),
    spanMin: Math.round(spanMin),
    kind,
  };
}

function round4(n) {
  if (n == null || Number.isNaN(n)) return null;
  return Math.round(n * 10000) / 10000;
}

function summarize(calls) {
  const decided = calls.filter((c) => c.hit != null);
  const hits = decided.filter((c) => c.hit).length;
  const n = decided.length;
  const flats = calls.filter((c) => c.flat).length;
  const signed = decided.map((c) => c.signed);
  const meanSigned = signed.length ? signed.reduce((s, x) => s + x, 0) / signed.length : null;
  const byEvent = new Map();
  for (const c of decided) {
    const row = byEvent.get(c.eventId) ?? { hits: 0, n: 0 };
    row.n += 1;
    if (c.hit) row.hits += 1;
    byEvent.set(c.eventId, row);
  }
  const eventRates = [...byEvent.values()].map((r) => r.hits / r.n);
  const eventEqual = eventRates.length ? eventRates.reduce((s, x) => s + x, 0) / eventRates.length : null;
  return {
    calls: calls.length,
    decided: n,
    hits,
    hitRate: n ? hits / n : null,
    wilson95: wilson(hits, n),
    binomialPVsHalf: binomialP(hits, n),
    flats,
    events: byEvent.size,
    eventEqualHitRate: eventEqual,
    meanSignedReturn: meanSigned,
  };
}

function signature(trades) {
  return trades.map((t) => `${t.ticker}:${t.side}`).join(",");
}

export function scoreReplay(predictions, prices) {
  const spyDates = Object.keys(prices.daily.SPY ?? {}).sort();
  const hourly = prices.hourly ?? {};
  const perEvent = [];
  const tradeCalls = { eod: [], d1: [], d3: [], cum3: [], h1: [] };
  const basketEngine = { eod: [], d1: [], d3: [], cum3: [], h1: [] };
  const basketNaive = { eod: [], d1: [], d3: [], cum3: [], h1: [] };
  const basketBoth = { eod: [], d1: [], d3: [], cum3: [], h1: [] };
  const rankRows = [];

  for (const event of predictions.events) {
    const session = cashSession(spyDates, event.releaseUtc);
    const anchor = shiftSession(spyDates, session, -1);
    const d1 = shiftSession(spyDates, session, 1);
    const d3 = shiftSession(spyDates, session, 3);
    const dates = { anchor, session, d1, d3 };
    const releaseMs = Date.parse(event.releaseUtc);

    const trades = event.trades.map((trade) => {
      const series = prices.daily[trade.yahoo];
      const rets = {
        eod: priceReturn(series, anchor, session),
        d1: priceReturn(series, session, d1),
        d3: priceReturn(series, session, d3),
        cum3: priceReturn(series, anchor, d3),
      };
      const predicted = trade.side === "short" ? -1 : 1;
      const hits = {};
      for (const [horizon, ret] of Object.entries(rets)) {
        const judged = directionHit(predicted, ret);
        hits[horizon] = judged.hit;
        tradeCalls[horizon].push({
          eventId: event.id,
          group: event.group,
          control: event.group === "control",
          keep: event.relevance.keep,
          ticker: trade.ticker,
          hit: judged.hit,
          flat: judged.flat,
          signed: judged.hit == null ? null : predicted * ret,
        });
      }
      const h1 = hourWindow(hourly[trade.yahoo], releaseMs);
      let h1Hit = null;
      if (h1 && h1.kind === "in_session") {
        const judged = directionHit(predicted, h1.ret);
        h1Hit = judged.hit;
        tradeCalls.h1.push({
          eventId: event.id,
          group: event.group,
          control: event.group === "control",
          keep: event.relevance.keep,
          ticker: trade.ticker,
          hit: judged.hit,
          flat: judged.flat,
          signed: judged.hit == null ? null : predicted * h1.ret,
        });
      }
      return {
        ticker: trade.ticker,
        yahoo: trade.yahoo,
        side: trade.side,
        nodeDirection: trade.nodeDirection,
        score: trade.score,
        distance: trade.distance,
        rets: Object.fromEntries(Object.entries(rets).map(([k, v]) => [k, round4(v)])),
        hits,
        h1: h1
          ? { ...h1, ret: round4(h1.ret), hit: h1Hit, counted: h1.kind === "in_session" }
          : null,
      };
    });

    const scoredRanks = trades.filter((t) => t.hits.eod != null && t.rets.eod != null);
    if (scoredRanks.length >= 4) {
      rankRows.push({
        eventId: event.id,
        spearman: spearman(
          scoredRanks.map((t) => t.score),
          scoredRanks.map((t) => (t.side === "short" ? -1 : 1) * t.rets.eod),
        ),
        top3: topSigned(scoredRanks),
        rest: restSigned(scoredRanks),
      });
    }

    const basket = {};
    const naiveRule = NAIVE_RULES[event.naive] ?? {};
    const assets = [...new Set([...BASKET_ASSETS, ...Object.keys(naiveRule)])];
    for (const asset of assets) {
      const symbol = PRICE_SYMBOL[asset];
      const series = prices.daily[symbol];
      const rets = {
        eod: priceReturn(series, anchor, session),
        d1: priceReturn(series, session, d1),
        d3: priceReturn(series, session, d3),
        cum3: priceReturn(series, anchor, d3),
      };
      const engine = BASKET_MAP[asset] ? engineBasketCall(event.trades, asset) : 0;
      const naive = naiveRule[asset] ?? 0;
      const h1 = hourWindow(hourly[symbol], releaseMs);
      const judged = {};
      for (const horizon of ["eod", "d1", "d3", "cum3"]) {
        const e = directionHit(engine, rets[horizon]);
        const n = directionHit(naive, rets[horizon]);
        judged[horizon] = { engine: e.hit, naive: n.hit };
        pushBasket(basketEngine[horizon], event, asset, engine, e, rets[horizon]);
        pushBasket(basketNaive[horizon], event, asset, naive, n, rets[horizon]);
        if (engine !== 0 && naive !== 0) {
          pushBasket(basketBoth[horizon], event, asset, engine, e, rets[horizon], { naiveHit: n.hit });
        }
      }
      if (h1 && h1.kind === "in_session") {
        const e = directionHit(engine, h1.ret);
        const n = directionHit(naive, h1.ret);
        judged.h1 = { engine: e.hit, naive: n.hit, kind: h1.kind, spanMin: h1.spanMin };
        pushBasket(basketEngine.h1, event, asset, engine, e, h1.ret);
        pushBasket(basketNaive.h1, event, asset, naive, n, h1.ret);
        if (engine !== 0 && naive !== 0) pushBasket(basketBoth.h1, event, asset, engine, e, h1.ret, { naiveHit: n.hit });
      } else {
        judged.h1 = null;
      }
      basket[asset] = {
        engine,
        naive,
        rets: Object.fromEntries(Object.entries(rets).map(([k, v]) => [k, round4(v)])),
        judged,
      };
    }

    perEvent.push({
      id: event.id,
      group: event.group,
      title: event.title,
      releaseUtc: event.releaseUtc,
      source: event.source,
      naive: event.naive,
      tone: event.tone,
      toneHits: event.toneHits,
      tags: event.tags,
      family: event.family,
      relevance: event.relevance,
      probability: event.probability,
      importance: event.importance,
      headlineTicker: event.headlineTicker,
      conflicts: event.conflicts,
      signature: signature(event.trades),
      dates,
      trades,
      basket,
    });
  }

  const nonControl = (row) => row.group !== "control" && row.control !== true;
  const kept = (row) => row.keep === true && nonControl(row);

  function slice(rows, pred) {
    return summarize(rows.filter(pred));
  }

  const signatures = new Map();
  for (const event of perEvent) {
    const list = signatures.get(event.signature) ?? [];
    list.push(event.id);
    signatures.set(event.signature, list);
  }

  const fred = fredAgreement(perEvent, prices.fred?.DGS10);

  return {
    deadband: DEADBAND,
    horizons: {
      eod: "prior SPY close to event-session close",
      d1: "event-session close to the next session close",
      d3: "event-session close to the close three sessions later",
      cum3: "prior SPY close to the close three sessions after the event session",
      h1: "last completed 60-minute bar at or before release, to the bar that completes about an hour later; counted only when the pre bar ended within 90 minutes and the span is 30–150 minutes",
    },
    perEvent,
    summary: {
      bookAllNonControl: {
        eod: slice(tradeCalls.eod, nonControl),
        d1: slice(tradeCalls.d1, nonControl),
        d3: slice(tradeCalls.d3, nonControl),
        cum3: slice(tradeCalls.cum3, nonControl),
        h1: slice(tradeCalls.h1, nonControl),
      },
      bookDeskKept: {
        eod: slice(tradeCalls.eod, kept),
        cum3: slice(tradeCalls.cum3, kept),
        h1: slice(tradeCalls.h1, kept),
      },
      bookControlsForced: {
        eod: slice(tradeCalls.eod, (r) => r.control === true),
      },
      basketEngineNonControl: {
        eod: slice(basketEngine.eod, nonControl),
        d1: slice(basketEngine.d1, nonControl),
        d3: slice(basketEngine.d3, nonControl),
        cum3: slice(basketEngine.cum3, nonControl),
        h1: slice(basketEngine.h1, nonControl),
      },
      basketNaiveNonControl: {
        eod: slice(basketNaive.eod, nonControl),
        d1: slice(basketNaive.d1, nonControl),
        cum3: slice(basketNaive.cum3, nonControl),
        h1: slice(basketNaive.h1, nonControl),
      },
      basketIntersectionEngine: {
        eod: slice(basketBoth.eod, nonControl),
        cum3: slice(basketBoth.cum3, nonControl),
      },
      basketIntersectionNaive: {
        eod: summarize(basketBoth.eod.filter(nonControl).map((c) => ({ ...c, hit: c.naiveHit, signed: null }))),
        cum3: summarize(basketBoth.cum3.filter(nonControl).map((c) => ({ ...c, hit: c.naiveHit, signed: null }))),
      },
      slices: {
        oilCutBookEod: slice(tradeCalls.eod, (r) => r.group === "opec" && ["CL", "USO", "BZ"].includes(r.ticker)),
        policyRatesBookEod: slice(tradeCalls.eod, (r) => ["cpi", "nfp", "fomc"].includes(r.group) && ["TNX", "TLT", "ZN", "ZB", "TIP"].includes(r.ticker)),
        geoBookEod: slice(tradeCalls.eod, (r) => r.group === "geo"),
        techBookEod: slice(tradeCalls.eod, (r) => r.group === "tech"),
      },
    },
    ranking: {
      events: rankRows.length,
      meanSpearmanEod: mean(rankRows.map((r) => r.spearman).filter((x) => x != null)),
      meanTop3Signed: mean(rankRows.map((r) => r.top3).filter((x) => x != null)),
      meanRestSigned: mean(rankRows.map((r) => r.rest).filter((x) => x != null)),
      rows: rankRows,
    },
    identicalBooks: [...signatures.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([sig, ids]) => ({ ids, signature: sig })),
    controls: perEvent
      .filter((e) => e.group === "control")
      .map((e) => ({
        id: e.id,
        relevanceKeep: e.relevance.keep,
        trades: e.trades.length,
        headline: e.headlineTicker,
      })),
    fredYieldSignAgreement: fred,
    coverage: {
      events: perEvent.length,
      controls: perEvent.filter((e) => e.group === "control").length,
      deskWouldDrop: perEvent.filter((e) => !e.relevance.keep).map((e) => e.id),
      h1BookCalls: tradeCalls.h1.length,
    },
  };
}

function topSigned(trades) {
  const ranked = [...trades].sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, 3);
  return mean(top.map((t) => (t.side === "short" ? -1 : 1) * t.rets.eod));
}

function restSigned(trades) {
  const ranked = [...trades].sort((a, b) => b.score - a.score).slice(3);
  return mean(ranked.map((t) => (t.side === "short" ? -1 : 1) * t.rets.eod));
}

function mean(xs) {
  if (!xs.length) return null;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function pushBasket(bucket, event, asset, predicted, judged, ret, extra = {}) {
  if (!predicted) return;
  bucket.push({
    eventId: event.id,
    group: event.group,
    control: event.group === "control",
    keep: event.relevance.keep,
    asset,
    hit: judged.hit,
    flat: judged.flat,
    signed: judged.hit == null || ret == null ? null : predicted * ret,
    ...extra,
  });
}

function fredAgreement(perEvent, dgs) {
  if (!dgs) return null;
  let n = 0;
  let agree = 0;
  for (const event of perEvent) {
    const tnx = event.basket?.TNX?.rets?.eod;
    const a = dgs[event.dates.anchor];
    const b = dgs[event.dates.session];
    if (tnx == null || a == null || b == null || a === "." || b === ".") continue;
    const fredRet = Number(b) - Number(a);
    if (Math.abs(tnx) < DEADBAND || Math.abs(fredRet) < 0.005) continue;
    n += 1;
    if (Math.sign(tnx) === Math.sign(fredRet)) agree += 1;
  }
  return { compared: n, agree, rate: n ? agree / n : null };
}

function main() {
  const predictions = JSON.parse(readFileSync(new URL("./out/predictions.json", import.meta.url), "utf8"));
  const prices = JSON.parse(readFileSync(new URL("./cache/prices.json", import.meta.url), "utf8"));
  const scored = scoreReplay(predictions, prices);
  const payload = {
    scoredAt: new Date().toISOString(),
    priceVendor: prices.vendor,
    priceFetchedAt: prices.fetchedAt,
    ...scored,
  };
  writeFileSync(new URL("./out/results.json", import.meta.url), JSON.stringify(payload, null, 2));
  const book = payload.summary.bookAllNonControl;
  const basket = payload.summary.basketEngineNonControl;
  const naive = payload.summary.basketNaiveNonControl;
  const fmt = (s) => (s.hitRate == null ? "n/a" : `${(100 * s.hitRate).toFixed(1)}% (${s.hits}/${s.decided})`);
  console.log("book eod", fmt(book.eod), "event-equal", book.eod.eventEqualHitRate);
  console.log("book cum3", fmt(book.cum3), "d1", fmt(book.d1), "h1", fmt(book.h1));
  console.log("basket engine eod", fmt(basket.eod), "naive eod", fmt(naive.eod));
  console.log("identical books", payload.identicalBooks.length, "desk drops", payload.coverage.deskWouldDrop.join(","));
}

const isMain = process.argv[1] && process.argv[1].endsWith("score.mjs");
if (isMain) main();
