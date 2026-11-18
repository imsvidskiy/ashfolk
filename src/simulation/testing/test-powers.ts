import { Biome } from "../../content/biomes.ts";
import { Ground } from "../../content/grounds.ts";
import { isTreeSpecies } from "../../content/plants.ts";
import type { PowerId } from "../../content/powers.ts";
import { Simulation } from "../simulation.ts";
import { createVegetatedWorld } from "./test-world.ts";

export function createPowerSimulation(baseTemperature = 15): Simulation {
  return new Simulation(createVegetatedWorld({ baseTemperature, dimensions: { cellSize: 10, cellsPerSide: 96 } }));
}

export function brush(simulation: Simulation, powerId: PowerId, seconds: number): void {
  simulation.beginStroke(powerId, 0, 0, {});

  for (let elapsed = 0; elapsed < seconds; elapsed += 0.05) {
    simulation.advance(0.05);
  }

  simulation.endStroke();
}

export function createForest(): Simulation {
  const simulation = new Simulation(
    createVegetatedWorld({ biome: Biome.Forest, dimensions: { cellSize: 10, cellsPerSide: 96 }, ground: Ground.Forest })
  );

  simulation.weather.setKind("clear");
  simulation.weather.setWind(0, 0, 1);

  return simulation;
}

export function treesWithin(simulation: Simulation, radius: number, state: number): number {
  const { vegetation } = simulation.world;

  let count = 0;

  for (let plant = 0; plant < vegetation.count; plant += 1) {
    const isNear = Math.hypot(vegetation.x[plant], vegetation.z[plant]) < radius;

    if (isNear && vegetation.state[plant] === state && isTreeSpecies(vegetation.species[plant])) {
      count += 1;
    }
  }

  return count;
}

export function settle(simulation: Simulation, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.1) {
    simulation.advance(0.1);
  }
}
