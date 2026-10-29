import {
  DEFAULT_WORLD_REQUEST,
  type GenerationProgress,
  type WorldRequest,
} from "../../generation/generation-options.ts";
import type { SimulationCommand } from "../../simulation/commands.ts";
import type { InitialWorld, SimulationFrame } from "../../simulation/frame.ts";
import type { LoadedWorld, SavedWorldState } from "../../simulation/saved-world.ts";
import type { Simulation } from "../../simulation/simulation.ts";
import { createSimulationWorkerApi, type SimulationWorkerApi } from "../../workers/simulation-worker-api.ts";
import { GameSession } from "../game-session.ts";
import type { SimulationConnection } from "../simulation-connection.ts";

function settle<Value>(run: () => Value): Promise<Value> {
  return new Promise((resolve) => {
    resolve(run());
  });
}

export class LocalSimulationConnection implements SimulationConnection {
  readonly #api: SimulationWorkerApi;
  readonly #commands: SimulationCommand[] = [];

  constructor(api: SimulationWorkerApi) {
    this.#api = api;
  }

  advance(realSeconds: number): Promise<SimulationFrame> {
    return settle(() => {
      return this.#api.advance(realSeconds, this.#commands.splice(0));
    });
  }

  createWorld(request: WorldRequest, onProgress: (progress: GenerationProgress) => void): Promise<InitialWorld> {
    this.#commands.splice(0);

    return settle(() => {
      return this.#api.createWorld(request, onProgress);
    });
  }

  loadWorld(saved: SavedWorldState, onProgress: (progress: GenerationProgress) => void): Promise<LoadedWorld> {
    this.#commands.splice(0);

    return settle(() => {
      return this.#api.loadWorld(saved, onProgress);
    });
  }

  saveWorld(): Promise<SavedWorldState | null> {
    return settle(() => {
      return this.#api.saveWorld();
    });
  }

  dispose(): void {
    this.#commands.splice(0);
  }

  send(command: SimulationCommand): void {
    this.#commands.push(command);
  }
}

export async function createLocalSession(
  simulation: Simulation
): Promise<{ connection: LocalSimulationConnection; session: GameSession }> {
  const connection = new LocalSimulationConnection(
    createSimulationWorkerApi(() => {
      return simulation;
    })
  );
  const session = await GameSession.create(connection, DEFAULT_WORLD_REQUEST);

  return { connection, session };
}
