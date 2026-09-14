import type { DeskBook } from "@/data/types";
import type { LiveHeadline, LiveQuote } from "./types";

/** Stable empties for Zustand selectors and overlay fallbacks. Never allocate `[]` inside a selector. */
export const EMPTY_HEADLINES: LiveHeadline[] = [];
export const EMPTY_BOOKS: DeskBook[] = [];
export const EMPTY_QUOTES: Record<string, LiveQuote> = {};
