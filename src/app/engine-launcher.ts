import { readSavedWorld } from "../features/saves/save-database.ts";
import { useSavesStore } from "../features/saves/saves-store.ts";
import type { EngineHandle } from "../game/engine-handle.ts";
import { readFilming } from "../game/filming.ts";
import type { GameEngine } from "../game/game-engine.ts";
import type { GameSession } from "../game/game-session.ts";
import type { WorldSource } from "../game/open-session.ts";
import {
  DEFAULT_GENERATION_OPTIONS,
  type GenerationProgress,
  type GenerationStage,
  type IslandSketch,
} from "../generation/generation-options.ts";
import { toError } from "../shared/errors.ts";
import { ignore } from "../shared/ignore.ts";
import { islandDimensions } from "../world/island-size.ts";
import type { LaunchOptions } from "./launch-options.ts";

export type LoadingStage = GenerationStage | "lighting" | "waking";

export type EngineStatus =
  | { readonly engine: EngineHandle; readonly kind: "ready" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "graphicsLost"; readonly saved: Promise<unknown> }
  | { readonly island: IslandSketch | null; readonly kind: "loading"; readonly stage: LoadingStage }
  | { readonly kind: "stopped"; readonly message: string };

type EngineStatusListener = (status: EngineStatus) => void;

export const WAKING_STATUS: EngineStatus = { island: null, kind: "loading", stage: "waking" };

function loadGameEngine() {
  return import("../game/game-engine.ts");
}

function loadSessionOpener() {
  return import("../game/open-session.ts");
}

export function loadHud() {
  return import("./hud.tsx");
}

export function preloadGame(): Promise<unknown> {
  return Promise.all([loadGameEngine(), loadSessionOpener(), loadHud()]);
}

export function reportStop(session: GameSession, onStatus: EngineStatusListener): void {
  session.subscribeToStatus((status) => {
    if (status.kind === "failed") {
      onStatus({ kind: "stopped", message: status.error.message });
    }
  });
}

export function reportGraphicsLost(
  engine: Pick<GameEngine, "graphicsLost" | "stop">,
  isCurrent: () => boolean,
  onStatus: EngineStatusListener
): void {
  engine.graphicsLost.then(() => {
    if (!isCurrent()) {
      return;
    }

    engine.stop();

    const saved = useSavesStore.getState().saveNow();

    onStatus({ kind: "graphicsLost", saved });
  });
}

export async function worldSourceFor(launch: LaunchOptions, worldId: string): Promise<WorldSource> {
  const saved = await readSavedWorld(worldId);

  if (saved === null) {
    return {
      kind: "new",
      request: {
        options: { ...DEFAULT_GENERATION_OPTIONS, dimensions: islandDimensions(launch.size), shape: launch.shape },
        seed: launch.seed,
      },
    };
  }

  return { journal: saved.journal, kind: "saved", state: saved.state };
}

function createCanvas(container: HTMLElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");

  canvas.className = "block size-full touch-none select-none outline-none";
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "The island");
  container.append(canvas);

  return canvas;
}

function applyLaunchTime(engine: GameEngine, launch: LaunchOptions): void {
  if (launch.hours !== null) {
    engine.session.send({ hours: launch.hours, type: "setHours" });
  }

  if (launch.isPaused) {
    engine.session.send({ isPaused: true, type: "setPaused" });
  }
}

export class EngineLauncher {
  readonly #canvas: HTMLCanvasElement;
  readonly #onStatus: EngineStatusListener;
  readonly #opening = new AbortController();
  #engine: GameEngine | null = null;
  #island: IslandSketch | null = null;
  #session: Promise<GameSession> | null = null;
  #state: "canceled" | "running" | "starting" = "starting";

  constructor(container: HTMLElement, launch: LaunchOptions, worldId: string, onStatus: EngineStatusListener) {
    this.#canvas = createCanvas(container);
    this.#onStatus = onStatus;
    this.#onStatus(WAKING_STATUS);
    queueMicrotask(() => {
      this.#startUnlessCanceled(launch, worldId);
    });
  }

  cancel(): void {
    this.#state = "canceled";
    this.#opening.abort();

    if (this.#engine !== null) {
      this.#engine.dispose();
      this.#engine = null;
    }

    this.#canvas.remove();
  }

  #startUnlessCanceled(launch: LaunchOptions, worldId: string): void {
    if (this.#state === "canceled") {
      return;
    }

    this.#start(launch, worldId).catch((error: unknown) => {
      this.#fail(error);
    });
  }

  async #start(launch: LaunchOptions, worldId: string): Promise<void> {
    const [{ openSession }, world] = await Promise.all([loadSessionOpener(), worldSourceFor(launch, worldId)]);

    let markGrowing = ignore;
    const isGrowing = new Promise<void>((resolve) => {
      markGrowing = resolve;
    });
    const session = openSession(
      world,
      (progress) => {
        markGrowing();
        this.#reportProgress(progress);
      },
      this.#opening.signal
    );

    this.#session = session;
    session.then(() => {
      this.#reportStage("lighting");
    }, ignore);

    await Promise.race([isGrowing, session]);

    const [engineModule] = await Promise.all([loadGameEngine(), loadHud()]);

    const engine = await engineModule.GameEngine.start({
      camera: launch.camera,
      canvas: this.#canvas,
      quality: launch.quality,
      session,
    });

    if (this.#state === "canceled") {
      engine.dispose();

      return;
    }

    this.#run(engine, launch);
  }

  #run(engine: GameEngine, launch: LaunchOptions): void {
    this.#state = "running";
    this.#engine = engine;
    applyLaunchTime(engine, launch);

    if (import.meta.env.DEV) {
      Reflect.set(window, "ashfolk", engine);
      engine.filming.set(readFilming(window.location.search));
    }

    reportStop(engine.session, (status) => {
      engine.stop();
      this.#onStatus(status);
    });
    this.#onStatus({ engine, kind: "ready" });
    reportGraphicsLost(
      engine,
      () => {
        return this.#engine === engine;
      },
      this.#onStatus
    );
  }

  #reportProgress({ island, stage }: GenerationProgress): void {
    this.#island = island;
    this.#reportStage(stage);
  }

  #reportStage(stage: LoadingStage): void {
    if (this.#state !== "starting") {
      return;
    }

    this.#onStatus({ island: this.#island, kind: "loading", stage });
  }

  #fail(error: unknown): void {
    this.#opening.abort();
    this.#session?.then((opened) => {
      opened.close();
    }, ignore);
    console.error("Ashfolk could not start", error);

    if (this.#state === "canceled") {
      return;
    }

    this.#onStatus({ kind: "failed", message: toError(error).message });
  }
}
