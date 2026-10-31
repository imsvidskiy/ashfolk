import { DEFAULT_GENERATION_OPTIONS, type GenerationOptions } from "../../generation/generation-options.ts";
import { ignore } from "../../shared/ignore.ts";
import type { GridDimensions } from "../../world/world-grid.ts";
import { Simulation, type SimulationSnapshot } from "../simulation.ts";
import { createPowerSimulation } from "./test-powers.ts";
import { createVegetatedWorld, type TestWorldOptions } from "./test-world.ts";

export const GENERATION_SEED = 11;
export const GENERATION_OPTIONS: GenerationOptions = {
  ...DEFAULT_GENERATION_OPTIONS,
  dimensions: { cellSize: 20, cellsPerSide: 128 },
};
export const VALLEY_DIMENSIONS: GridDimensions = { cellSize: 10, cellsPerSide: 96 };

const VALLEY_SIDES = 0.25;
const VALLEY_FALL = 0.02;

export function generateSimulation(): Simulation {
  return Simulation.generate(GENERATION_SEED, GENERATION_OPTIONS, ignore);
}

export function createCalmSimulation(): Simulation {
  const simulation = createPowerSimulation();

  simulation.setViewFocus(0, 0);
  simulation.weather.setKind("clear");

  return simulation;
}

export function valleyHeight(x: number, z: number): number {
  return 200 + Math.abs(x - 5) * VALLEY_SIDES + z * VALLEY_FALL;
}

export function createValleySimulation(overrides: Partial<TestWorldOptions> = {}): Simulation {
  const simulation = new Simulation(
    createVegetatedWorld({ dimensions: VALLEY_DIMENSIONS, heightAt: valleyHeight, ...overrides })
  );

  simulation.weather.setKind("clear");
  simulation.waterRecomputation.recompute();

  return simulation;
}

export function snapshotOf(simulation: Simulation): SimulationSnapshot {
  const snapshot = simulation.snapshot();

  if (snapshot === null) {
    throw new Error("The simulation was busy");
  }

  return snapshot;
}
