/**
 * The r* parser must fail closed.
 *
 * It feeds the Taylor rule, and the Taylor rule prints a policy stance. A
 * parser that returns the WRONG number is far worse here than one that returns
 * nothing: nothing renders as an absence, a wrong number renders as a finding.
 *
 * The workbook lays four sections side by side — trend growth, other
 * determinants, the natural rate, the output gap — each with a US / Canada /
 * Euro Area triple under it. An earlier version hardcoded column K. That is
 * correct today and silently wrong the moment the NY Fed adds a country.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { rstarColumn } from "./macro-hlw.ts";

/** A header pair shaped like the real sheet, including the empty styled cells. */
const sheet = (sectionCol: string, usCol: string) =>
  `<row r="5">` +
  `<c r="J5" s="15"/>` +
  `<c r="${sectionCol}5" s="15" t="s"><v>0</v></c>` +
  `<c r="${String.fromCharCode(sectionCol.charCodeAt(0) + 1)}5" s="15"/>` +
  `</row>` +
  `<row r="6">` +
  `<c r="J6" s="2"/>` +
  `<c r="${usCol}6" s="11" t="s"><v>1</v></c>` +
  `<c r="${String.fromCharCode(usCol.charCodeAt(0) + 1)}6" s="11" t="s"><v>2</v></c>` +
  `</row>`;

const STRINGS = ["Natural Rate (r*)", "US", "Canada"];

test("resolves the column from the sheet's own headers", () => {
  assert.equal(rstarColumn(sheet("K", "K"), STRINGS), "K");
  // The same sheet with the section moved — a country inserted upstream.
  assert.equal(rstarColumn(sheet("N", "N"), STRINGS), "N");
});

test("self-closing cells do not shift the column", () => {
  // The bug this guards: `<c r="D5" s="15"/>` is a complete cell, not an
  // opening tag. A parser that pairs it with the next `</c>` reads the section
  // header one column to the LEFT of where it is — which is how "Natural Rate"
  // silently became the "Other Determinants" column against the real file.
  const withGaps =
    `<row r="5"><c r="C5" s="15" t="s"><v>3</v></c><c r="D5" s="15"/><c r="E5" s="15"/>` +
    `<c r="K5" s="15" t="s"><v>0</v></c><c r="L5" s="15"/></row>` +
    `<row r="6"><c r="C6" s="11" t="s"><v>1</v></c><c r="D6" s="11" t="s"><v>2</v></c>` +
    `<c r="K6" s="11" t="s"><v>1</v></c><c r="L6" s="11" t="s"><v>2</v></c></row>`;
  assert.equal(rstarColumn(withGaps, [...STRINGS, "Trend Growth (g), Annualized"]), "K");
});

test("returns null rather than guessing when the layout changes", () => {
  // No section named for the natural rate at all.
  assert.equal(rstarColumn(sheet("K", "K"), ["Output Gap", "US", "Canada"]), null);
  // The section is there, but the column under it is not the US.
  assert.equal(rstarColumn(sheet("K", "K"), ["Natural Rate (r*)", "Canada", "US"]), null);
  // Nothing at all.
  assert.equal(rstarColumn("", STRINGS), null);
});

test("the country row is looked for below the section, not anywhere", () => {
  // A "US" cell in the same column twenty rows down is data, not a header.
  const far =
    `<row r="5"><c r="K5" s="15" t="s"><v>0</v></c></row>` +
    `<row r="25"><c r="K25" s="11" t="s"><v>1</v></c></row>`;
  assert.equal(rstarColumn(far, STRINGS), null);
});
