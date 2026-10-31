import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  document.addEventListener("fullscreenchange", onChange);

  return () => {
    document.removeEventListener("fullscreenchange", onChange);
  };
}

function isFullscreenNow(): boolean {
  return document.fullscreenElement !== null;
}

function switchFullscreen(): Promise<void> {
  if (isFullscreenNow()) {
    return document.exitFullscreen();
  }

  return document.documentElement.requestFullscreen();
}

export function useFullscreen() {
  const isFullscreen = useSyncExternalStore(subscribe, isFullscreenNow);

  function toggleFullscreen(): void {
    switchFullscreen().catch((error: unknown) => {
      console.warn("Full screen is not available here", error);
    });
  }

  return {
    canGoFullscreen: document.fullscreenEnabled,
    isFullscreen,
    label: isFullscreen ? "Leave full screen" : "Full screen",
    toggleFullscreen,
  };
}
