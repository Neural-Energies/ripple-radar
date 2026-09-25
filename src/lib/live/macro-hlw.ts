import { inflateRawSync } from "node:zlib";
import { excelDate } from "./macro-models.ts";

function zipEntry(buf: Buffer, name: string): string {
  let i = 0;
  while (i + 30 < buf.length) {
    if (buf.readUInt32LE(i) !== 0x04034b50) break;
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const fileName = buf.subarray(i + 30, i + 30 + nameLen).toString();
    const start = i + 30 + nameLen + extraLen;
    const compressed = buf.subarray(start, start + compSize);
    if (fileName === name) {
      const raw = method === 0 ? compressed : inflateRawSync(compressed);
      return raw.toString("utf8");
    }
    i = start + compSize;
  }
  throw new Error(`Missing ${name}`);
}

function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const block of xml.matchAll(/<si[\s>][\s\S]*?<\/si>/g)) {
    const texts = [...block[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1] ?? "");
    out.push(texts.join(""));
  }
  return out;
}

/** Latest one-sided US r* from the NY Fed Holston–Laubach–Williams workbook. */
/** The section header naming the natural rate, and the country column under it. */
const RSTAR_SECTION = /natural\s*rate/i;
const US_COLUMN = /^(us|united states)$/i;

/**
 * r* has been between roughly −1% and 6% across every country and quarter the
 * NY Fed publishes. A value outside that is not a natural rate; it is a
 * different column. The guard is deliberately wide — it is there to catch a
 * layout change, not to police the estimate.
 */
const PLAUSIBLE_RSTAR = { lo: -2, hi: 8 };

type Cell = { col: string; text: string };

function cellsOf(rowXml: string, strings: string[]): Cell[] {
  const out: Cell[] = [];
  // The alternation matters. A header row is full of empty styled cells
  // written self-closing — `<c r="D5" s="15"/>` — and a pattern that only
  // knows `<c ...>…</c>` treats one of those as an OPENING tag, then scans
  // forward to the next real `</c>` and pairs the wrong column with the wrong
  // value. That silently shifted "Natural Rate (r*)" from column K to column
  // H here, which is exactly the class of mistake this parser exists to
  // prevent.
  for (const cell of rowXml.matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = cell[1] ?? "";
    const col = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
    const raw = cell[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    if (!col || raw == null) continue;
    out.push({ col, text: /\bt="s"/.test(attrs) ? (strings[Number(raw)] ?? "") : raw });
  }
  return out;
}

/**
 * Which column holds the US natural rate, read from the sheet's own headers.
 *
 * The workbook lays four sections side by side — trend growth, other
 * determinants, the natural rate, the output gap — each with a US / Canada /
 * Euro Area triple beneath it. Today the US natural rate is column K.
 *
 * Hardcoding K is the bug this replaces. It is right until the NY Fed adds a
 * country or reorders a section, and then it silently returns Canada's r*, or
 * an output gap, straight into the Taylor rule — a wrong policy stance on
 * screen with nothing to indicate it. Reading the headers instead means a
 * layout change makes this return null, and the caller renders the absence.
 */
export function rstarColumn(sheet: string, strings: string[]): string | null {
  const rows = [...sheet.matchAll(/<row[^>]*?r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)];
  for (let i = 0; i < rows.length; i += 1) {
    const section = cellsOf(rows[i]![2] ?? "", strings).find((c) => RSTAR_SECTION.test(c.text));
    if (!section) continue;
    // The country row is the next one down; its US cell sits in the section's
    // own column, because each section header is above its first country.
    //
    // Bounded by ROW NUMBER, not by array position. Empty rows are omitted
    // from the sheet XML entirely, so "the next entry in the list" can be
    // twenty rows lower — and a "US" cell that far down is data, not a header.
    const headerRow = Number(rows[i]![1]);
    for (const below of rows.slice(i + 1)) {
      const rowNumber = Number(below[1]);
      if (!Number.isFinite(rowNumber) || rowNumber - headerRow > 2) break;
      const hit = cellsOf(below[2] ?? "", strings).find(
        (c) => c.col === section.col && US_COLUMN.test(c.text.trim()),
      );
      if (hit) return section.col;
    }
  }
  return null;
}

/** Latest one-sided US r* from the NY Fed Holston–Laubach–Williams workbook. */
export function parseHlwRstar(buf: Buffer): { value: number; date: string } | null {
  const strings = sharedStrings(zipEntry(buf, "xl/sharedStrings.xml"));
  const sheet = zipEntry(buf, "xl/worksheets/sheet2.xml");
  const column = rstarColumn(sheet, strings);
  // No column means the layout moved. Returning null is the whole point: the
  // caller drops the policy rule rather than printing someone else's number.
  if (!column) return null;
  let last: { value: number; date: string } | null = null;
  for (const row of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    let serial: number | null = null;
    let rstar: number | null = null;
    for (const cell of cellsOf(row[1] ?? "", strings)) {
      const n = Number(cell.text);
      if (!Number.isFinite(n)) continue;
      if (cell.col === "A") serial = n;
      if (cell.col === column) rstar = n;
    }
    if (serial != null && rstar != null) last = { value: rstar, date: excelDate(serial) };
  }
  if (!last) return null;
  if (last.value < PLAUSIBLE_RSTAR.lo || last.value > PLAUSIBLE_RSTAR.hi) return null;
  return last;
}

export async function loadHlwRstar(): Promise<{ value: number; date: string } | null> {
  const res = await fetch(
    "https://www.newyorkfed.org/medialibrary/media/research/economists/williams/data/Holston_Laubach_Williams_current_estimates.xlsx",
    { headers: { "User-Agent": "AlphaRecon" }, signal: AbortSignal.timeout(20000) },
  );
  if (!res.ok) return null;
  return parseHlwRstar(Buffer.from(await res.arrayBuffer()));
}
