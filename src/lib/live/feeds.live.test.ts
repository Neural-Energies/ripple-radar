/**
 * The configured free feeds must answer with RSS the desk can parse.
 * A down source is a failed test, not a silent empty tape.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchTextResilient } from "./feed-resilience.ts";
import { NEWS_FEEDS } from "./feeds.ts";
import { parseRss } from "./rss.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

test("each news feed returns at least one headline", async () => {
  const rows = await Promise.all(
    NEWS_FEEDS.map(async (feed) => {
      const got = await fetchTextResilient(feed.url, {
        timeoutMs: 12_000,
        headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
      });
      if (!got.ok) return `${feed.source}: ${got.error}`;
      const items = parseRss(got.text, feed.source);
      if (items.length === 0) return `${feed.source}: parsed 0 items`;
      if (!items.some((item) => item.title && item.url.startsWith("http"))) return `${feed.source}: no linked title`;
      return null;
    }),
  );
  assert.deepEqual(rows.filter(Boolean), []);
});
