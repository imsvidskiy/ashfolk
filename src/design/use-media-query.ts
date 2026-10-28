import { useSyncExternalStore } from "react";

type Subscribe = (onChange: () => void) => () => void;

export const COMPACT_QUERY = "(max-width: 767px), (max-height: 599px)";
export const TOUCH_QUERY = "(pointer: coarse)";
const CALM_QUERY = "(prefers-reduced-motion: reduce)";
const PORTRAIT_QUERY = "(orientation: portrait)";

const subscribers = new Map<string, Subscribe>();

function subscriberFor(query: string): Subscribe {
  const existing = subscribers.get(query);

  if (existing !== undefined) {
    return existing;
  }

  function subscribe(onChange: () => void): () => void {
    const mediaList = window.matchMedia(query);

    mediaList.addEventListener("change", onChange);

    return () => mediaList.removeEventListener("change", onChange);
  }

  subscribers.set(query, subscribe);

  return subscribe;
}

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscriberFor(query),
    () => window.matchMedia(query).matches,
    () => false
  );
}

export function useIsCompact(): boolean {
  return useMediaQuery(COMPACT_QUERY);
}

export function usePrefersCalm(): boolean {
  return useMediaQuery(CALM_QUERY);
}

export function useIsPortrait(): boolean {
  return useMediaQuery(PORTRAIT_QUERY);
}
