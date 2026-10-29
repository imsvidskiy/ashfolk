import { useEngineStore } from "../../app/engine-store.ts";
import { GameSession } from "../../game/game-session.ts";
import { LocalSimulationConnection } from "../../game/testing/local-session.ts";
import { DEFAULT_WORLD_REQUEST } from "../../generation/generation-options.ts";
import { ignore } from "../../shared/ignore.ts";
import type { SavedWorldState } from "../../simulation/saved-world.ts";
import { Simulation } from "../../simulation/simulation.ts";
import { createVegetatedWorld } from "../../simulation/testing/test-world.ts";
import { createSimulationWorkerApi } from "../../workers/simulation-worker-api.ts";
import { startTestEngine } from "./engine-fixtures.ts";

export const UNCHANGED_HEIGHT = 100;
export const CHANGED_HEIGHT = 140;

const TEST_DIMENSIONS = { cellSize: 10, cellsPerSide: 64 };

interface LoadedWorldOptions {
  readonly isSavedPaused?: boolean;
  readonly regrownHeight: number;
}

interface LoadedWorld {
  readonly saved: SavedWorldState;
  readonly session: GameSession;
}

function islandAt(height: number): Simulation {
  return new Simulation(
    createVegetatedWorld({
      dimensions: TEST_DIMENSIONS,
      heightAt: () => {
        return height;
      },
    })
  );
}

async function loadedWorld({ isSavedPaused = false, regrownHeight }: LoadedWorldOptions): Promise<LoadedWorld> {
  const api = createSimulationWorkerApi(() => {
    return islandAt(UNCHANGED_HEIGHT);
  });

  api.createWorld(DEFAULT_WORLD_REQUEST, ignore);

  if (isSavedPaused) {
    api.advance(0, [{ isPaused: true, type: "setPaused" }]);
  }

  const saved = api.saveWorld();

  if (saved === null) {
    throw new Error("The test world was busy");
  }

  const connection = new LocalSimulationConnection(
    createSimulationWorkerApi(
      () => {
        return islandAt(regrownHeight);
      },
      () => {
        return islandAt(regrownHeight);
      }
    )
  );

  return { saved, session: await GameSession.load(connection, saved) };
}

export async function startLoadedWorld(options: LoadedWorldOptions): Promise<LoadedWorld> {
  const { engine } = await startTestEngine();
  const loaded = await loadedWorld(options);

  useEngineStore.setState({ status: { engine: { ...engine, session: loaded.session }, kind: "ready" } });

  return loaded;
}
