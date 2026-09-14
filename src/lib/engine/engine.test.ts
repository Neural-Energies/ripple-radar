import assert from "node:assert/strict";
import { test } from "node:test";
import { familyOf } from "./extract.ts";
import { buildCausalGraph } from "./graph.ts";
import { gameTheoryFor, playersFor, questionsFor, scenariosFor } from "./hypothesize.ts";
import { tagsFromText, themeFromTags, toneOf } from "./ontology.ts";

/**
 * Generalization fixtures. Named events here are TEST DATA only.
 * Production compose/graph/hypothesize must not special-case any of them.
 */
const FIXTURES = [
  {
    id: "geo",
    text: "Overnight attack on a major Middle East crude pipeline; loadings delayed and tanker insurance quotes jump.",
    family: "physical",
  },
  {
    id: "credit",
    text: "Uninsured deposit run at a $40bn US regional bank; emergency funding window rumors.",
    family: "credit",
  },
  {
    id: "tech",
    text: "New export-license rules on leading-edge semiconductor equipment shipments take effect next month.",
    family: "tech",
  },
  {
    id: "weather",
    text: "Category 4 hurricane is 48 hours from landfall over the US Gulf Coast refining belt.",
    family: "weather",
  },
  {
    id: "policy",
    text: "FedWatch 50 basis-point hike probability jumps to 90 percent into this week's FOMC.",
    family: "policy",
  },
] as const;

const UNKNOWN = "Kazakhstan delays uranium export licenses for two quarters after a customs-system outage.";

function book(text: string) {
  const tags = tagsFromText(text);
  const family = familyOf(tags);
  const tone = toneOf(text);
  const graph = buildCausalGraph({ title: text, tags, tone });
  const players = playersFor(["Primary actor"], tags, family);
  const gt = gameTheoryFor({ family, players });
  const scenarios = scenariosFor({ entity: tags[0] ?? "the development", tags, family, tone, hits: 3, esc: 2, de: 0 });
  const questions = questionsFor({
    entity: tags[0] ?? "the development",
    actor: gt.actor,
    counterpart: gt.counterpart,
    headlineTicker: graph.headlineTicker,
    invalidation: graph.links[0]?.invalidation ?? "The constraint eases.",
  });
  return { tags, family, tone, graph, gt, scenarios, questions, theme: themeFromTags(tags) };
}

test("same engine, unrelated fixtures, no event-specific branches", () => {
  const books = FIXTURES.map((f) => ({ ...f, built: book(f.text) }));

  for (const b of books) {
    assert.equal(b.built.family, b.family, `${b.id} family`);
    assert.ok(b.built.graph.nodes.length >= 3, `${b.id} needs a causal graph`);
    assert.ok(b.built.graph.links.length >= 2, `${b.id} needs causal edges`);
    assert.ok(b.built.scenarios.length >= 3, `${b.id} needs distinguishable scenarios`);
    assert.ok(b.built.gt.players.length >= 2, `${b.id} needs discovered players`);
    assert.ok(b.built.graph.trades.length >= 3, `${b.id} needs asset discovery after the graph`);
    assert.ok(b.built.questions.length >= 3, `${b.id} needs research questions`);
    assert.ok(b.built.graph.trades.every((t) => t.causalPath), `${b.id} trades need a causal path`);
    assert.ok(!/hormuz|taiwan strait|red sea|rare earth/i.test(b.built.theme), `${b.id} leaked a fixture theme`);
  }

  const families = new Set(books.map((b) => b.built.family));
  assert.ok(families.size >= 4, "fixtures must land in different families");

  const tickers = books.map((b) => b.built.graph.headlineTicker);
  assert.ok(new Set(tickers).size >= 3, "first-order tickers must differ across event types");

  const insights = books.map((b) => b.built.gt.insight);
  assert.ok(new Set(insights).size >= 3, "game-theory insight must follow the event family");
});

test("unknown event constructs a full book without new production code", () => {
  const built = book(UNKNOWN);
  assert.ok(built.graph.nodes.length >= 2);
  assert.ok(built.scenarios.length >= 3);
  assert.ok(built.gt.players.length >= 2);
  assert.ok(built.graph.trades.length >= 1);
  assert.ok(built.questions.length >= 3);
  assert.ok(built.graph.links.length >= 1);
  assert.ok(!/hormuz/i.test(JSON.stringify(built.gt.players)));
});
