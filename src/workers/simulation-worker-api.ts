import { transfer } from "comlink";
import type { GenerationProgress, WorldRequest } from "../generation/generation-options.ts";
import { buffersWithin } from "../shared/buffers.ts";
import type { InitialWorld, SimulationFrame } from "../simulation/frame.ts";
import {
  hasLandChanged,
  type LoadedWorld,
  PLANT_SPECIES_NAMES,
  restoreSavedWorld,
  SAVE_VERSION,
  type SavedWorldState,
  savedWorldStateSchema,
  summarizeWorld,
} from "../simulation/saved-world.ts";
import { Simulation } from "../simulation/simulation.ts";
import { VEGETATION_CHANNELS, type VegetationChannels } from "../world/vegetation-store.ts";
import { withSmallSketches } from "./island-sketch.ts";

export interface SimulationWorkerApi {
  advance: (realSeconds: number, commands: readonly unknown[]) => SimulationFrame;
  createWorld: (request: WorldRequest, onProgress: (progress: GenerationProgress) => void) => InitialWorld;
  loadWorld: (saved: unknown, onProgress: (progress: GenerationProgress) => void) => LoadedWorld;
  saveWorld: () => SavedWorldState | null;
}

type SimulationFactory = (request: WorldRequest, onProgress: (progress: GenerationProgress) => void) => Simulation;

interface RunningWorld {
  readonly request: WorldRequest;
  readonly simulation: Simulation;
}

function generateIsland(request: WorldRequest, onProgress: (progress: GenerationProgress) => void): Simulation {
  return Simulation.generate(request.seed, request.options, onProgress);
}

function generateSimulation(request: WorldRequest, onProgress: (progress: GenerationProgress) => void): Simulation {
  const simulation = generateIsland(request, onProgress);

  simulation.populate();

  return simulation;
}

function readSavedWorld(saved: unknown): SavedWorldState {
  const result = savedWorldStateSchema.safeParse(saved);

  if (!result.success) {
    throw new Error("This saved world cannot be loaded");
  }

  return result.data;
}

function channelBuffers(vegetation: VegetationChannels): ArrayBufferLike[] {
  return VEGETATION_CHANNELS.map((channel) => {
    return vegetation[channel].buffer;
  });
}

function frameBuffers(frame: SimulationFrame): ArrayBufferLike[] {
  const buffers: ArrayBufferLike[] = [
    frame.people.buffer,
    frame.animals.buffer,
    frame.burningCells.buffer,
    frame.burningIntensity.buffer,
    ...frame.surfaceRows.map((rows) => {
      return rows.data.buffer;
    }),
    ...frame.groundRows.map((rows) => {
      return rows.data.buffer;
    }),
  ];

  if (frame.heightPatch !== null) {
    buffers.push(frame.heightPatch.values.buffer);
  }

  if (frame.lava !== null) {
    buffers.push(frame.lava.cells.buffer, frame.lava.heat.buffer);
  }

  if (frame.water !== null) {
    buffers.push(frame.water.riverStrength.buffer, frame.water.waterSurface.buffer);
  }

  if (frame.waterLevels !== null) {
    buffers.push(frame.waterLevels.values.buffer);
  }

  if (frame.vegetation !== null) {
    buffers.push(...channelBuffers(frame.vegetation), frame.vegetation.indices.buffer);
  }

  return buffers;
}

function uniqueArrayBuffers(buffers: readonly ArrayBufferLike[]): ArrayBuffer[] {
  const unique = new Set(
    buffers.filter((buffer): buffer is ArrayBuffer => {
      return buffer instanceof ArrayBuffer;
    })
  );

  return [...unique];
}

function initialWorldTransferables(world: InitialWorld): ArrayBuffer[] {
  const { terrain, vegetation } = world;

  return uniqueArrayBuffers([
    world.ground.buffer,
    world.surface.buffer,
    ...Object.values(terrain).map((values) => {
      return values.buffer;
    }),
    ...channelBuffers(vegetation),
    ...frameBuffers(world.frame),
  ]);
}

export function createSimulationWorkerApi(
  createSimulation: SimulationFactory = generateSimulation,
  generateUnsettled: SimulationFactory = generateIsland
): SimulationWorkerApi {
  let running: RunningWorld | null = null;

  function startWorld(simulation: Simulation, request: WorldRequest): InitialWorld {
    running = { request, simulation };

    return simulation.initialWorld();
  }

  return {
    advance: (realSeconds, commands) => {
      if (running === null) {
        throw new Error("The world has not been created yet");
      }

      const { simulation } = running;

      for (const command of commands) {
        simulation.execute(command);
      }

      const frame = simulation.advance(realSeconds);

      return transfer(frame, uniqueArrayBuffers(frameBuffers(frame)));
    },
    createWorld: (request, onProgress) => {
      const world = startWorld(createSimulation(request, withSmallSketches(onProgress)), request);

      return transfer(world, initialWorldTransferables(world));
    },
    loadWorld: (saved, onProgress) => {
      const state = readSavedWorld(saved);

      const loaded = generateUnsettled(state.request, withSmallSketches(onProgress));

      restoreSavedWorld(loaded, state);

      const world = startWorld(loaded, state.request);

      return transfer({ hasLandChanged: hasLandChanged(loaded, state), world }, initialWorldTransferables(world));
    },
    saveWorld: () => {
      if (running === null) {
        return null;
      }

      const { request, simulation } = running;

      const snapshot = simulation.snapshot();

      if (snapshot === null) {
        return null;
      }

      const saved: SavedWorldState = {
        generationFingerprint: simulation.world.generationFingerprint,
        plantSpecies: PLANT_SPECIES_NAMES,
        request,
        simulation: snapshot,
        summary: summarizeWorld(simulation),
        version: SAVE_VERSION,
      };

      return transfer(saved, buffersWithin(snapshot));
    },
  };
}
