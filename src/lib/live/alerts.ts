import type { AlertRule } from "@/data/types";
import { confirmationOf, crowdingOf } from "./discover";
import type { AlertHit, LiveDesk } from "./types";

function numIn(title: string) {
  const m = title.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : undefined;
}

function inferEventId(title: string, explicit: string | undefined, desk: LiveDesk) {
  if (explicit && (desk.books[explicit] || desk.liveEvents.some((e) => e.id === explicit))) {
    return explicit;
  }
  const t = title.toLowerCase();
  const hit = desk.liveEvents.find((e) => {
    const blob = (e.title + " " + (e.entities ?? []).join(" ") + " " + e.theme + " " + e.region).toLowerCase();
    return t.split(/\s+/).filter((w) => w.length > 3 && blob.includes(w)).length >= 2;
  });
  return hit?.id ?? desk.liveEvents[0]?.id;
}

function inferTicker(title: string, explicit?: string, desk?: LiveDesk) {
  if (explicit) return explicit.toUpperCase();
  const m = title.match(/\b([A-Z]{2,5})\b/);
  if (m) return m[1];
  const lead = desk?.liveEvents[0];
  const under = lead?.trades.find((t) => t.distance && t.distance >= 2) ?? lead?.trades[0];
  return under?.ticker ?? lead?.headlineTicker;
}

function tickerMentions(desk: LiveDesk, ticker: string) {
  const key = ticker.toLowerCase();
  return desk.headlines.filter((h) => h.title.toLowerCase().includes(key)).length;
}

export function evaluateAlert(alert: AlertRule, desk: LiveDesk): AlertHit | null {
  if (!alert.active) return null;
  const eventId = inferEventId(alert.title, alert.eventId, desk);
  const book = eventId ? desk.books[eventId] : undefined;
  const threshold = alert.threshold ?? numIn(alert.title) ?? 0;

  if (alert.kind === "probability") {
    if (!book) return null;
    if (book.probability >= threshold) {
      return {
        id: alert.id,
        reason: `${eventId} probability ${book.probability.toFixed(0)}% ≥ ${threshold}%`,
      };
    }
    return null;
  }

  if (alert.kind === "price") {
    const ticker = inferTicker(alert.title, alert.ticker, desk);
    if (!ticker) return null;
    const q = desk.quotes[ticker];
    if (!q) return null;
    if (Math.abs(q.changePct) >= threshold) {
      return {
        id: alert.id,
        reason: `${ticker} session ${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(1)}% vs ${threshold}% trigger`,
      };
    }
    return null;
  }

  if (alert.kind === "narrative") {
    if (!book) return null;
    const bar = threshold || 4;
    if (book.hits >= bar) {
      return {
        id: alert.id,
        reason: `${eventId} tape: ${book.hits} live items (trigger ${bar})`,
      };
    }
    return null;
  }

  if (alert.kind === "scenario" && book) {
    const ranked = [...book.scenarios].sort((a, b) => b.probability - a.probability);
    const top = ranked[0];
    if (top && top.probability >= (threshold || 30)) {
      return { id: alert.id, reason: `Top scenario is ${top.name} at ${top.probability}%` };
    }
  }

  if (alert.kind === "path" && book) {
    const bar = threshold || 5;
    const moved = book.scenarios
      .map((s) => ({ s, d: s.probability - s.prevProbability }))
      .filter((x) => Math.abs(x.d) >= bar)
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
    if (!moved) return null;
    const sign = moved.d > 0 ? "+" : "";
    const why = moved.s.audit?.evidence ? ` ${moved.s.audit.evidence}` : "";
    return {
      id: alert.id,
      reason: `${moved.s.name}: ${moved.s.prevProbability}% → ${moved.s.probability}% (${sign}${moved.d} pts).${why}`,
    };
  }

  if (alert.kind === "crowding") {
    const ticker = inferTicker(alert.title, alert.ticker, desk);
    if (!ticker) return null;
    const q = desk.quotes[ticker];
    const crowd = crowdingOf(tickerMentions(desk, ticker), Math.abs(q?.changePct ?? 0), false);
    const hay = alert.title.toLowerCase();
    const wantsHigh = /high|saturated/.test(hay);
    const hit = wantsHigh ? crowd === "high" || crowd === "saturated" : crowd === "low" || crowd === "emerging";
    if (hit) {
      return { id: alert.id, reason: `${ticker} crowding ${crowd}` };
    }
    return null;
  }

  if (alert.kind === "confirmation" || alert.kind === "invalidation") {
    const ticker = inferTicker(alert.title, alert.ticker, desk);
    if (!ticker) return null;
    const q = desk.quotes[ticker];
    if (!q) return null;
    const side = /short|down/.test(alert.title.toLowerCase()) ? "down" : "up";
    const conf = confirmationOf(q.changePct, side, undefined);
    if (alert.kind === "invalidation" && (conf === "invalidating" || conf === "diverging")) {
      return { id: alert.id, reason: `${ticker} tape ${conf} (${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(1)}%)` };
    }
    if (alert.kind === "confirmation" && (conf === "early" || conf === "confirming" || conf === "strong")) {
      return { id: alert.id, reason: `${ticker} confirmation ${conf} (${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(1)}%)` };
    }
    return null;
  }

  return null;
}

export function evaluateAlerts(alerts: AlertRule[], desk: LiveDesk): AlertHit[] {
  const hits: AlertHit[] = [];
  for (const a of alerts) {
    const hit = evaluateAlert(a, desk);
    if (hit) hits.push(hit);
  }
  return hits;
}
