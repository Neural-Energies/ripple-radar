import assert from "node:assert/strict";
import { test } from "node:test";
import type { LiveHeadline } from "./types.ts";
import {
  DELAYED_LAG_MS,
  computeDelayedFlag,
  headlineToEvidence,
  stampHeadlineClocks,
} from "./evidence.ts";
import { parseRss } from "./rss.ts";

function clock(ms: number) {
  return new Date(ms).toISOString();
}

function rssHeadline(partial: Partial<LiveHeadline> & Pick<LiveHeadline, "title">): LiveHeadline {
  const eventTimeMs = partial.eventTimeMs ?? Date.now() - 60_000;
  const availableTimeMs = partial.availableTimeMs ?? Date.now();
  return {
    id: partial.id ?? "h1",
    title: partial.title,
    source: partial.source ?? "Reuters",
    url: partial.url ?? "https://example.com",
    published: partial.published ?? eventTimeMs,
    eventTimeMs,
    availableTimeMs,
    eventIds: partial.eventIds ?? [],
    tone: partial.tone ?? "neutral",
  };
}

test("headlineToEvidence: RSS-like headline is delayed true", () => {
  const h = rssHeadline({
    title: "White House brief on overnight developments",
    eventTimeMs: Date.now() - 2 * 60_000,
    availableTimeMs: Date.now(),
  });
  const ev = headlineToEvidence(h, clock);
  assert.equal(ev.delayed, true);
});

test("headlineToEvidence: dual clocks pass through", () => {
  const eventTimeMs = 1_700_000_000_000;
  const availableTimeMs = 1_700_000_900_000;
  const h = rssHeadline({
    title: "Central bank signals policy pivot",
    eventTimeMs,
    availableTimeMs,
  });
  const ev = headlineToEvidence(h, clock);
  assert.equal(ev.eventTimeMs, eventTimeMs);
  assert.equal(ev.availableTimeMs, availableTimeMs);
  assert.equal(ev.time, clock(eventTimeMs));
});

test("computeDelayedFlag: lag >= 15m ⇒ delayed", () => {
  const eventTimeMs = 1_000_000;
  const availableTimeMs = eventTimeMs + DELAYED_LAG_MS;
  assert.equal(
    computeDelayedFlag({
      eventTimeMs,
      availableTimeMs,
      kind: "news",
      inherentlyDelayed: false,
    }),
    true,
  );
  assert.equal(
    computeDelayedFlag({
      eventTimeMs,
      availableTimeMs: eventTimeMs + DELAYED_LAG_MS - 1,
      kind: "news",
      inherentlyDelayed: false,
    }),
    false,
  );
});

test("computeDelayedFlag: kind filing/data ⇒ delayed even with small lag", () => {
  const now = Date.now();
  assert.equal(
    computeDelayedFlag({
      eventTimeMs: now,
      availableTimeMs: now + 1_000,
      kind: "filing",
      inherentlyDelayed: false,
    }),
    true,
  );
  assert.equal(
    computeDelayedFlag({
      eventTimeMs: now,
      availableTimeMs: now + 1_000,
      kind: "data",
      inherentlyDelayed: false,
    }),
    true,
  );
});

test("headlineToEvidence: small lag + news kind still delayed (RSS path)", () => {
  const now = Date.now();
  const h = rssHeadline({
    // Avoid classifyText → kind "data" from market/fundamental cues.
    title: "Local officials discuss overnight weather briefing",
    eventTimeMs: now - 30_000,
    availableTimeMs: now,
  });
  const ev = headlineToEvidence(h, clock);
  assert.equal(ev.kind, "news");
  assert.ok(ev.availableTimeMs - ev.eventTimeMs < DELAYED_LAG_MS);
  assert.equal(ev.delayed, true);
});

const INGEST = Date.parse("2026-09-21T14:00:00.000Z");
const PUB = "Sun, 20 Sep 2026 08:00:00 GMT";
const PUB_MS = Date.parse(PUB);

function tapeItem(over: Partial<LiveHeadline> = {}): LiveHeadline {
  const clocks = stampHeadlineClocks(PUB, INGEST);
  return {
    id: "h1",
    title: "Gulf Coast refinery outage delays crude loadings",
    source: "Reuters",
    url: "https://example.test/outage",
    ...clocks,
    eventIds: [],
    tone: "down",
    ...over,
  };
}

test("stampHeadlineClocks: pubDate is eventTime and ingest is availableTime when pubDate is older", () => {
  const clocks = stampHeadlineClocks(PUB, INGEST);
  assert.equal(clocks.eventTimeMs, PUB_MS);
  assert.equal(clocks.published, clocks.eventTimeMs);
  assert.equal(clocks.availableTimeMs, INGEST);
  assert.notEqual(clocks.availableTimeMs, clocks.eventTimeMs);
  assert.ok(clocks.availableTimeMs >= clocks.eventTimeMs);
});

test("stampHeadlineClocks: infers eventTime from ingest when pubDate is missing", () => {
  const clocks = stampHeadlineClocks("", INGEST);
  assert.equal(clocks.eventTimeMs, INGEST);
  assert.equal(clocks.availableTimeMs, INGEST);
  assert.equal(clocks.published, INGEST);
});

test("stampHeadlineClocks: never lets availableTime precede eventTime on a future pubDate", () => {
  const future = INGEST + 60_000;
  const clocks = stampHeadlineClocks(future, INGEST);
  assert.equal(clocks.eventTimeMs, future);
  assert.equal(clocks.availableTimeMs, future);
  assert.ok(clocks.availableTimeMs >= clocks.eventTimeMs);
});

test("headlineToEvidence: marks delayed when ingest is later than pubDate", () => {
  const item = headlineToEvidence(tapeItem(), (ms) => `t-${ms}`);
  assert.equal(item.eventTimeMs, PUB_MS);
  assert.equal(item.availableTimeMs, INGEST);
  assert.notEqual(item.availableTimeMs, item.eventTimeMs);
  assert.ok(item.availableTimeMs >= item.eventTimeMs);
  assert.equal(item.delayed, true);
  assert.equal(item.time, `t-${PUB_MS}`);
});

test("headlineToEvidence: not delayed when clocks are inferred equal", () => {
  const item = headlineToEvidence(tapeItem(stampHeadlineClocks(undefined, INGEST)), () => "clock");
  assert.equal(item.eventTimeMs, INGEST);
  assert.equal(item.availableTimeMs, INGEST);
  assert.equal(item.delayed, false);
});

test("parseRss: does not copy pubDate into availableTimeMs when the item is older than ingest", () => {
  const xml = `<?xml version="1.0"?>
<rss><channel>
<item>
  <title>Central bank holds rates after overnight pipeline disruption</title>
  <link>https://example.test/rates</link>
  <pubDate>${PUB}</pubDate>
</item>
<item>
  <title>Markets digest the same tape without a publish stamp attached</title>
  <link>https://example.test/inferred</link>
</item>
</channel></rss>`;
  const items = parseRss(xml, "Reuters", INGEST);
  assert.equal(items.length, 2);

  const dated = items[0]!;
  assert.equal(dated.eventTimeMs, PUB_MS);
  assert.equal(dated.published, dated.eventTimeMs);
  assert.equal(dated.availableTimeMs, INGEST);
  assert.notEqual(dated.availableTimeMs, dated.eventTimeMs);
  assert.ok(dated.availableTimeMs >= dated.eventTimeMs);

  const mapped = headlineToEvidence(dated, () => "clock");
  assert.equal(mapped.eventTimeMs, PUB_MS);
  assert.equal(mapped.availableTimeMs, INGEST);
  assert.equal(mapped.delayed, true);

  const inferred = items[1]!;
  assert.equal(inferred.eventTimeMs, INGEST);
  assert.equal(inferred.availableTimeMs, INGEST);
  assert.equal(inferred.published, INGEST);
});
