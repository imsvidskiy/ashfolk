import { WOODED_BIOMES } from "../../content/biomes.ts";
import { Ground, type GroundIndex, groundDefinition } from "../../content/grounds.ts";
import { PlantSpecies, type PlantSpeciesIndex, plantSpeciesDefinition } from "../../content/plants.ts";
import type { PowerParameters } from "../../content/powers.ts";
import { plantHeight } from "../../generation/vegetation.ts";
import { FULL_TURN } from "../../shared/math.ts";
import type { RandomSource } from "../../shared/random.ts";
import { NO_PLANT } from "../../world/vegetation-store.ts";
import { isDryLand } from "../agents/navigation.ts";
import { brushFalloff, cellsInArea, flattenTerrain, raiseTerrain, smoothTerrain } from "../world/terrain-editing.ts";
import { NO_BUILDING, type WorldState } from "../world/world-state.ts";
import {
  APPLIED,
  type PowerHandler,
  type PowerOutcome,
  type PowerServices,
  type PowerTarget,
  percent,
} from "./power-handler.ts";

const DEFAULT_STRENGTH = 0.6;
const BASE_LIFT_PER_SECOND = 14;
const LIFT_PER_METER_OF_RADIUS = 0.25;
const FLATTEN_PER_SECOND = 3;
const SMOOTH_PER_SECOND = 4;
const PLANTING_PER_SECOND = 4;
const DEFAULT_DENSITY = 0.5;
const CROWDED_CELL = 2;
const SNOWY_PAINT = 0.6;
const HOT_CLIMATE = 14;

type ForestSpecies = PowerParameters<"forest">["species"];

type PaintMaterial = PowerParameters<"paint">["material"];

const CHOSEN_SPECIES: Readonly<Record<Exclude<ForestSpecies, "climate">, PlantSpeciesIndex>> = {
  acacia: PlantSpecies.Acacia,
  alder: PlantSpecies.Alder,
  birch: PlantSpecies.Birch,
  bush: PlantSpecies.Bush,
  maple: PlantSpecies.Maple,
  oak: PlantSpecies.Oak,
  palm: PlantSpecies.Palm,
  pine: PlantSpecies.Pine,
  poplar: PlantSpecies.Poplar,
  spruce: PlantSpecies.Spruce,
  willow: PlantSpecies.Willow,
};

const PAINT_GROUNDS: Readonly<Record<PaintMaterial, GroundIndex>> = {
  dirt: Ground.Dirt,
  forest: Ground.Forest,
  meadow: Ground.Meadow,
  rock: Ground.Rock,
  sand: Ground.Sand,
  snow: Ground.Snow,
  steppe: Ground.Steppe,
  swamp: Ground.Swamp,
};

function liftPerSecond(radius: number, strength: number): number {
  return (BASE_LIFT_PER_SECOND + radius * LIFT_PER_METER_OF_RADIUS) * (percent(strength) / DEFAULT_STRENGTH);
}

function liftPower<Id extends "lower" | "raise">(direction: number): PowerHandler<Id> {
  return (target, parameters, services) => {
    const lift = liftPerSecond(parameters.radius, parameters.strength) * target.seconds;

    raiseTerrain(services.world, { ...target, radius: parameters.radius }, lift * direction);

    return APPLIED;
  };
}

export const raisePower = liftPower<"raise">(1);
export const lowerPower = liftPower<"lower">(-1);

export function flattenPower(
  target: PowerTarget,
  parameters: PowerParameters<"flatten">,
  services: PowerServices
): PowerOutcome {
  const strength = target.seconds * FLATTEN_PER_SECOND * (percent(parameters.strength) / DEFAULT_STRENGTH);

  flattenTerrain(services.world, { ...target, radius: parameters.radius }, target.strokeStartHeight, strength);

  return APPLIED;
}

export function smoothPower(
  target: PowerTarget,
  parameters: PowerParameters<"smooth">,
  services: PowerServices
): PowerOutcome {
  const strength = target.seconds * SMOOTH_PER_SECOND * (percent(parameters.strength) / DEFAULT_STRENGTH);

  smoothTerrain(services.world, { ...target, radius: parameters.radius }, strength);

  return APPLIED;
}

function climateSpecies(temperature: number, random: RandomSource): PlantSpeciesIndex {
  if (temperature < 4) {
    return PlantSpecies.Spruce;
  }

  if (temperature < 7.5) {
    return random.chance(0.7) ? PlantSpecies.Spruce : PlantSpecies.Pine;
  }

  if (temperature > HOT_CLIMATE) {
    return random.chance(0.65) ? PlantSpecies.Acacia : PlantSpecies.Palm;
  }

  if (random.chance(0.45)) {
    return PlantSpecies.Oak;
  }

  return random.chance(0.6) ? PlantSpecies.Birch : PlantSpecies.Pine;
}

function speciesFor(choice: ForestSpecies, temperature: number, random: RandomSource): PlantSpeciesIndex {
  if (choice === "climate") {
    return climateSpecies(temperature, random);
  }

  return CHOSEN_SPECIES[choice];
}

function canPlantIn(world: WorldState, cell: number): boolean {
  if (!world.isOpenGround(cell) || world.occupancy[cell] !== NO_BUILDING) {
    return false;
  }

  return world.vegetation.countTreesInCell(cell) < CROWDED_CELL;
}

function plantTree(cell: number, species: PlantSpeciesIndex, services: PowerServices): void {
  const { environment, random, world } = services;
  const { grid } = world;

  const plant = world.plant({
    bornDay: environment.day,
    height: plantHeight(species, random, 1),
    rotation: random.next() * FULL_TURN,
    seed: random.next(),
    species,
    x: grid.cellCenterX(cell) + random.between(-0.4, 0.4) * grid.cellSize,
    z: grid.cellCenterZ(cell) + random.between(-0.4, 0.4) * grid.cellSize,
  });

  if (plant === NO_PLANT) {
    return;
  }

  const isForestLand = WOODED_BIOMES.has(world.terrain.biome[cell]);

  if (isForestLand && groundDefinition(world.terrain.ground[cell]).fuel > 0) {
    world.setGround(cell, Ground.Forest);
  }

  world.fields.scorch[cell] = 0;
  world.markSurfaceCell(cell);
}

export function forestPower(
  target: PowerTarget,
  parameters: PowerParameters<"forest">,
  services: PowerServices
): PowerOutcome {
  const { random, world } = services;

  const density = percent(parameters.density) / DEFAULT_DENSITY;

  for (const { cell, distance } of cellsInArea(world, { ...target, radius: parameters.radius })) {
    if (!canPlantIn(world, cell)) {
      continue;
    }

    const chance = target.seconds * PLANTING_PER_SECOND * brushFalloff(distance, parameters.radius) * density;

    if (!random.chance(chance)) {
      continue;
    }

    const species = speciesFor(parameters.species, world.terrain.baseTemperature[cell], random);

    if (world.canPlace(cell, plantSpeciesDefinition(species).steepestSlope)) {
      plantTree(cell, species, services);
    }
  }

  return APPLIED;
}

function paintCell(world: WorldState, cell: number, ground: GroundIndex): void {
  if (!isDryLand(world, cell) || world.terrain.ground[cell] === ground) {
    return;
  }

  world.setGround(cell, ground);

  if (groundDefinition(ground).fuel === 0) {
    world.clearPlants(cell, false);
    world.fields.fire[cell] = 0;
  }

  if (ground === Ground.Snow) {
    world.fields.snow[cell] = Math.max(world.fields.snow[cell], SNOWY_PAINT);
  }

  world.markSurfaceCell(cell);
}

export function paintPower(
  target: PowerTarget,
  parameters: PowerParameters<"paint">,
  services: PowerServices
): PowerOutcome {
  const ground = PAINT_GROUNDS[parameters.material];

  for (const { cell } of cellsInArea(services.world, { ...target, radius: parameters.radius })) {
    paintCell(services.world, cell, ground);
  }

  return APPLIED;
}
