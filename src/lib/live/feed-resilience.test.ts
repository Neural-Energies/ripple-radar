import assert from "node:assert/strict";
import { test } from "node:test";
import {
  backoffMs,
  cacheTtlMs,
  feedStatusNote,
  fetchTextResilient,
  retainList,
  retainRecord,
  shouldRetryHttp,
} from "./feed-resilience.ts";

test("transient HTTP is retried; a missing feed is not", () => {
  assert.equal(shouldRetryHttp(503, 0), true);
  assert.equal(shouldRetryHttp(429, 1), true);
  assert.equal(shouldRetryHttp(null, 0), true);
  assert.equal(shouldRetryHttp(404, 0), false);
  assert.equal(shouldRetryHttp(200, 0), false);
  assert.equal(shouldRetryHttp(503, 2), false);
});

test("backoff grows and stays bounded", () => {
  assert.equal(backoffMs(0), 200);
  assert.equal(backoffMs(1), 400);
  assert.ok(backoffMs(8) <= 2000);
});

test("an empty pull keeps the last non-empty tape and shortens the cache", () => {
  const kept = retainList([{ id: "a" }], []);
  assert.equal(kept.stale, true);
  assert.deepEqual(kept.value, [{ id: "a" }]);
  assert.equal(cacheTtlMs(true) < cacheTtlMs(false), true);

  const fresh = retainList([{ id: "a" }], [{ id: "b" }]);
  assert.equal(fresh.stale, false);
  assert.deepEqual(fresh.value, [{ id: "b" }]);

  const nothing = retainList(null, []);
  assert.equal(nothing.stale, false);
  assert.deepEqual(nothing.value, []);
});

test("an empty quote batch keeps the last prices", () => {
  const kept = retainRecord({ CL: { last: 1 } }, {});
  assert.equal(kept.stale, true);
  assert.equal(kept.value.CL?.last, 1);
  const fresh = retainRecord({ CL: { last: 1 } }, { HG: { last: 2 } });
  assert.equal(fresh.stale, false);
  assert.equal(fresh.value.HG?.last, 2);
});

test("the status line names the outage and does not invent a price", () => {
  const note = feedStatusNote({ stale: true, failed: ["BBC World", "Fed", "Reuters World", "CNBC"] }, { stale: true });
  assert.match(note, /4 feeds down/);
  assert.match(note, /BBC World/);
  assert.match(note, /\+1/);
  assert.match(note, /last good pull/);
  assert.equal(feedStatusNote({ stale: false, failed: [] }, { stale: false }), "");
});

test("fetch retries a 503 then accepts the body", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    if (calls < 3) return new Response("no", { status: 503 });
    return new Response("<rss>ok</rss>", { status: 200 });
  };
  const got = await fetchTextResilient("https://feeds.example/rss", {
    fetchImpl,
    attempts: 3,
    sleep: async () => {},
  });
  assert.equal(got.ok, true);
  if (got.ok) assert.match(got.text, /ok/);
  assert.equal(calls, 3);
});

test("fetch does not retry a 404", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response("missing", { status: 404 });
  };
  const got = await fetchTextResilient("https://feeds.example/gone", {
    fetchImpl,
    attempts: 3,
    sleep: async () => {},
  });
  assert.equal(got.ok, false);
  assert.equal(calls, 1);
});

test("fetch retries a thrown network error", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error("socket hang up");
    return new Response("recovered", { status: 200 });
  };
  const got = await fetchTextResilient("https://feeds.example/rss", {
    fetchImpl,
    attempts: 3,
    sleep: async () => {},
  });
  assert.equal(got.ok, true);
  assert.equal(calls, 2);
});
