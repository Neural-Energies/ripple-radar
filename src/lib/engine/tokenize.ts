export const STOP = new Set(
  `a an the and or of to for in on at by from with as is was are be it this that those these into over under about after before than then so not no nor if but while during without within per via vs v its their his her they we you i our your also more most other such same just only very can could would should may might will shall been being have has had do does did get got news says say said after over amid as new first last one two three four five six seven eight nine ten pct percent %`.split(
    /\s+/,
  ),
);

export function hid(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

export function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/[^a-z0-9$%.\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t.length > 2 && !STOP.has(t) && !/^\d+$/.test(t));
}

export function bigrams(toks: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < toks.length - 1; i++) out.push(toks[i] + " " + toks[i + 1]);
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

const PROPER_SKIP = new Set([
  "The",
  "A",
  "An",
  "And",
  "For",
  "With",
  "From",
  "After",
  "Over",
  "Under",
  "Into",
  "Near",
  "New",
  "Live",
  "Update",
  "Breaking",
  "Why",
  "How",
  "What",
  "When",
]);

export function properPhrases(title: string): string[] {
  const words = title.replace(/[—–]/g, " ").split(/\s+/);
  const phrases: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    const clean = buf.filter((w) => !PROPER_SKIP.has(w));
    if (clean.length >= 1) {
      const p = clean.join(" ").replace(/[^A-Za-z0-9 .-]/g, "").trim();
      if (p.length >= 3) phrases.push(p);
    }
    buf = [];
  };
  for (const w of words) {
    const core = w.replace(/[^A-Za-z0-9.-]/g, "");
    if (!core) {
      flush();
      continue;
    }
    const isProper = /^[A-Z][A-Za-z0-9.-]+$/.test(core) || /^[A-Z]{2,5}$/.test(core);
    if (isProper) buf.push(core);
    else flush();
  }
  flush();
  return phrases;
}
