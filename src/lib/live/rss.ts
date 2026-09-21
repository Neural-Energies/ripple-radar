import { toneOf } from "../engine/ontology.ts";
import { hid } from "../engine/tokenize.ts";
import { stampHeadlineClocks } from "./evidence.ts";
import type { LiveHeadline } from "./types.ts";

function decode(raw: string) {
  const amp = "\u0026";
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(new RegExp(amp + "amp;", "g"), amp)
    .replace(new RegExp(amp + "lt;", "g"), "<")
    .replace(new RegExp(amp + "gt;", "g"), ">")
    .replace(new RegExp(amp + "quot;", "g"), '"')
    .replace(new RegExp(amp + "#39;", "g"), "'")
    .replace(new RegExp(amp + "apos;", "g"), "'")
    .replace(new RegExp(amp + "#(\\d+);", "g"), (_, n) => String.fromCharCode(Number(n)))
    .replace(new RegExp(amp + "nbsp;", "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string) {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i");
  const m = block.match(re);
  return m ? decode(m[1]) : "";
}

export function parseRss(xml: string, fallbackSource: string, nowMs = Date.now()): LiveHeadline[] {
  const chunks = xml.split(/<item[\s>]/i).slice(1);
  const out: LiveHeadline[] = [];
  for (const block of chunks.slice(0, 20)) {
    let title = tag(block, "title");
    const link = tag(block, "link") || tag(block, "guid");
    const pub = tag(block, "pubDate") || tag(block, "published") || tag(block, "updated");
    if (!title) continue;
    let source = fallbackSource;
    const dash = title.lastIndexOf(" - ");
    if (fallbackSource === "Google News" && dash > 12) {
      source = title.slice(dash + 3).trim() || source;
      title = title.slice(0, dash).trim();
    }
    const clocks = stampHeadlineClocks(pub, nowMs);
    out.push({
      id: hid(title + source + String(clocks.published) + link),
      title,
      source,
      url: link,
      ...clocks,
      eventIds: [],
      tone: toneOf(title),
    });
  }
  return out;
}
