import type { EvidenceItem, RadarEvent } from "@/data/types";
import type { LiveHeadline } from "@/lib/live/types";
import { fingerprintTitle } from "@/lib/live/evidence";
import { storyRole, type StoryRole } from "./event-intel";

const NAME_STOP = new Set([
  "category",
  "tracking",
  "maps",
  "the",
  "and",
  "off",
  "into",
  "from",
  "after",
  "with",
  "over",
  "near",
  "along",
  "pacific",
  "mexico",
  "coast",
  "storm",
  "update",
  "live",
]);

/** Published locations. Used only when a story actually names the place. */
const PLACES: {
  id: string;
  name: string;
  kind: "port" | "refinery" | "city";
  lat: number;
  lon: number;
  aliases: string[];
}[] = [
  { id: "manzanillo", name: "Port of Manzanillo", kind: "port", lat: 19.054, lon: -104.318, aliases: ["manzanillo"] },
  { id: "lazaro", name: "Port of Lázaro Cárdenas", kind: "port", lat: 17.955, lon: -102.179, aliases: ["lazaro cardenas", "lázaro cárdenas", "lazaro cárdenas"] },
  { id: "salina", name: "Salina Cruz refinery", kind: "refinery", lat: 16.167, lon: -95.203, aliases: ["salina cruz"] },
  { id: "acapulco", name: "Acapulco", kind: "city", lat: 16.853, lon: -99.823, aliases: ["acapulco"] },
];

export type Prov = "observed" | "official" | "supported" | "model" | "hypothesis";

export interface IntelNode {
  id: string;
  label: string;
  provenance: Prov;
  why: string;
  cite?: string;
  placeId?: string;
  children: IntelNode[];
}

export interface NamedPlace {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lon: number;
  cite: string;
}

export interface StoryView {
  id: string;
  title: string;
  source: string;
  url: string;
  at: number;
  role: StoryRole;
  official: boolean;
  material: boolean;
  reprints: { source: string; title: string; url: string; at: number }[];
}

export interface PageIntel {
  name: string;
  basin: string | null;
  stories: StoryView[];
  independentSources: number;
  reprints: number;
  latestMaterialAt: number;
  tree: IntelNode;
  places: NamedPlace[];
  /** Instruments deliberately left off because no story names a facility or a market. */
  omitted: string[];
  watching: { what: string; confirms: string; weakens: string }[];
  invalidation: string[];
}

function capKind(kind: string): string {
  if (kind.toLowerCase() === "tropical storm") return "Tropical storm";
  return kind[0]!.toUpperCase() + kind.slice(1).toLowerCase();
}

export function canonicalName(titles: string[]): string {
  const blob = titles.join(" \n ");
  const re = /\b(hurricane|typhoon|cyclone|tropical storm)\s+([A-Za-z]{3,})\b/gi;
  for (const m of blob.matchAll(re)) {
    const name = m[2]!.toLowerCase();
    if (NAME_STOP.has(name)) continue;
    const proper = name[0]!.toUpperCase() + name.slice(1);
    const kind = capKind(m[1]!);
    if (/pacific/i.test(blob) && /mexico/i.test(blob)) return `${kind} ${proper} — Eastern Pacific`;
    return `${kind} ${proper}`;
  }
  const cleaned = titles
    .map((t) =>
      t
        .replace(/^(u\.n\.\s+live updates:\s*|live updates:\s*|breaking:\s*|watch:\s*|analysis:\s*|opinion:\s*|maps:\s*)/i, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .sort((a, b) => a.length - b.length)[0];
  return cleaned || "Untitled event";
}

function officialSource(source: string, title: string): boolean {
  return /\b(nhc|noaa|nws|smn|conagua)\b/i.test(`${source} ${title}`);
}

function materialRole(role: StoryRole, official: boolean): boolean {
  if (role === "reprint") return false;
  return official || role === "escalation" || role === "de-escalation" || role === "second-order" || role === "market";
}

function roleOf(title: string, duplicate: boolean): StoryRole {
  return storyRole({ headline: title, duplicateOf: duplicate ? "x" : undefined });
}

export function pageIntel(event: RadarEvent, headlines: LiveHeadline[] = []): PageIntel {
  const linked = headlines.filter((h) => h.eventIds.includes(event.id));
  const raw = linked.length
    ? linked.map((h) => ({
        id: h.id,
        title: h.title,
        source: h.source,
        url: h.url,
        at: h.eventTimeMs || h.published,
      }))
    : event.evidence.map((e) => ({
        id: e.id,
        title: e.headline,
        source: e.source,
        url: e.url ?? "",
        at: e.eventTimeMs,
        duplicateOf: e.duplicateOf,
      }));

  const titles = [event.title, ...raw.map((r) => r.title)];
  const name = canonicalName(titles);
  const byFp = new Map<string, typeof raw>();
  for (const row of [...raw].sort((a, b) => b.at - a.at)) {
    const fp = fingerprintTitle(row.title);
    const list = byFp.get(fp) ?? [];
    list.push(row);
    byFp.set(fp, list);
  }
  const stories: StoryView[] = [];
  for (const group of byFp.values()) {
    const lead = group[0]!;
    const dup = "duplicateOf" in lead && lead.duplicateOf;
    const role = roleOf(lead.title, Boolean(dup));
    const official = officialSource(lead.source, lead.title);
    stories.push({
      id: lead.id,
      title: lead.title,
      source: lead.source,
      url: lead.url,
      at: lead.at,
      role: role === "reprint" ? "confirmation" : role,
      official,
      material: materialRole(role, official),
      reprints: group.slice(1).map((r) => ({ source: r.source, title: r.title, url: r.url, at: r.at })),
    });
  }
  stories.sort((a, b) => b.at - a.at);

  const blob = titles.join(" \n ");
  const basin = /pacific/i.test(blob) && /mexico/i.test(blob) ? "Eastern Pacific, off Mexico" : null;
  const places = placesNamed(blob, stories);
  const tree = buildTree(name, stories, places, basin);
  const omitted = omittedInstruments(blob, places);
  const materialTimes = stories.filter((s) => s.material).map((s) => s.at);
  const latestMaterialAt = materialTimes.length ? Math.max(...materialTimes) : 0;
  const sources = new Set(stories.map((s) => s.source.toLowerCase()));

  return {
    name,
    basin,
    stories,
    independentSources: sources.size,
    reprints: stories.reduce((n, s) => n + s.reprints.length, 0),
    latestMaterialAt,
    tree,
    places,
    omitted,
    watching: watches(name, places, stories),
    invalidation: kills(name, stories),
  };
}

function placesNamed(blob: string, stories: StoryView[]): NamedPlace[] {
  const hay = blob.toLowerCase();
  const out: NamedPlace[] = [];
  for (const p of PLACES) {
    if (!p.aliases.some((a) => hay.includes(a))) continue;
    const cite = stories.find((s) => p.aliases.some((a) => s.title.toLowerCase().includes(a)))?.title;
    if (!cite) continue;
    out.push({ id: p.id, name: p.name, kind: p.kind, lat: p.lat, lon: p.lon, cite });
  }
  return out;
}

function omittedInstruments(blob: string, places: NamedPlace[]): string[] {
  const namedEnergy = places.some((p) => p.kind === "refinery");
  const saysCrude = /\b(crude|oil|pemex|refinery|barrel)\b/i.test(blob);
  const saysAg = /\b(crop|wheat|corn|fertilizer|harvest)\b/i.test(blob);
  const saysShip = places.some((p) => p.kind === "port") || /\b(port closure|port suspend|freight|vessel)\b/i.test(blob);
  const skip = ["VLO", "CL", "MOS", "RB", "BWET", "TIP", "INSW"];
  // Keep a ticker only when a story names it, or a named facility of that kind exists.
  const keep = new Set<string>();
  if (/\bVLO\b|\bValero\b/i.test(blob)) keep.add("VLO");
  if (namedEnergy && saysCrude) keep.add("CL");
  if (saysAg) keep.add("MOS");
  if (/\bRB\b/.test(blob)) keep.add("RB");
  if (saysShip && /\b(BWET|INSW)\b/.test(blob)) {
    if (/\bBWET\b/.test(blob)) keep.add("BWET");
    if (/\bINSW\b/.test(blob)) keep.add("INSW");
  }
  return skip.filter((t) => !keep.has(t));
}

function buildTree(name: string, stories: StoryView[], places: NamedPlace[], basin: string | null): IntelNode {
  const intensity = stories.find((s) => /\b(intensif|category|strengthen|weaken|explod)/i.test(s.title));
  const track =
    stories.find((s) => /\b(not expected to|no landfall|recurve)\b/i.test(s.title)) ??
    stories.find((s) => /\b(track|landfall|coast|path|cone)\b/i.test(s.title));
  const children: IntelNode[] = [];
  if (intensity) {
    children.push({
      id: "intensity",
      label: "Storm intensity",
      provenance: intensity.official ? "official" : "observed",
      why: "A story in this cluster reports the storm's strength. That is the observation, not a market.",
      cite: intensity.title,
      children: [],
    });
  }
  if (track) {
    const offshore = /\bnot expected to|no landfall|recurve\b/i.test(track.title);
    children.push({
      id: "track",
      label: offshore ? "Track — not expected to come ashore" : "Track / coastal language",
      provenance: track.official ? "official" : "observed",
      why: offshore
        ? "A story already says the storm is not expected to make landfall. That weakens infrastructure exposure."
        : "A story mentions the track or the coast. No forecast cone is in the feed, so this is not a measured intersection.",
      cite: track.title,
      children: [],
    });
  }
  if (places.length) {
    children.push({
      id: "places",
      label: "Named places",
      provenance: "supported",
      why: "These places are named in a story. Coordinates are the published location of the place, not a distance to the storm.",
      children: places.map((p) => ({
        id: p.id,
        label: p.name,
        provenance: "supported" as const,
        why: `Named in a story. ${p.kind}. No operating status is in the feed.`,
        cite: p.cite,
        placeId: p.id,
        children: [],
      })),
    });
  } else {
    children.push({
      id: "no-facility",
      label: "No named port, refinery, or crop region",
      provenance: "hypothesis",
      why: basin
        ? `Stories place this in ${basin}. That is not enough to attach a refinery, a fertilizer name, or a shipping equity. No facility is in the path until a story or an official cone says so.`
        : "No story names a facility, a port, or a crop region. No instrument is attached.",
      children: [],
    });
  }
  return {
    id: "event",
    label: name,
    provenance: "observed",
    why: `${stories.length} distinct wordings in this cluster. The event is the storm, not an article headline.`,
    children,
  };
}

function watches(name: string, places: NamedPlace[], stories: StoryView[]): { what: string; confirms: string; weakens: string }[] {
  const rows = [
    {
      what: `Next official update on ${name}`,
      confirms: "Advisory raises intensity or moves the track onto a named coast.",
      weakens: "Advisory keeps the storm offshore or lowers the intensity.",
    },
  ];
  if (places.length) {
    for (const p of places) {
      rows.push({
        what: `${p.name} operating status`,
        confirms: "The authority suspends or restricts operations.",
        weakens: "The authority says operations are normal.",
      });
    }
  } else {
    rows.push({
      what: "A named port, refinery, or platform",
      confirms: "A story or authority names a specific facility and a restriction.",
      weakens: "No facility is named and the storm stays offshore.",
    });
  }
  if (!stories.some((s) => s.role === "market")) {
    rows.push({
      what: "A market print tied to a named facility",
      confirms: "Crude, products, or freight move after a named disruption, not before one.",
      weakens: "Prices move with no named physical hit. That is not confirmation.",
    });
  }
  return rows;
}

function kills(name: string, stories: StoryView[]): string[] {
  const rows = [
    `${name} stays offshore of any named port or refinery.`,
    "Intensity falls, or the official track moves away from the coast the stories mention.",
  ];
  if (stories.some((s) => /\bnot expected to|no landfall\b/i.test(s.title))) {
    rows.unshift("A story already says landfall is not expected. A disruption thesis needs a new, named physical hit.");
  }
  rows.push("Exposed facilities, once named, report normal operations.");
  return rows;
}

export function flattenTree(node: IntelNode): IntelNode[] {
  return [node, ...node.children.flatMap(flattenTree)];
}

export type { EvidenceItem };
