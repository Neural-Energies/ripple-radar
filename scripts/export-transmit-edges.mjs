/**
 * Export the Ripple graph's asserted transmission edges for measurement.
 *
 * The ontology is the source of truth for WHICH edges exist; the Python
 * calibrator is the source of truth for which of them can be measured and how
 * strongly. This script is the seam between them, so neither side hardcodes
 * the other's list.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const src = readFileSync("src/lib/engine/ontology.ts", "utf8");
const block = src.slice(src.indexOf("export const TRANSMIT"));
const body = block.slice(0, block.indexOf("\n];"));

const edges = [];
const re =
  /\{\s*from:\s*"([^"]+)",\s*to:\s*"([^"]+)",\s*direction:\s*(-?\d+),\s*lag:\s*"([^"]*)",\s*mechanism:\s*"((?:[^"\\]|\\.)*)",\s*confidence:\s*([\d.]+)\s*\}/g;
let m;
while ((m = re.exec(body)) !== null) {
  edges.push({
    from: m[1], to: m[2], direction: Number(m[3]),
    lag: m[4], mechanism: m[5].replace(/\\"/g, '"'), confidence: Number(m[6]),
  });
}

if (edges.length === 0) {
  console.error("export-transmit-edges: parsed 0 edges — the ontology shape changed");
  process.exit(1);
}
mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/transmit_edges.json", JSON.stringify(edges, null, 2));
console.log(`exported ${edges.length} edges -> artifacts/transmit_edges.json`);
