import { describe, expect, it } from "vitest";
import { ignore } from "../shared/ignore.ts";
import { PlantState } from "../world/vegetation-store.ts";
import type { RiverPoint } from "../world/water.ts";
import {
  hasLandChanged,
  PLANT_SPECIES_NAMES,
  restoreSavedWorld,
  SAVE_VERSION,
  type SavedWorldState,
  savedWorldStateSchema,
  summarizeWorld,
} from "./saved-world.ts";
import { Simulation } from "./simulation.ts";
import { GENERATION_OPTIONS, GENERATION_SEED, generateSimulation, snapshotOf } from "./testing/test-simulation.ts";

function savedState(simulation: Simulation): SavedWorldState {
  return {
    generationFingerprint: simulation.world.generationFingerprint,
    plantSpecies: PLANT_SPECIES_NAMES,
    request: { options: GENERATION_OPTIONS, seed: GENERATION_SEED },
    simulation: snapshotOf(simulation),
    summary: summarizeWorld(simulation),
    version: SAVE_VERSION,
  };
}

function warnsOnLoad(generated: Simulation, state: SavedWorldState): boolean {
  restoreSavedWorld(generated, state);

  return hasLandChanged(generated, state);
}

function otherIsland(): Simulation {
  return Simulation.generate(GENERATION_SEED + 1, GENERATION_OPTIONS, ignore);
}

function riverPointAt(simulation: Simulation, isOnWater: boolean): RiverPoint {
  const { grid, terrain } = simulation.world;

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    const isWet = simulation.world.isWater(cell) || terrain.riverStrength[cell] > 0;

    if (isWet === isOnWater) {
      return { depth: 1, flow: 1, surface: 0, width: 1, x: grid.cellCenterX(cell), z: grid.cellCenterZ(cell) };
    }
  }

  throw new Error("The test island has no such cell");
}

function warnsWithRiverPoints(wetPoints: number, dryPoints: number): boolean {
  const simulation = generateSimulation();
  const state = { ...savedState(simulation), generationFingerprint: null };

  const wet = riverPointAt(simulation, true);
  const dry = riverPointAt(simulation, false);
  const points = [...new Array<RiverPoint>(wetPoints).fill(wet), ...new Array<RiverPoint>(dryPoints).fill(dry)];

  simulation.world.water.rivers = [{ id: 0, points, reachesEdge: false }];

  return hasLandChanged(simulation, state);
}

describe("loading a world whose land grows differently now", () => {
  it("loads a save of the same generation without a warning", () => {
    expect(warnsOnLoad(generateSimulation(), savedState(generateSimulation()))).toBe(false);
  });

  it("warns when the saved fingerprint differs from the regenerated island", () => {
    const original = generateSimulation();
    const state = savedState(original);

    const changed = { ...state, generationFingerprint: original.world.generationFingerprint + 1 };

    expect(warnsOnLoad(generateSimulation(), changed)).toBe(true);
  });

  it("reads saves made before fingerprints and loads them without a warning when the rivers still fit", () => {
    const { generationFingerprint: _, ...older } = savedState(generateSimulation());

    const state = savedWorldStateSchema.parse(older);

    expect(state.generationFingerprint).toBeNull();
    expect(warnsOnLoad(generateSimulation(), state)).toBe(false);
  });

  it("warns about a save without a fingerprint when its rivers run over dry land", () => {
    const state = { ...savedState(generateSimulation()), generationFingerprint: null };

    expect(state.simulation.world.water.rivers.length).toBeGreaterThan(0);
    expect(warnsOnLoad(otherIsland(), state)).toBe(true);
  });

  it("does not judge a save without a fingerprint by fewer than 50 river points", () => {
    expect(warnsWithRiverPoints(0, 49)).toBe(false);
    expect(warnsWithRiverPoints(0, 50)).toBe(true);
  });

  it("warns about a save without a fingerprint when less than 90% of its river lies on water", () => {
    expect(warnsWithRiverPoints(90, 10)).toBe(false);
    expect(warnsWithRiverPoints(89, 11)).toBe(true);
  });
});

describe("saved worlds", () => {
  it("finds each plant species by name when the list order changes", () => {
    const original = generateSimulation();
    const state = savedState(original);
    const savedNames = [...PLANT_SPECIES_NAMES].reverse();
    const { species } = state.simulation.world.vegetation;
    const lastIndex = PLANT_SPECIES_NAMES.length - 1;

    for (let plant = 0; plant < species.length; plant += 1) {
      species[plant] = lastIndex - species[plant];
    }

    const loaded = generateSimulation();

    restoreSavedWorld(loaded, { ...state, plantSpecies: savedNames });

    expect(loaded.world.vegetation.species).toEqual(original.world.vegetation.species);
  });

  it("removes plants whose species no longer exists", () => {
    const original = generateSimulation();
    const state = savedState(original);
    const plant = 0;

    expect(original.world.vegetation.state[plant]).toBe(PlantState.Alive);

    state.simulation.world.vegetation.species[plant] = PLANT_SPECIES_NAMES.length;

    const loaded = generateSimulation();

    restoreSavedWorld(loaded, { ...state, plantSpecies: [...PLANT_SPECIES_NAMES, "Retired"] });

    expect(loaded.world.vegetation.state[plant]).toBe(PlantState.Removed);
    expect(loaded.world.vegetation.aliveCount).toBe(original.world.vegetation.aliveCount - 1);
  });

  it("reads saves made before plant species were named", () => {
    const state = savedState(generateSimulation());
    const { plantSpecies: _, ...unnamed } = state;

    const result = savedWorldStateSchema.parse(unnamed);

    expect(result.plantSpecies).toContain("Slab");
    expect(result.plantSpecies).toHaveLength(32);
  });
});
