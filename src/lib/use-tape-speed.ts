import { useEffect, useRef } from "react";

/** Ticker speed in pixels per second. Constant regardless of how many items are on the tape. */
export const TAPE_PX_PER_SECOND = 35;

/**
 * Sets the tape's animation duration from its real width so it scrolls at a
 * steady TAPE_PX_PER_SECOND. The track holds two copies and moves by half.
 * Reduced motion still wins: the stylesheet's !important rule overrides this.
 */
export function useTapeSpeed<T extends HTMLElement>(deps: unknown[] = []) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      const distance = el.scrollWidth / 2;
      if (distance > 0) el.style.animationDuration = `${Math.max(20, distance / TAPE_PX_PER_SECOND).toFixed(1)}s`;
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
