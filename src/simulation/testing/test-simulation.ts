import { DEFAULT_GENERATION_OPTIONS, type GenerationOptions } from "../../generation/generation-options.ts";
import { ignore } from "../../shared/ignore.ts";
import { Simulation, type SimulationSnapshot } from "../simulation.ts";
import { createPowerSimulation } from "./test-powers.ts";

export const GENERATION_SEED = 11;
export const GENERATION_OPTIONS: GenerationOptions = {
  ...DEFAULT_GENERATION_OPTIONS,
  dimensions: { cellSize: 20, cellsPerSide: 128 },
};

export function generateSimulation(): Simulation {
  return Simulation.generate(GENERATION_SEED, GENERATION_OPTIONS, ignore);
}

export function createCalmSimulation(): Simulation {
  const simulation = createPowerSimulation();

  simulation.setViewFocus(0, 0);
  simulation.weather.setKind("clear");

  return simulation;
}

export function snapshotOf(simulation: Simulation): SimulationSnapshot {
  const snapshot = simulation.snapshot();

  if (snapshot === null) {
    throw new Error("The simulation was busy");
  }

  return snapshot;
}
