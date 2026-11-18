import { create } from "zustand";
import type { IslandShapeKind } from "../world/island-shape.ts";
import type { IslandSizeKind } from "../world/island-size.ts";
import { WAKING_STATUS } from "./engine-launcher.ts";
import { useEngineStore } from "./engine-store.ts";
import {
  choosesWorld,
  createWorldId,
  type LaunchOptions,
  readLaunchOptions,
  readWorldId,
  withWorldId,
} from "./launch-options.ts";

type LaunchChanges = Partial<Pick<LaunchOptions, "name" | "quality" | "seed" | "shape" | "size">>;

export interface WorldChoice {
  readonly name: string;
  readonly seed: number;
  readonly shape: IslandShapeKind;
  readonly size: IslandSizeKind;
}

export interface WorldLaunch {
  readonly options: LaunchOptions;
  readonly savedWorldId: string | null;
}

interface LaunchStore {
  readonly chooseWorld: () => void;
  readonly continueWorld: (worldId: string, choice: WorldChoice) => void;
  readonly createWorld: (choice: WorldChoice) => void;
  readonly isChoosingWorld: boolean;
  readonly launch: LaunchOptions;
  readonly relaunch: (changes: LaunchChanges) => void;
  readonly request: WorldLaunch;
  readonly restoreChoice: (request: WorldLaunch, choice: WorldChoice) => void;
  readonly retryLaunch: () => void;
  readonly worldId: string;
}

export const useLaunchStore = create<LaunchStore>()((set, get) => {
  const initialLaunch = readLaunchOptions(window.location.search);
  const savedWorldId = readWorldId(window.location.search);

  function launchWorld(sourceId: string | null, changes: LaunchChanges): void {
    const worldId = sourceId === null ? createWorldId() : sourceId;
    const launch: LaunchOptions = { ...get().launch, ...changes, camera: {}, hours: null, isPaused: false };

    useEngineStore.getState().setStatus(WAKING_STATUS);
    rememberInAddress(launch, worldId);

    set({ isChoosingWorld: false, launch, request: { options: launch, savedWorldId: sourceId }, worldId });
  }

  return {
    chooseWorld: () => {
      useEngineStore.getState().setStatus(WAKING_STATUS);
      replaceAddress(window.location.pathname);
      set({ isChoosingWorld: true });
    },
    continueWorld: (worldId, choice) => {
      launchWorld(worldId, changesOf(choice));
    },
    createWorld: (choice) => {
      launchWorld(null, changesOf(choice));
    },
    isChoosingWorld: !choosesWorld(window.location.search),
    launch: initialLaunch,
    relaunch: (changes) => {
      launchWorld(get().worldId, changes);
    },
    request: { options: initialLaunch, savedWorldId },
    restoreChoice: (request, choice) => {
      const current = get();

      if (current.isChoosingWorld || current.request !== request) {
        return;
      }

      const launch = { ...request.options, ...changesOf(choice) };

      rememberInAddress(launch, current.worldId, new URLSearchParams(window.location.search));
      set({ launch });
    },
    retryLaunch: () => {
      const { request } = get();

      useEngineStore.getState().setStatus(WAKING_STATUS);
      set({ request: { ...request } });
    },
    worldId: savedWorldId === null ? createWorldId() : savedWorldId,
  };
});

function changesOf({ name, seed, shape, size }: WorldChoice): LaunchChanges {
  return { name, seed, shape, size };
}

function replaceAddress(search: string): void {
  try {
    window.history.replaceState(null, "", search);
  } catch (error) {
    console.warn("The address could not be updated", error);
  }
}

function rememberInAddress(launch: LaunchOptions, worldId: string, parameters = new URLSearchParams()): void {
  for (const [key, value] of Object.entries({ ...changesOf(launch), quality: launch.quality, world: worldId })) {
    parameters.set(key, String(value));
  }

  replaceAddress(`?${parameters.toString()}`);
}

export function rememberWorldInAddress(worldId: string): void {
  if (readWorldId(window.location.search) === worldId) {
    return;
  }

  replaceAddress(withWorldId(window.location.search, worldId));
}
