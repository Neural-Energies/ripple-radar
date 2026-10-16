/**
 * Finance-headline scorer in the style of the Loughran–McDonald dictionaries.
 *
 * A headline is tokenized, negation in a three-token window flips the hit,
 * and a preceding intensifier raises its weight. The score is
 * (positive − negative) / (positive + negative), in [−1, 1]. No hits means
 * the headline is unscored — it is not treated as neutral.
 *
 * This is a real word list and a real counting rule. It is not the Notre Dame
 * master spreadsheet, and it does not invent a score when nothing matched.
 */

const POSITIVE = [
  "approval", "approved", "beat", "beats", "boom", "boost", "boosted", "boosts",
  "bullish", "buyback", "climb", "climbed", "climbs", "dividend", "dovish",
  "easing", "expand", "expansion", "gain", "gained", "gains", "growth",
  "improve", "improved", "improvement", "jump", "jumped", "jumps", "optimistic",
  "outperform", "profit", "profits", "profitable", "profitability", "rally",
  "rallied", "rallies", "rebound", "rebounded", "rebounds", "recover",
  "recovers", "recovery", "resilient", "resilience", "rise", "rises", "rose",
  "soar", "soared", "soars", "stimulus", "strengthen", "strengthened", "strong",
  "stronger", "success", "successful", "surge", "surged", "surges", "upgrade",
  "upgraded", "upside",
];

const NEGATIVE = [
  "attack", "attacked", "attacks", "bankrupt", "bankruptcy", "bearish",
  "blockade", "closed", "closure", "concern", "concerned", "concerns", "crash",
  "crashed", "crashes", "crisis", "default", "deficit", "delay", "delayed",
  "disruption", "downgrade", "downgraded", "downturn", "explosion", "fail",
  "failed", "failure", "fall", "falls", "fear", "fears", "fell", "fraud",
  "gloom", "halt", "halted", "hawkish", "hike", "hikes", "inflation",
  "invasion", "investigation", "layoff", "layoffs", "liquidation", "loss",
  "losses", "missile", "missiles", "miss", "missed", "misses", "outage",
  "pessimistic", "plunge", "plunged", "plunges", "plummet", "plummets",
  "pressure", "pressures", "probe", "recession", "rout", "sanction",
  "sanctions", "shortage", "shutdown", "slide", "slides", "slid", "slump",
  "slumped", "slumps", "sank", "sink", "sinks", "sunk", "threat", "threats",
  "tightening", "tumble", "tumbles", "tumbled", "uncertain", "uncertainty",
  "unemployment", "volatile", "volatility", "warning", "warned", "warns",
  "weak", "weaker", "weakness", "worry", "worried", "worries",
];

const PHRASES: { tokens: string[]; sign: 1 | -1 }[] = [
  { tokens: ["rate", "cut"], sign: 1 },
  { tokens: ["rate", "cuts"], sign: 1 },
  { tokens: ["risk", "on"], sign: 1 },
  { tokens: ["better", "than", "expected"], sign: 1 },
  { tokens: ["beats", "estimates"], sign: 1 },
  { tokens: ["all", "time", "high"], sign: 1 },
  { tokens: ["record", "high"], sign: 1 },
  { tokens: ["rate", "hike"], sign: -1 },
  { tokens: ["rate", "hikes"], sign: -1 },
  { tokens: ["risk", "off"], sign: -1 },
  { tokens: ["sell", "off"], sign: -1 },
  { tokens: ["worse", "than", "expected"], sign: -1 },
  { tokens: ["misses", "estimates"], sign: -1 },
  { tokens: ["job", "cuts"], sign: -1 },
  { tokens: ["lay", "offs"], sign: -1 },
  { tokens: ["higher", "for", "longer"], sign: -1 },
  { tokens: ["record", "low"], sign: -1 },
  { tokens: ["all", "time", "low"], sign: -1 },
];

const NEGATIONS = new Set(["no", "not", "none", "never", "neither", "nor", "without", "hardly", "barely"]);
const INTENSIFIERS = new Set([
  "sharply", "dramatically", "significantly", "extremely", "massively", "steeply",
  "unexpectedly", "substantially", "very",
]);

const POS = new Set(POSITIVE);
const NEG = new Set(NEGATIVE);

export function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/n't\b/g, " not ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function negated(tokens: string[], index: number): boolean {
  const from = Math.max(0, index - 3);
  for (let i = from; i < index; i += 1) if (NEGATIONS.has(tokens[i]!)) return true;
  return false;
}

function weightAt(tokens: string[], index: number): number {
  return index > 0 && INTENSIFIERS.has(tokens[index - 1]!) ? 1.5 : 1;
}

/** Sentiment in [−1, 1], or null when the headline contains no lexicon hit. */
export function lexiconSentiment(title: string): number | null {
  const tokens = tokenize(title);
  if (tokens.length === 0) return null;
  const consumed = new Set<number>();
  let pos = 0;
  let neg = 0;

  const add = (index: number, sign: 1 | -1, weight: number) => {
    const flipped = negated(tokens, index) ? -sign : sign;
    if (flipped > 0) pos += weight;
    else neg += weight;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    for (const phrase of PHRASES) {
      const n = phrase.tokens.length;
      if (i + n > tokens.length) continue;
      let match = true;
      for (let k = 0; k < n; k += 1) {
        if (tokens[i + k] !== phrase.tokens[k]) {
          match = false;
          break;
        }
      }
      if (!match) continue;
      add(i, phrase.sign, weightAt(tokens, i));
      for (let k = 0; k < n; k += 1) consumed.add(i + k);
      i += n - 1;
      break;
    }
  }

  for (let i = 0; i < tokens.length; i += 1) {
    if (consumed.has(i)) continue;
    const word = tokens[i]!;
    if (POS.has(word)) add(i, 1, weightAt(tokens, i));
    else if (NEG.has(word)) add(i, -1, weightAt(tokens, i));
  }

  const total = pos + neg;
  if (total === 0) return null;
  const score = (pos - neg) / total;
  return Math.max(-1, Math.min(1, score));
}
