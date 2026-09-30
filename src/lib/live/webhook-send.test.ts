/**
 * Webhook delivery refuses a public name that resolves to a private address,
 * on the connection itself (PR #5 B02 follow-up).
 */
import assert from "node:assert/strict";
import type { LookupAddress } from "node:dns";
import { test } from "node:test";
import { guardedLookup, isPublicAddress, postWebhook } from "./webhook-send.server.ts";

test("only globally routable unicast addresses are public", () => {
  for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "2a00:1450:4001:82a::200e", "::ffff:8.8.8.8"]) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
  for (const ip of [
    "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1",
    "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "192.0.2.5",
    "::1", "::", "fe80::1", "fd00::1", "fc00::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
    "2001:db8::1", "2002:0a00:0001::1", "64:ff9b::a00:1", "not-an-ip",
  ]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  // Just outside a private block is public.
  assert.equal(isPublicAddress("172.32.0.1"), true);
  assert.equal(isPublicAddress("100.128.0.1"), true);
});

function resolver(addresses: LookupAddress[]) {
  return (_host: string, _opts: { all: true }, cb: (err: NodeJS.ErrnoException | null, a: LookupAddress[]) => void) => cb(null, addresses);
}

function run(lookup: ReturnType<typeof guardedLookup>, options: { all?: boolean; family?: number }) {
  return new Promise<{ err: NodeJS.ErrnoException | null; address: unknown }>((resolve) =>
    lookup("hooks.example.com", options, (err, address) => resolve({ err, address })),
  );
}

test("the lookup refuses when any resolved address is private, and passes public ones through", async () => {
  const pub = guardedLookup(resolver([{ address: "93.184.216.34", family: 4 }]));
  assert.equal((await run(pub, {})).address, "93.184.216.34");
  assert.deepEqual((await run(pub, { all: true })).address, [{ address: "93.184.216.34", family: 4 }]);

  const mixed = guardedLookup(resolver([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }]));
  assert.equal((await run(mixed, { all: true })).err?.code, "EBLOCKED");

  const meta = guardedLookup(resolver([{ address: "169.254.169.254", family: 4 }]));
  assert.equal((await run(meta, {})).err?.code, "EBLOCKED");
});

test("a webhook whose name resolves to loopback is never connected to", async () => {
  const toLoopback = guardedLookup(resolver([{ address: "127.0.0.1", family: 4 }]));
  await assert.rejects(
    postWebhook("https://hooks.example.com/x", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, toLoopback),
    (e: NodeJS.ErrnoException) => e.code === "EBLOCKED",
  );
});
