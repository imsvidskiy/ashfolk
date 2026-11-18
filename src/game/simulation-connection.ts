import { proxy, type Remote, releaseProxy, transfer, wrap } from "comlink";
import type { GenerationProgress, WorldRequest } from "../generation/generation-options.ts";
import { buffersWithin } from "../shared/buffers.ts";
import { ignore } from "../shared/ignore.ts";
import type { SimulationCommand } from "../simulation/commands.ts";
import type { InitialWorld, SimulationFrame } from "../simulation/frame.ts";
import type { LoadedWorld, SavedWorldState } from "../simulation/saved-world.ts";
import type { SimulationWorkerApi } from "../workers/simulation-worker-api.ts";

export interface SimulationConnection {
  advance: (realSeconds: number, commandTimes?: readonly number[]) => Promise<SimulationFrame>;
  createWorld: (request: WorldRequest, onProgress: (progress: GenerationProgress) => void) => Promise<InitialWorld>;
  dispose: () => void;
  loadWorld: (saved: SavedWorldState, onProgress: (progress: GenerationProgress) => void) => Promise<LoadedWorld>;
  saveWorld: () => Promise<SavedWorldState | null>;
  send: (command: SimulationCommand) => void;
}

export class WorkerSimulationConnection implements SimulationConnection {
  readonly #commands: SimulationCommand[] = [];
  readonly #pending = new Set<(error: Error) => void>();
  readonly #remote: Remote<SimulationWorkerApi>;
  readonly #worker: Worker;
  #failure: Error | null = null;

  constructor() {
    this.#worker = new Worker(new URL("../workers/simulation-worker.ts", import.meta.url), {
      name: "simulation",
      type: "module",
    });
    this.#remote = wrap<SimulationWorkerApi>(this.#worker);

    this.#worker.addEventListener(
      "error",
      (event) => {
        const message = event instanceof ErrorEvent ? event.message : "The simulation worker could not load";

        this.#stop(new Error(message));
      },
      { once: true }
    );
  }

  advance(realSeconds: number, commandTimes?: readonly number[]): Promise<SimulationFrame> {
    return this.#request(() => {
      return this.#remote.advance(realSeconds, this.#commands.splice(0), commandTimes);
    });
  }

  createWorld(request: WorldRequest, onProgress: (progress: GenerationProgress) => void): Promise<InitialWorld> {
    return this.#request(() => {
      this.#commands.length = 0;

      return this.#remote.createWorld(request, proxy(onProgress));
    });
  }

  loadWorld(saved: SavedWorldState, onProgress: (progress: GenerationProgress) => void): Promise<LoadedWorld> {
    return this.#request(() => {
      const sent = transfer(saved, buffersWithin(saved));

      this.#commands.length = 0;

      return this.#remote.loadWorld(sent, proxy(onProgress));
    });
  }

  saveWorld(): Promise<SavedWorldState | null> {
    return this.#request(() => {
      return this.#remote.saveWorld();
    });
  }

  dispose(): void {
    this.#stop(new Error("The simulation connection was closed"));
  }

  send(command: SimulationCommand): void {
    if (this.#failure === null) {
      this.#commands.push(command);
    }
  }

  async #request<Value>(start: () => Promise<Value>): Promise<Value> {
    if (this.#failure !== null) {
      throw this.#failure;
    }

    let stop: (error: Error) => void = ignore;

    const response = new Promise<Value>((resolve, reject) => {
      stop = reject;
      this.#pending.add(stop);

      start().then(resolve, reject);
    });

    try {
      return await response;
    } finally {
      this.#pending.delete(stop);
    }
  }

  #stop(error: Error): void {
    if (this.#failure !== null) {
      return;
    }

    this.#failure = error;
    this.#commands.length = 0;

    for (const reject of this.#pending) {
      reject(error);
    }

    this.#pending.clear();
    this.#remote[releaseProxy]();
    this.#worker.terminate();
  }
}
