import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { headlineToEvidence, stampHeadlineClocks } from "./evidence.ts";
import { parseRss } from "./rss.ts";
import type { LiveHeadline } from "./types.ts";

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

describe("stampHeadlineClocks", () => {
  it("uses pubDate as eventTime and ingest as availableTime when pubDate is older", () => {
    const clocks = stampHeadlineClocks(PUB, INGEST);
    assert.equal(clocks.eventTimeMs, PUB_MS);
    assert.equal(clocks.published, clocks.eventTimeMs);
    assert.equal(clocks.availableTimeMs, INGEST);
    assert.notEqual(clocks.availableTimeMs, clocks.eventTimeMs);
    assert.ok(clocks.availableTimeMs >= clocks.eventTimeMs);
  });

  it("infers eventTime from ingest when pubDate is missing", () => {
    const clocks = stampHeadlineClocks("", INGEST);
    assert.equal(clocks.eventTimeMs, INGEST);
    assert.equal(clocks.availableTimeMs, INGEST);
    assert.equal(clocks.published, INGEST);
  });

  it("never lets availableTime precede eventTime on a future pubDate", () => {
    const future = INGEST + 60_000;
    const clocks = stampHeadlineClocks(future, INGEST);
    assert.equal(clocks.eventTimeMs, future);
    assert.equal(clocks.availableTimeMs, future);
    assert.ok(clocks.availableTimeMs >= clocks.eventTimeMs);
  });
});

describe("headlineToEvidence dual clocks", () => {
  it("passes both clocks through and marks delayed when ingest is later than pubDate", () => {
    const item = headlineToEvidence(tapeItem(), (ms) => `t-${ms}`);
    assert.equal(item.eventTimeMs, PUB_MS);
    assert.equal(item.availableTimeMs, INGEST);
    assert.notEqual(item.availableTimeMs, item.eventTimeMs);
    assert.ok(item.availableTimeMs >= item.eventTimeMs);
    assert.equal(item.delayed, true);
    assert.equal(item.time, `t-${PUB_MS}`);
  });

  it("is not delayed when clocks are inferred equal", () => {
    const item = headlineToEvidence(tapeItem(stampHeadlineClocks(undefined, INGEST)), () => "clock");
    assert.equal(item.eventTimeMs, INGEST);
    assert.equal(item.availableTimeMs, INGEST);
    assert.equal(item.delayed, false);
  });
});

describe("parseRss ingest watermark", () => {
  it("does not copy pubDate into availableTimeMs when the item is older than ingest", () => {
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
});
