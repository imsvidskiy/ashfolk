import { expose, wrap } from "comlink";
import { describe, expect, it } from "vitest";
import type { WorldRequest } from "../generation/generation-options.ts";
import { DEFAULT_WORLD_REQUEST } from "../generation/testing/world-request.ts";
import { ignore } from "../shared/ignore.ts";
import type { InitialWorld } from "../simulation/frame.ts";
import type { SavedWorldState } from "../simulation/saved-world.ts";
import { Simulation } from "../simulation/simulation.ts";
import { createVegetatedWorld } from "../simulation/testing/test-world.ts";
import { createSimulationWorkerApi, type SimulationWorkerApi } from "./simulation-worker-api.ts";

interface WorldSender {
  createWorld: (request: WorldRequest) => InitialWorld;
}

const TEST_DIMENSIONS = { cellSize: 10, cellsPerSide: 64 };

function createTestSimulation(): Simulation {
  return new Simulation(createVegetatedWorld({ dimensions: TEST_DIMENSIONS }));
}

function createRaisedSimulation(): Simulation {
  return new Simulation(
    createVegetatedWorld({
      dimensions: TEST_DIMENSIONS,
      heightAt: () => {
        return 140;
      },
    })
  );
}

describe("creating the world", () => {
  it("moves every terrain buffer to the main thread instead of copying it", async () => {
    const api = createSimulationWorkerApi(createTestSimulation);

    const sent: InitialWorld[] = [];
    const { port1, port2 } = new MessageChannel();

    expose(
      {
        createWorld: (request: WorldRequest) => {
          const world = api.createWorld(request, ignore);

          sent.push(world);

          return world;
        },
      },
      port1
    );

    const received = await wrap<WorldSender>(port2).createWorld(DEFAULT_WORLD_REQUEST);

    port1.close();
    port2.close();

    expect(received.terrain.coastDistance).toHaveLength(64 * 64);
    expect(sent).toHaveLength(1);

    for (const values of sent.flatMap((world) => {
      return Object.values(world.terrain);
    })) {
      expect(values.buffer.byteLength).toBe(0);
    }
  });
});

describe("saving the world", () => {
  function createApi(): SimulationWorkerApi {
    return createSimulationWorkerApi(createTestSimulation, createTestSimulation);
  }

  function saveOf(api: SimulationWorkerApi): SavedWorldState {
    const saved = api.saveWorld();

    if (saved === null) {
      throw new Error("The world was busy");
    }

    return saved;
  }

  function savedWorld(request: WorldRequest = DEFAULT_WORLD_REQUEST): SavedWorldState {
    const api = createApi();

    api.createWorld(request, ignore);
    api.advance(0.25, [{ parameters: {}, powerId: "tribe", type: "usePower", x: 0, z: 0 }]);

    return saveOf(api);
  }

  it("saves nothing before a world exists", () => {
    expect(createApi().saveWorld()).toBeNull();
  });

  it("continues a saved world where it left off", () => {
    const saved = savedWorld();

    expect(saved.summary.population).toBeGreaterThan(0);

    const { hasLandChanged, world } = createApi().loadWorld(saved, ignore);

    expect(world.frame.tick).toBe(saved.simulation.tick);
    expect(world.frame.tribes).toHaveLength(saved.summary.tribeCount);
    expect(hasLandChanged).toBe(false);
  });

  it("brings every plant back as the species it was saved as", () => {
    const saved = savedWorld();
    const savedSpecies = [...saved.simulation.world.vegetation.species];

    const { world } = createApi().loadWorld(saved, ignore);

    expect([...world.vegetation.species]).toEqual(savedSpecies);
  });

  it("saves the request the world was made from, again after loading it", () => {
    const request: WorldRequest = { options: { ...DEFAULT_WORLD_REQUEST.options, shape: "square" }, seed: 9 };
    const saved = savedWorld(request);

    expect(saved.request).toEqual(request);

    const api = createApi();

    api.loadWorld(saved, ignore);

    expect(saveOf(api).request).toEqual(request);
  });

  it("saves the fingerprint of the generated land", () => {
    expect(savedWorld().generationFingerprint).toBe(createTestSimulation().world.generationFingerprint);
  });

  it("warns when the seed now grows different land", () => {
    const loaded = createSimulationWorkerApi(createTestSimulation, createRaisedSimulation).loadWorld(
      savedWorld(),
      ignore
    );

    expect(loaded.hasLandChanged).toBe(true);
    expect(loaded.world.frame.personCount).toBeGreaterThan(0);
  });

  it("loads a save made before fingerprints", () => {
    const { generationFingerprint: _, ...older } = savedWorld();

    expect(createApi().loadWorld(older, ignore).hasLandChanged).toBe(false);
  });

  it("refuses a damaged save", () => {
    expect(() => {
      return createApi().loadWorld({ version: 1 }, ignore);
    }).toThrow("cannot be loaded");
  });
});
