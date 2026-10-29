import { create } from "zustand";
import type { IslandShapeKind } from "../world/island-shape.ts";
import type { IslandSizeKind } from "../world/island-size.ts";
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

interface LaunchStore {
  readonly chooseWorld: () => void;
  readonly continueWorld: (worldId: string, choice: WorldChoice) => void;
  readonly createWorld: (choice: WorldChoice) => void;
  readonly isChoosingWorld: boolean;
  readonly launch: LaunchOptions;
  readonly relaunch: (changes: LaunchChanges) => void;
  readonly worldId: string;
}

export const useLaunchStore = create<LaunchStore>()((set, get) => {
  function launchWorld(worldId: string, changes: LaunchChanges): void {
    const launch: LaunchOptions = { ...get().launch, ...changes, camera: {}, hours: null, isPaused: false };

    rememberInAddress(launch, worldId);
    set({ isChoosingWorld: false, launch, worldId });
  }

  return {
    chooseWorld: () => {
      replaceAddress(window.location.pathname);
      set({ isChoosingWorld: true });
    },
    continueWorld: (worldId, choice) => {
      launchWorld(worldId, changesOf(choice));
    },
    createWorld: (choice) => {
      launchWorld(createWorldId(), changesOf(choice));
    },
    isChoosingWorld: !choosesWorld(window.location.search),
    launch: readLaunchOptions(window.location.search),
    relaunch: (changes) => {
      launchWorld(get().worldId, changes);
    },
    worldId: initialWorldId(),
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

function rememberInAddress(launch: LaunchOptions, worldId: string): void {
  const parameters = new URLSearchParams({
    name: launch.name,
    quality: launch.quality,
    seed: String(launch.seed),
    shape: launch.shape,
    size: launch.size,
    world: worldId,
  });

  replaceAddress(`?${parameters.toString()}`);
}

export function rememberWorldInAddress(worldId: string): void {
  if (readWorldId(window.location.search) === worldId) {
    return;
  }

  replaceAddress(withWorldId(window.location.search, worldId));
}

function initialWorldId(): string {
  const worldId = readWorldId(window.location.search);

  return worldId === null ? createWorldId() : worldId;
}
