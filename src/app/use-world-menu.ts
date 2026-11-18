import { useEffect, useRef, useState } from "react";
import { useSavesStore } from "../features/saves/saves-store.ts";
import { useLaunchStore } from "./launch-store.ts";

type StartView = "home" | "new" | "worlds";

function useHasListedWorlds(): boolean {
  const refresh = useSavesStore((state) => {
    return state.refresh;
  });
  const [hasListedWorlds, setHasListedWorlds] = useState(() => {
    return useSavesStore.getState().worlds.length > 0;
  });

  useEffect(() => {
    function showWorlds(): void {
      setHasListedWorlds(true);
    }

    refresh().then(showWorlds, showWorlds);
  }, [refresh]);

  return hasListedWorlds;
}

export function useWorldMenu() {
  const hasListedWorlds = useHasListedWorlds();
  const worlds = useSavesStore((state) => {
    return state.worlds;
  });
  const continueWorld = useLaunchStore((state) => {
    return state.continueWorld;
  });
  const [view, setView] = useState<StartView>("home");
  const newWorldButton = useRef<HTMLButtonElement>(null);
  const worldsButton = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<StartView>("home");

  useEffect(() => {
    if (view !== "home" || returnTo.current === "home") {
      return;
    }

    const button = returnTo.current === "new" ? newWorldButton : worldsButton;

    button.current?.focus({ preventScroll: true });
    returnTo.current = "home";
  }, [view]);

  const latest = worlds.find((world) => {
    return world.isLoadable;
  });

  function handleBack(): void {
    returnTo.current = view;
    setView("home");
  }

  function handleNewWorld(): void {
    setView("new");
  }

  function handleAllWorlds(): void {
    setView("worlds");
  }

  function handleContinue(): void {
    if (latest !== undefined) {
      continueWorld(latest.id, latest);
    }
  }

  return {
    handleAllWorlds,
    handleBack,
    handleContinue,
    handleNewWorld,
    hasListedWorlds,
    hasWorlds: worlds.length > 0,
    latest,
    newWorldButton,
    view,
    worldsButton,
  };
}
