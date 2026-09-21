/**
 * Thin stub — NOT wired into src/. Docs-only companion to MODEL-ROUTING-BUDGETS-v0.md.
 * No network calls. No fake calibrated probabilities.
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

const lastAccept = new Map<string, number>();
let inFlight = 0;

export function route(task: RouteTask, ctx: RouteContext): RoutePlan {
  const cheap = ctx.cheapModel ?? "grok-4.5";
  const deep = ctx.deepModel ?? "grok-4.5";
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

export function allow(
  task: RouteTask,
  key: string,
  now: number,
  ctx: RouteContext,
): BudgetDecision {
  if (ctx.offline) return { allow: false, reason: "offline" };
  if (!ctx.hasXaiKey) return { allow: false, reason: "no_key" };
  if (!ctx.budgetOk) return { allow: false, reason: "daily_cap" };
  if (inFlight >= 1) return { allow: false, reason: "concurrency", retryAfterMs: 500 };

  const gap =
    task === "analyze"
      ? ANALYZE_GAP_MS
      : task === "rescore"
        ? RESCORE_GAP_MS
        : task === "judge" || task === "ensemble_probe"
          ? 3_000
          : 5_000;

  const prev = lastAccept.get(`${task}:${key}`) ?? 0;
  if (now - prev < gap) {
    return { allow: false, reason: "cooldown", retryAfterMs: gap - (now - prev) };
  }
  return { allow: true };
}

/** Call only after a successful model accept (not on timeout/parse fail). */
export function markAccepted(task: RouteTask, key: string, now: number): void {
  lastAccept.set(`${task}:${key}`, now);
}

export function beginFlight(): void {
  inFlight += 1;
}

export function endFlight(): void {
  inFlight = Math.max(0, inFlight - 1);
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
