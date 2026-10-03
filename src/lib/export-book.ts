import type { RadarEvent } from "@/data/types";

const EMPTY_TITLE = "Listening to the world tape";

function line(label: string, value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  return `${label}: ${value}`;
}

/** Plain text of one book, safe to copy, download, or print. */
export function bookExportText(event: RadarEvent, now = new Date()): string {
  if (!event.id || event.title === EMPTY_TITLE) return "Ripple Radar\n\nNo active book to export.\n";
  const parts: string[] = ["Ripple Radar", ""];
  parts.push(event.title.trim() || "Untitled book");
  const where = [event.region && event.region !== "—" ? event.region : "", event.theme].filter(Boolean).join(" · ");
  if (where) parts.push(where);
  const scores = [
    event.importance != null ? `Importance ${event.importance}` : "",
    `Tape ${event.probability}%`,
  ].filter(Boolean);
  if (scores.length) parts.push(scores.join(" · "));
  parts.push(`Exported ${now.toISOString()}`);
  parts.push("");
  if (event.summary && !event.summary.startsWith("Don't trade the headline")) {
    parts.push(event.summary.trim(), "");
  }
  if (event.scenarios.length) {
    parts.push("Paths");
    for (const s of [...event.scenarios].sort((a, b) => b.probability - a.probability)) {
      const detail = s.detail?.trim() ? ` — ${s.detail.trim()}` : "";
      parts.push(`- ${s.name} — ${s.probability}%${detail}`);
    }
    parts.push("");
  }
  if (event.nodes.length) {
    parts.push("Map");
    for (const n of [...event.nodes].sort((a, b) => a.level - b.level || a.label.localeCompare(b.label))) {
      parts.push(`- L${n.level} ${n.label}${n.ticker ? ` (${n.ticker})` : ""}`);
    }
    parts.push("");
  }
  if (event.trades.length) {
    parts.push("Names");
    for (const t of event.trades) {
      const hop = t.distance != null ? ` · ${t.distance} hops` : "";
      parts.push(`- ${t.ticker} — ${t.reason}${hop}`);
    }
    parts.push("");
  }
  const weaken = event.invalidation?.filter((s) => s.trim()) ?? [];
  if (weaken.length) {
    parts.push("What would weaken this");
    for (const s of weaken) parts.push(`- ${s.trim()}`);
    parts.push("");
  }
  const note = line("Provenance", event.provenance);
  if (note) parts.push(note, "");
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Light page so the system print dialog can save a PDF. */
export function bookExportHtml(text: string): string {
  const safe = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Ripple Radar</title>
<style>
  body { margin: 2rem; background: #f5f7fa; color: #0d1726; font: 14px/1.45 "Segoe UI", sans-serif; }
  pre { white-space: pre-wrap; font-family: "IBM Plex Mono", Consolas, monospace; font-size: 12px; }
</style></head><body><pre>${safe}</pre></body></html>`;
}
