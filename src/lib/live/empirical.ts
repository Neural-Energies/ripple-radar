/** Live contract prices and coded history. No score-grid probabilities. */

export type MarketBucket = "bargain" | "force" | "other";

export interface MarketContract {
  question: string;
  /** Yes-price on an open contract. Implied probability, 0–1. */
  yes: number;
  volumeUsd: number;
  endDate: string | null;
  url: string;
  bucket: MarketBucket;
}

export interface SideShare {
  label: string;
  event: string;
  k: number;
  n: number;
  /** k/n */
  share: number;
  /** (k+0.5)/(n+1), mean of Beta(k+0.5, n-k+0.5). */
  jeffreys: number;
  wilson95: [number, number];
}

export interface HistoryBlock {
  available: boolean;
  citation?: string;
  url?: string;
  window?: [string, string];
  rows?: number;
  diplomaticUnattributed?: number;
  model?: string;
  sides?: SideShare[];
  reason?: string;
}

export interface EmpiricalBook {
  asOf: string;
  bullets: string[];
  contracts: MarketContract[];
  history: HistoryBlock;
  error?: string;
}

export function historyApplies(title: string, actors: string[]): boolean {
  const blob = `${title} ${actors.join(" ")}`.toLowerCase();
  return blob.includes("iran");
}

const FORCE = /\b(invade|invasion|strike|attack|war|blockade|seize|missile)\b/i;
const BARGAIN = /\b(ceasefire|diplomatic|diplomacy|deal|talks|meeting|peace|negotiat|nuclear)\b/i;

export function bucketOf(question: string): MarketBucket {
  const bargain = BARGAIN.test(question);
  const force = FORCE.test(question);
  if (bargain && !force) return "bargain";
  if (force && !bargain) return "force";
  if (bargain) return "bargain";
  return "other";
}

export function formatPct(p: number): string {
  const rounded = Math.round(p * 1000) / 10;
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`;
}

export function formatVolume(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${Math.round(usd / 1_000)}k`;
  return `$${Math.round(usd)}`;
}

export function marketBullets(contracts: MarketContract[]): string[] {
  if (contracts.length === 0) {
    return ["No open Polymarket contract matched this headline."];
  }
  const byVol = (bucket: MarketBucket) =>
    contracts.filter((c) => c.bucket === bucket).sort((a, b) => b.volumeUsd - a.volumeUsd)[0];
  const bargain = byVol("bargain");
  const force = byVol("force");
  const lines: string[] = [];
  if (bargain) {
    lines.push(
      `Bargain, as priced: ${trimQ(bargain.question)} — ${formatPct(bargain.yes)} (${formatVolume(bargain.volumeUsd)} traded).`,
    );
  }
  if (force) {
    lines.push(
      `Force, as priced: ${trimQ(force.question)} — ${formatPct(force.yes)} (${formatVolume(force.volumeUsd)} traded).`,
    );
  }
  if (!bargain && !force) {
    const top = [...contracts].sort((a, b) => b.volumeUsd - a.volumeUsd)[0]!;
    lines.push(`${trimQ(top.question)} — ${formatPct(top.yes)} (${formatVolume(top.volumeUsd)} traded).`);
  }
  lines.push("Separate contracts. They do not add to 100. Yes-price is the implied probability.");
  return lines;
}

function trimQ(q: string): string {
  return q.replace(/\?$/, "");
}
