import { useSyncExternalStore } from "react";

export const COMPACT_QUERY = "(max-width: 767px), (max-height: 599px)";
export const TOUCH_QUERY = "(pointer: coarse)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const PORTRAIT_QUERY = "(orientation: portrait)";

type Subscribe = (onChange: () => void) => () => void;

const subscribers = new Map<string, Subscribe>();

function subscriberFor(query: string): Subscribe {
  const existing = subscribers.get(query);

  if (existing !== undefined) {
    return existing;
  }

  function subscribe(onChange: () => void): () => void {
    const mediaList = window.matchMedia(query);

    mediaList.addEventListener("change", onChange);

    return () => {
      mediaList.removeEventListener("change", onChange);
    };
  }

  subscribers.set(query, subscribe);

  return subscribe;
}

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscriberFor(query),
    () => {
      return window.matchMedia(query).matches;
    },
    () => {
      return false;
    }
  );
}

export function useIsCompact(): boolean {
  return useMediaQuery(COMPACT_QUERY);
}

export function useIsTouch(): boolean {
  return useMediaQuery(TOUCH_QUERY);
}

export function useShouldReduceMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}

export function useIsPortrait(): boolean {
  return useMediaQuery(PORTRAIT_QUERY);
}
