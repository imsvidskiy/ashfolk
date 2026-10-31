import { proxy, type Remote, transfer, wrap } from "comlink";
import type { GenerationProgress, WorldRequest } from "../generation/generation-options.ts";
import { buffersWithin } from "../shared/buffers.ts";
import { ignore } from "../shared/ignore.ts";
import type { SimulationCommand } from "../simulation/commands.ts";
import type { InitialWorld, SimulationFrame } from "../simulation/frame.ts";
import type { LoadedWorld, SavedWorldState } from "../simulation/saved-world.ts";
import type { SimulationWorkerApi } from "../workers/simulation-worker-api.ts";

export interface SimulationConnection {
  advance: (realSeconds: number) => Promise<SimulationFrame>;
  createWorld: (request: WorldRequest, onProgress: (progress: GenerationProgress) => void) => Promise<InitialWorld>;
  dispose: () => void;
  loadWorld: (saved: SavedWorldState, onProgress: (progress: GenerationProgress) => void) => Promise<LoadedWorld>;
  saveWorld: () => Promise<SavedWorldState | null>;
  send: (command: SimulationCommand) => void;
}

function failureOf(worker: Worker): Promise<never> {
  const failure = new Promise<never>((_resolve, reject) => {
    worker.addEventListener(
      "error",
      (event) => {
        reject(new Error(event instanceof ErrorEvent ? event.message : "The simulation worker could not load"));
      },
      { once: true }
    );
  });

  failure.catch(ignore);

  return failure;
}

export class WorkerSimulationConnection implements SimulationConnection {
  readonly #commands: SimulationCommand[] = [];
  readonly #failure: Promise<never>;
  readonly #remote: Remote<SimulationWorkerApi>;
  readonly #worker: Worker;

  constructor() {
    this.#worker = new Worker(new URL("../workers/simulation-worker.ts", import.meta.url), {
      name: "simulation",
      type: "module",
    });
    this.#remote = wrap<SimulationWorkerApi>(this.#worker);
    this.#failure = failureOf(this.#worker);
  }

  advance(realSeconds: number): Promise<SimulationFrame> {
    return this.#raceFailure(this.#remote.advance(realSeconds, this.#commands.splice(0)));
  }

  createWorld(request: WorldRequest, onProgress: (progress: GenerationProgress) => void): Promise<InitialWorld> {
    this.#commands.splice(0);

    return this.#raceFailure(this.#remote.createWorld(request, proxy(onProgress)));
  }

  loadWorld(saved: SavedWorldState, onProgress: (progress: GenerationProgress) => void): Promise<LoadedWorld> {
    this.#commands.splice(0);

    const sent = transfer(saved, buffersWithin(saved));

    return this.#raceFailure(this.#remote.loadWorld(sent, proxy(onProgress)));
  }

  saveWorld(): Promise<SavedWorldState | null> {
    return this.#raceFailure(this.#remote.saveWorld());
  }

  dispose(): void {
    this.#worker.terminate();
  }

  send(command: SimulationCommand): void {
    this.#commands.push(command);
  }

  #raceFailure<Value>(request: Promise<Value>): Promise<Value> {
    return Promise.race([request, this.#failure]);
  }
}
