import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readTacticalBook } from "./book.ts";

const ASSETS = ["NQ", "ES", "GC", "CL"];
const METRICS = ["sharpe", "max_drawdown", "profit_factor", "trade_count", "total_pnl"] as const;

describe("tactical book", () => {
  const book = readTacticalBook();

  it("is the sealed 2015–2022 / 2023–2026 book", () => {
    assert.equal(book.schema, "tactical-book-v1");
    assert.equal(book.tuned_on_test, false);
    assert.equal(book.windows.train.start, "2015-01-01");
    assert.equal(book.windows.train.end, "2022-12-31");
    assert.equal(book.windows.test.start, "2023-01-01");
    assert.ok(book.windows.test.end >= "2026-01-01");
    assert.ok(book.as_of >= book.windows.test.start);
  });

  it("covers the four futures and refuses a crude carry sleeve", () => {
    assert.deepEqual(Object.keys(book.contracts).sort(), [...ASSETS].sort());
    assert.equal(book.models.carry.assets.CL.available, false);
    assert.ok(book.data.cl_2020_04_20_dollar_change !== null && book.data.cl_2020_04_20_dollar_change < -50_000);
  });

  it("publishes the dollar metrics for every sleeve that was actually run", () => {
    for (const [name, model] of Object.entries(book.models)) {
      for (const asset of ASSETS) {
        const row = model.assets[asset];
        assert.ok(row, `${name} ${asset}`);
        if (!row.available) continue;
        for (const window of [row.in_sample, row.out_of_sample]) {
          assert.ok(window, `${name} ${asset}`);
          for (const key of METRICS) {
            assert.ok(key in window, `${name} ${asset} ${key}`);
          }
          assert.equal(typeof window.trade_count, "number");
          assert.equal(typeof window.max_drawdown, "number");
        }
        assert.ok(row.in_sample!.end <= "2022-12-31");
        assert.ok(row.out_of_sample!.start >= "2023-01-01");
      }
      assert.equal(typeof model.book.out_of_sample.sharpe, "number");
    }
  });

  it("names the papers the rules come from", () => {
    const ids = book.citations.map((row) => row.id);
    for (const id of ["mop2012", "amp2013", "kmpv2018", "mm2017", "mrt2010"]) {
      assert.ok(ids.includes(id), id);
    }
  });
});
