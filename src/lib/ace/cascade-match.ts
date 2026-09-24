/**
 * Matching an event's actors to a country with a measured cascade.
 *
 * Deliberately a SEPARATE module from `cascade-rates.ts`, which is generated.
 * The first version of this lived appended to the generated file and was wiped
 * the next time the generator ran — the "do not edit by hand" header meant it.
 *
 * The alias table is hand-listed rather than fuzzy on purpose. A wrong match
 * attaches one country's measured cascade to another country's event, which is
 * worse than showing nothing because it reads as evidence. Anything not listed
 * simply does not match.
 */
import { CASCADE_RATES, type CascadeRate } from "./cascade-rates";

const ALIASES: Record<string, string[]> = {
  SY: ["syria", "syrian", "damascus"],
  LE: ["lebanon", "lebanese", "beirut", "hezbollah"],
  GZ: ["gaza", "gazan", "hamas"],
  IR: ["iran", "iranian", "tehran", "irgc"],
  IS: ["israel", "israeli", "idf", "jerusalem", "tel aviv"],
  WE: ["west bank", "ramallah"],
  PK: ["pakistan", "pakistani", "islamabad"],
  ES: ["el salvador", "salvadoran"],
  TU: ["turkey", "turkish", "ankara"],
  AF: ["afghanistan", "afghan", "kabul", "taliban"],
  SO: ["somalia", "somali", "mogadishu", "al-shabaab"],
  UP: ["ukraine", "ukrainian", "kyiv", "kiev"],
  RS: ["russia", "russian", "moscow", "kremlin"],
  TW: ["taiwan", "taiwanese", "taipei"],
  KN: ["north korea", "dprk", "pyongyang"],
  BG: ["bangladesh", "dhaka"],
  IN: ["india", "indian", "new delhi", "kashmir"],
  CU: ["cuba", "cuban", "havana"],
  GR: ["greece", "greek", "athens"],
  RW: ["rwanda", "rwandan", "kigali"],
  NP: ["nepal", "nepali", "kathmandu"],
  NG: ["niger", "nigerien", "niamey"],
  BR: ["brazil", "brazilian", "brasilia"],
};

/**
 * Measured cascades relevant to an event, by its extracted entities.
 *
 * Returns only countries that cleared the gate. An event about somewhere
 * unmeasured returns nothing, and the caller must render that rather than
 * substitute a global average.
 */
export function cascadesForEntities(entities: string[]): CascadeRate[] {
  const hay = entities.map((e) => e.toLowerCase());
  const hit = new Set<string>();
  for (const [code, names] of Object.entries(ALIASES)) {
    if (!CASCADE_RATES[code]) continue;
    if (names.some((n) => hay.some((h) => h === n || h.includes(n)))) hit.add(code);
  }
  return [...hit]
    .map((c) => CASCADE_RATES[c]!)
    .sort((a, b) => b.oosGainOverPoisson - a.oosGainOverPoisson);
}

/** Aliases pointing at a country the current run did not validate. */
export function unmatchedAliases(): string[] {
  return Object.keys(ALIASES).filter((c) => !CASCADE_RATES[c]);
}
