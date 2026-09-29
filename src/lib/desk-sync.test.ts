/**
 * Private research stays with its account, and concurrent saves cannot erase
 * each other (PR #5 B03).
 *
 * Isolation runs the real store against a real (in-memory) Storage; the
 * concurrency tests run two simulated devices through the real save loop
 * against the real compare-and-swap SQL in PGLite.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  get length() {
    return this.map.size;
  }
}
const storage = new MemoryStorage();
// Only `localStorage`: a global `window` makes PGLite assume a browser.
(globalThis as unknown as { localStorage: unknown }).localStorage = storage;

const { EMPTY_DESK, readPartition, snapshotDesk, switchIdentity, useApp } = await import("./store.ts");
const { CLEAN_SYNC, GUEST_DESK_KEY, deskKey, importGuest, isEmptyDesk, mergeDesk, planLoad } = await import("./desk-merge.ts");
const { pushDesk } = await import("./desk-push.ts");
const { loadDeskFor, saveDeskFor } = await import("./desk-store.server.ts");
type Desk = typeof EMPTY_DESK;
type Sql = import("./db.ts").Sql;

const desk = (over: Partial<Desk> = {}): Desk => ({ ...EMPTY_DESK, ...over });
const book = (id: string) => ({ id, title: id, region: "US", note: "", created: "2026-09-29" });

// -------------------------------------------------------------- isolation --

test("account A's desk is not visible to B after sign-out and sign-in", () => {
  storage.clear();
  switchIdentity("user-a");
  useApp.getState().addDeskBook(book("a-private"));
  assert.equal(readPartition(deskKey("user-a"))?.desk.deskBooks[0]?.id, "a-private");

  switchIdentity(null); // sign out
  assert.equal(useApp.getState().deskBooks.length, 0, "signing out clears A's books from memory");

  switchIdentity("user-b"); // new account on the same browser
  assert.equal(useApp.getState().deskBooks.length, 0, "B does not see A's books");
  useApp.getState().createWatchlist("b list");
  assert.equal(readPartition(deskKey("user-a"))?.desk.deskBooks[0]?.id, "a-private", "A's partition untouched");
  assert.ok(!readPartition(deskKey("user-a"))?.desk.watchlists.some((w) => w.name === "b list"));
});

test("a new account with no cloud desk uploads nothing it did not create", () => {
  storage.clear();
  switchIdentity(null);
  useApp.getState().addDeskBook(book("guest-book")); // signed-out work
  switchIdentity("user-new");
  const state = useApp.getState();
  const plan = planLoad(snapshotDesk(state), state.sync, null);
  assert.equal(plan.save, false, "an untouched account partition saves nothing");
  assert.equal(plan.desk.deskBooks.length, 0);
  // Importing the signed-out desk is explicit, and only then does it arrive.
  const guest = readPartition(GUEST_DESK_KEY)!;
  assert.ok(!isEmptyDesk(guest.desk));
  const imported = importGuest(snapshotDesk(state), guest.desk);
  assert.deepEqual(imported.deskBooks.map((b) => b.id), ["guest-book"]);
});

test("unsynced work survives a reload: dirty flag and base are persisted per partition", () => {
  storage.clear();
  switchIdentity("user-a");
  useApp.getState().setSync({ version: 3, base: desk(), dirty: true });
  useApp.getState().addDeskBook(book("offline-edit"));
  switchIdentity(null);
  switchIdentity("user-a"); // "reload"
  const state = useApp.getState();
  assert.equal(state.sync.dirty, true);
  assert.equal(state.sync.version, 3);
  // The cloud copy moved on meanwhile; the offline edit is merged, not overwritten.
  const remote = { desk: desk({ deskBooks: [book("from-other-device")] }), version: 4 };
  const plan = planLoad(snapshotDesk(state), state.sync, remote);
  assert.equal(plan.save, true);
  assert.deepEqual(plan.desk.deskBooks.map((b) => b.id).sort(), ["from-other-device", "offline-edit"]);
});

// ------------------------------------------------------------------ merge --

test("three-way merge keeps both sides' additions, local deletions and local edits", () => {
  const base = desk({
    watchlists: [{ id: "w", name: "Energy", tickers: ["XLE"] }],
    alerts: [{ id: "old", title: "old", detail: "", kind: "price", active: true, created: "x" }],
  });
  const local = desk({
    watchlists: [{ id: "w", name: "Energy", tickers: ["XLE", "USO"] }],
    alerts: [],
    deskBooks: [book("local")],
  });
  const remote = desk({
    watchlists: [{ id: "w", name: "Energy", tickers: ["XLE", "CVX"] }],
    alerts: [{ id: "old", title: "old", detail: "", kind: "price", active: true, created: "x" }],
    deskBooks: [book("remote")],
  });
  const merged = mergeDesk(base, local, remote);
  assert.deepEqual(merged.watchlists[0]!.tickers.sort(), ["CVX", "USO", "XLE"]);
  assert.equal(merged.alerts.length, 0, "a local deletion wins over an untouched remote row");
  assert.deepEqual(merged.deskBooks.map((b) => b.id).sort(), ["local", "remote"]);
});

// ------------------------------------------------------ concurrent devices --

async function db(): Promise<Sql> {
  const pg = new PGlite();
  const dir = join(process.cwd(), "migrations");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(join(dir, f), "utf8"));
  }
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((acc, part, i) => acc + (i ? `$${i}` : "") + part, "");
    return (await pg.query(text, values)).rows;
  }) as Sql;
  sql.query = async (text: string, params?: unknown[]) => (await pg.query(text, params)).rows as never;
  return sql;
}

/** A device: its own desk and sync meta, saving to the shared database. */
function device(sql: Sql, userId: string, start: { desk: Desk; version: number }) {
  let local = structuredClone(start.desk);
  let sync: import("./desk-merge.ts").SyncMeta = { version: start.version, base: structuredClone(start.desk), dirty: false };
  let signedIn = true;
  return {
    get desk() {
      return local;
    },
    edit(f: (d: Desk) => Desk) {
      local = f(structuredClone(local));
      sync = { ...sync, dirty: true };
    },
    signOut() {
      signedIn = false;
    },
    push: (save = (d: Desk, v: number) => saveDeskFor(sql, userId, d, v)) =>
      pushDesk({
        desk: () => local,
        sync: () => sync,
        setSync: (s) => (sync = s),
        replace: (d) => (local = d),
        save,
        current: () => signedIn,
      }),
    get sync() {
      return sync;
    },
  };
}

test("two devices from one snapshot: both devices' additions survive", async () => {
  const sql = await db();
  assert.deepEqual(await saveDeskFor(sql, "u", desk(), 0), { ok: true, version: 1 });
  const start = (await loadDeskFor(sql, "u"))!;
  const laptop = device(sql, "u", start);
  const phone = device(sql, "u", start);

  laptop.edit((d) => ({ ...d, watchlists: d.watchlists.map((w) => (w.id === "d1" ? { ...w, tickers: ["XLE"] } : w)) }));
  phone.edit((d) => ({
    ...d,
    watchlists: d.watchlists.map((w) => (w.id === "d1" ? { ...w, tickers: ["TLT"] } : w)),
    deskBooks: [book("phone-book")],
  }));

  assert.equal(await laptop.push(), "saved");
  assert.equal(await phone.push(), "saved", "the stale save is merged and retried, not lost");

  const final = (await loadDeskFor(sql, "u"))!;
  assert.deepEqual(final.desk.watchlists.find((w) => w.id === "d1")!.tickers.sort(), ["TLT", "XLE"]);
  assert.deepEqual(final.desk.deskBooks.map((b) => b.id), ["phone-book"]);
  assert.equal(final.version, 3);
});

test("a stale base version is rejected with the current copy", async () => {
  const sql = await db();
  await saveDeskFor(sql, "u", desk(), 0);
  await saveDeskFor(sql, "u", desk({ deskBooks: [book("v2")] }), 1);
  const stale = await saveDeskFor(sql, "u", desk({ deskBooks: [book("overwrite")] }), 1);
  assert.equal(stale.ok, false);
  assert.ok(!stale.ok && stale.conflict && stale.version === 2 && stale.desk.deskBooks[0]!.id === "v2");
  assert.deepEqual((await loadDeskFor(sql, "u"))!.desk.deskBooks.map((b) => b.id), ["v2"]);
});

test("one user's saves never touch another user's row, and bad payloads are refused", async () => {
  const sql = await db();
  await saveDeskFor(sql, "alice", desk({ deskBooks: [book("alice")] }), 0);
  await saveDeskFor(sql, "bob", desk({ deskBooks: [book("bob")] }), 0);
  assert.deepEqual((await loadDeskFor(sql, "alice"))!.desk.deskBooks.map((b) => b.id), ["alice"]);
  assert.deepEqual((await loadDeskFor(sql, "bob"))!.desk.deskBooks.map((b) => b.id), ["bob"]);
  const bad = await saveDeskFor(sql, "alice", { watchlists: "nope" }, 1);
  assert.ok(!bad.ok && !bad.conflict);
});

test("a reply that arrives after sign-out changes nothing", async () => {
  const sql = await db();
  await saveDeskFor(sql, "a", desk(), 0);
  const start = (await loadDeskFor(sql, "a"))!;
  const dev = device(sql, "a", start);
  dev.edit((d) => ({ ...d, deskBooks: [book("x")] }));
  const before = dev.sync;
  const outcome = await dev.push(async (d, v) => {
    const reply = await saveDeskFor(sql, "a", d, v);
    dev.signOut(); // the identity changes while the request is in flight
    return reply;
  });
  assert.equal(outcome, "stale");
  assert.equal(dev.sync, before, "sync metadata was not advanced for the next identity");
});

test("an outage keeps the change dirty so it is retried, never dropped", async () => {
  const sql = await db();
  await saveDeskFor(sql, "a", desk(), 0);
  const dev = device(sql, "a", (await loadDeskFor(sql, "a"))!);
  dev.edit((d) => ({ ...d, deskBooks: [book("during-outage")] }));
  await assert.rejects(() => dev.push(async () => Promise.reject(new Error("network down"))));
  assert.equal(dev.sync.dirty, true);
  assert.equal(await dev.push(), "saved", "the retry saves it once the network is back");
  assert.deepEqual((await loadDeskFor(sql, "a"))!.desk.deskBooks.map((b) => b.id), ["during-outage"]);
});

test("the clean sync metadata is a fresh object per partition", () => {
  assert.deepEqual(CLEAN_SYNC, { version: 0, base: null, dirty: false });
});
