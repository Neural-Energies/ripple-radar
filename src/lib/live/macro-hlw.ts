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
export function parseHlwRstar(buf: Buffer): { value: number; date: string } | null {
  const strings = sharedStrings(zipEntry(buf, "xl/sharedStrings.xml"));
  const sheet = zipEntry(buf, "xl/worksheets/sheet2.xml");
  let last: { value: number; date: string } | null = null;
  for (const row of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [...row[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)];
    let serial: number | null = null;
    let rstar: number | null = null;
    for (const cell of cells) {
      const col = cell[1];
      const value = cell[3]?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (!col || value == null) continue;
      const text = cell[2]?.includes('t="s"') ? strings[Number(value)] : value;
      if (col === "A") {
        const n = Number(text);
        if (Number.isFinite(n)) serial = n;
      }
      if (col === "K") {
        const n = Number(text);
        if (Number.isFinite(n)) rstar = n;
      }
    }
    if (serial != null && rstar != null) last = { value: rstar, date: excelDate(serial) };
  }
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
