import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultDeskLayout, moveWidget, parseDeskLayout, toggleWidget } from "./desk-layout.ts";

test("a saved layout keeps order, hidden panels, width, and the trade filter", () => {
  const layout = parseDeskLayout({
    order: { strip: ["vol", "brief"], main: ["trades"], side: ["evidence", "paths"] },
    hidden: ["macro", "nope"],
    sideSpan: 6,
    tradeFilter: "futures",
  });
  assert.deepEqual(layout.order.strip.slice(0, 2), ["vol", "brief"]);
  assert.ok(layout.order.strip.includes("macro"));
  assert.ok(layout.order.main.includes("chain"));
  assert.deepEqual(layout.hidden, ["macro"]);
  assert.equal(layout.sideSpan, 6);
  assert.equal(layout.tradeFilter, "futures");
});

test("hide and move stay inside a column", () => {
  const start = defaultDeskLayout();
  const hidden = toggleWidget(start, "vol");
  assert.ok(hidden.hidden.includes("vol"));
  assert.ok(!toggleWidget(hidden, "vol").hidden.includes("vol"));
  const moved = moveWidget(start, "session", -1);
  assert.equal(moved.order.strip[1], "session");
  assert.equal(moved.order.strip[2], "macro");
  assert.equal(moveWidget(start, "brief", -1), start);
});
