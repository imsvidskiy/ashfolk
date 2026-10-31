import type { GenerationProgress, WorldRequest } from "../generation/generation-options.ts";
import type { ChronicleEntry } from "../simulation/chronicle.ts";
import type { SavedWorldState } from "../simulation/saved-world.ts";
import { GameSession } from "./game-session.ts";
import { type SimulationConnection, WorkerSimulationConnection } from "./simulation-connection.ts";

export type WorldSource =
  | { readonly kind: "new"; readonly request: WorldRequest }
  | { readonly journal: readonly ChronicleEntry[]; readonly kind: "saved"; readonly state: SavedWorldState };

function canceled(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        reject(new Error("Opening the world was canceled"));
      },
      { once: true }
    );
  });
}

function openWorld(
  connection: SimulationConnection,
  world: WorldSource,
  onProgress: (progress: GenerationProgress) => void
): Promise<GameSession> {
  if (world.kind === "saved") {
    return GameSession.load(connection, world.state, { journal: world.journal, onProgress });
  }

  return GameSession.create(connection, world.request, { onProgress });
}

export async function openSession(
  world: WorldSource,
  onProgress: (progress: GenerationProgress) => void,
  signal: AbortSignal
): Promise<GameSession> {
  signal.throwIfAborted();

  const connection = new WorkerSimulationConnection();

  try {
    return await Promise.race([openWorld(connection, world, onProgress), canceled(signal)]);
  } catch (error) {
    connection.dispose();

    throw error;
  }
}
