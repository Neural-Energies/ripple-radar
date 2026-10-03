/**
 * The desktop app points PGLite at a directory. A restart (and an update,
 * which replaces the program files but not this directory) has to see the
 * same rows.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("a PGLite data directory survives close and reopen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ripple-pglite-"));
  try {
    const first = new PGlite({ dataDir: dir });
    await first.waitReady;
    await first.exec("create table if not exists desk_probe (id int primary key, note text)");
    await first.exec("insert into desk_probe (id, note) values (1, 'kept')");
    await first.close();

    const second = new PGlite({ dataDir: dir });
    await second.waitReady;
    const rows = await second.query<{ note: string }>("select note from desk_probe where id = 1");
    assert.equal(rows.rows[0]?.note, "kept");
    await second.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
