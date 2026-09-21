/**
 * Model routing + process-local budgets (v0).
 * Behind RIPPLE_MODEL_ROUTING=1. Pure route() + BudgetGate with injectable clock.
 * No fake calibrated probabilities. Soft-news never reaches LLM (gate in relevance.ts).
 */

export type RouteTask =
  | "judge"
  | "analyze"
  | "narrative"
  | "rescore"
  | "ensemble_probe";

export type ModelClass = "rules" | "cheap" | "deep";

export type BudgetDenyReason =
  | "no_key"
  | "cooldown"
  | "concurrency"
  | "daily_cap"
  | "offline";

export interface RoutePlan {
  task: RouteTask;
  class: ModelClass;
  model: string | null;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  schemaVersion: string;
  allowEnsemble: boolean;
}

export interface BudgetDecision {
  allow: boolean;
  reason?: BudgetDenyReason;
  retryAfterMs?: number;
}

export interface RouteContext {
  hasXaiKey: boolean;
  budgetOk: boolean;
  offline?: boolean;
  /** Logical model ids from env; may be identical until a cheap SKU exists. */
  cheapModel?: string;
  deepModel?: string;
}

const ANALYZE_GAP_MS = 45_000;
const RESCORE_GAP_MS = 90_000;

const DEFAULT_CHEAP = "grok-4.5";
const DEFAULT_DEEP = "grok-4.5";

/** Feature flag — OFF keeps today's analyze/rescore behavior unchanged. */
export function isModelRoutingEnabled(): boolean {
  return process.env.RIPPLE_MODEL_ROUTING === "1";
}

export function modelIdsFromEnv(): { cheapModel: string; deepModel: string } {
  return {
    cheapModel: process.env.RIPPLE_MODEL_CHEAP?.trim() || DEFAULT_CHEAP,
    deepModel: process.env.RIPPLE_MODEL_DEEP?.trim() || DEFAULT_DEEP,
  };
}

export function routeContextFromEnv(overrides?: Partial<RouteContext>): RouteContext {
  const ids = modelIdsFromEnv();
  return {
    hasXaiKey: Boolean(process.env.XAI_API_KEY?.trim()),
    budgetOk: true,
    offline: false,
    cheapModel: ids.cheapModel,
    deepModel: ids.deepModel,
    ...overrides,
  };
}

export function route(task: RouteTask, ctx: RouteContext): RoutePlan {
  const cheap = ctx.cheapModel ?? DEFAULT_CHEAP;
  const deep = ctx.deepModel ?? DEFAULT_DEEP;
  const offline = Boolean(ctx.offline) || !ctx.hasXaiKey || !ctx.budgetOk;

  if (offline) {
    return {
      task,
      class: "rules",
      model: null,
      maxTokens: 0,
      temperature: 0,
      timeoutMs: 0,
      schemaVersion: schemaFor(task),
      allowEnsemble: false,
    };
  }

  switch (task) {
    case "judge":
      return {
        task,
        class: "cheap",
        model: cheap,
        maxTokens: 600,
        temperature: 0.15,
        timeoutMs: 8_000,
        schemaVersion: "cluster-judge/v0",
        allowEnsemble: true,
      };
    case "ensemble_probe":
      return {
        task,
        class: "cheap",
        model: cheap,
        maxTokens: 600,
        temperature: 0.2,
        timeoutMs: 8_000,
        schemaVersion: "cluster-judge/v0",
        allowEnsemble: false,
      };
    case "narrative":
      return {
        task,
        class: "cheap",
        model: cheap,
        maxTokens: 700,
        temperature: 0.2,
        timeoutMs: 8_000,
        schemaVersion: "narrative/v0",
        allowEnsemble: false,
      };
    case "analyze":
      return {
        task,
        class: "deep",
        model: deep,
        maxTokens: 2400,
        temperature: 0.25,
        timeoutMs: 28_000,
        schemaVersion: "analyze/v0",
        allowEnsemble: false,
      };
    case "rescore":
      return {
        task,
        class: "deep",
        model: deep,
        maxTokens: 700,
        temperature: 0.2,
        timeoutMs: 25_000,
        schemaVersion: "rescore/v0",
        allowEnsemble: false,
      };
  }
}

function gapMs(task: RouteTask): number {
  if (task === "analyze") return ANALYZE_GAP_MS;
  if (task === "rescore") return RESCORE_GAP_MS;
  if (task === "judge" || task === "ensemble_probe") return 3_000;
  return 5_000;
}

function schemaFor(task: RouteTask): string {
  switch (task) {
    case "judge":
    case "ensemble_probe":
      return "cluster-judge/v0";
    case "analyze":
      return "analyze/v0";
    case "rescore":
      return "rescore/v0";
    case "narrative":
      return "narrative/v0";
  }
}

/** Process-local budget gate; injectable clock for tests. */
export class BudgetGate {
  private lastAccept = new Map<string, number>();
  private inFlight = 0;

  constructor(private readonly clock: () => number = () => Date.now()) {}

  allow(task: RouteTask, key: string, ctx: RouteContext, now = this.clock()): BudgetDecision {
    if (ctx.offline) return { allow: false, reason: "offline" };
    if (!ctx.hasXaiKey) return { allow: false, reason: "no_key" };
    if (!ctx.budgetOk) return { allow: false, reason: "daily_cap" };
    if (this.inFlight >= 1) return { allow: false, reason: "concurrency", retryAfterMs: 500 };

    const gap = gapMs(task);
    const prev = this.lastAccept.get(`${task}:${key}`) ?? 0;
    if (now - prev < gap) {
      return { allow: false, reason: "cooldown", retryAfterMs: gap - (now - prev) };
    }
    return { allow: true };
  }

  /** Call only after a successful model accept (not on timeout/parse fail). */
  markAccepted(task: RouteTask, key: string, now = this.clock()): void {
    this.lastAccept.set(`${task}:${key}`, now);
  }

  beginFlight(): void {
    this.inFlight += 1;
  }

  endFlight(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  /** Test helper — clear process-local state. */
  reset(): void {
    this.lastAccept.clear();
    this.inFlight = 0;
  }
}

/** Shared process-local gate used by analyze / rescore when the flag is on. */
export const defaultBudgetGate = new BudgetGate();
