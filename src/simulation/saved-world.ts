import { z } from "zod";
import { ERAS } from "../content/eras.ts";
import { PlantSpecies } from "../content/plants.ts";
import type { WorldRequest } from "../generation/generation-options.ts";
import { ISLAND_SHAPES } from "../world/island-shape.ts";
import type { InitialWorld } from "./frame.ts";
import type { Simulation, SimulationSnapshot } from "./simulation.ts";
import type { WorldState } from "./world/world-state.ts";

export const SAVE_VERSION = 1;

const LARGEST_CELLS_PER_SIDE = 4096;
const MISSING_SPECIES = -1;
const FEWEST_TELLING_RIVER_POINTS = 50;
const SHARE_OF_RIVER_ON_WATER = 0.9;
const SPECIES_BY_NAME = new Map<string, number>(Object.entries(PlantSpecies));

export const PLANT_SPECIES_NAMES: readonly string[] = [...SPECIES_BY_NAME.keys()].sort((first, second) => {
  return speciesNamed(first) - speciesNamed(second);
});

const OLDER_SAVE_PLANT_SPECIES = [
  "Spruce",
  "Pine",
  "Oak",
  "Birch",
  "Willow",
  "Maple",
  "Bush",
  "Cactus",
  "Boulder",
  "Palm",
  "Acacia",
  "Poplar",
  "DeadTree",
  "DesertShrub",
  "Slab",
  "Cairn",
  "Scree",
  "MossyRock",
  "Sandstone",
  "FrostedRock",
  "Menhir",
  "Dolmen",
  "Idol",
  "Pillar",
  "Arch",
  "AppleTree",
  "PearTree",
  "PlumTree",
  "Raspberry",
  "Blueberry",
  "Currant",
  "Alder",
];

const worldRequestSchema = z.object({
  options: z.object({
    dimensions: z.object({
      cellSize: z.number().positive(),
      cellsPerSide: z.number().int().positive().max(LARGEST_CELLS_PER_SIDE),
    }),
    erosionStrength: z.number().nonnegative(),
    shape: z.enum(ISLAND_SHAPES),
  }),
  seed: z.number().int(),
});

export const worldSummarySchema = z.object({
  day: z.number(),
  eraIndex: z.number().int().nonnegative(),
  eraName: z.string(),
  population: z.number().int().nonnegative(),
  seasonName: z.string(),
  tribeCount: z.number().int().nonnegative(),
  year: z.number().int(),
});

const sparseSchema = z.object({ cells: z.instanceof(Int32Array), values: z.instanceof(Float64Array) });

const snapshotShapeSchema = z.looseObject({
  buildings: z.looseObject({ buildings: z.array(z.looseObject({ id: z.number() })), losses: z.array(z.unknown()) }),
  calendar: z.looseObject({ day: z.number(), daySeconds: z.number().positive(), daysPerSeason: z.number().positive() }),
  chronicle: z.looseObject({ entries: z.array(z.unknown()), nextId: z.number() }),
  embers: z.array(z.unknown()),
  fauna: z.looseObject({ animals: z.array(z.looseObject({ id: z.number() })), herds: z.array(z.unknown()) }),
  fire: z.object({ burning: z.instanceof(Int32Array), heated: z.instanceof(Int32Array) }),
  hazards: z.array(z.unknown()),
  identifiers: z.number().int().positive(),
  isPaused: z.boolean(),
  random: z.array(z.number()),
  rivalry: z.looseObject({
    raiders: z.array(z.looseObject({ personId: z.number(), raidId: z.number() })).optional(),
    raids: z.array(z.unknown()),
    relations: z.instanceof(Map),
  }),
  rules: z.looseObject({}),
  society: z.looseObject({
    people: z.array(z.looseObject({ id: z.number(), mover: z.looseObject({ x: z.number(), z: z.number() }) })),
    tribes: z.array(z.looseObject({ id: z.number(), technologies: z.instanceof(Set) })),
  }),
  speed: z.number().positive(),
  tick: z.number().int().nonnegative(),
  vegetationGrowth: z.looseObject({}),
  waterRecomputation: z.looseObject({ settledHeights: sparseSchema }),
  weather: z.looseObject({ kind: z.string() }),
  world: z.looseObject({
    fields: z.looseObject({ snow: z.instanceof(Float32Array), wetness: z.instanceof(Float32Array) }),
    occupancy: sparseSchema,
    terrain: z.looseObject({ height: sparseSchema, waterSurface: sparseSchema }),
    vegetation: z.looseObject({ count: z.number().int().nonnegative(), x: z.instanceof(Float32Array) }),
    water: z.looseObject({ lakes: z.array(z.unknown()), rivers: z.array(z.unknown()) }),
  }),
});

const simulationSnapshotSchema = z.custom<SimulationSnapshot>((value) => {
  return snapshotShapeSchema.safeParse(value).success;
}, "The saved world is damaged");

export const savedWorldStateSchema = z.object({
  generationFingerprint: z.number().int().nullable().default(null),
  plantSpecies: z.array(z.string()).default(() => {
    return [...OLDER_SAVE_PLANT_SPECIES];
  }),
  request: worldRequestSchema,
  simulation: simulationSnapshotSchema,
  summary: worldSummarySchema,
  version: z.literal(SAVE_VERSION),
});

export type WorldSummary = z.output<typeof worldSummarySchema>;

export interface SavedWorldState {
  generationFingerprint: number | null;
  plantSpecies: readonly string[];
  request: WorldRequest;
  simulation: SimulationSnapshot;
  summary: WorldSummary;
  version: number;
}

export interface LoadedWorld {
  hasLandChanged: boolean;
  world: InitialWorld;
}

function speciesNamed(name: string): number {
  const species = SPECIES_BY_NAME.get(name);

  if (species === undefined) {
    return MISSING_SPECIES;
  }

  return species;
}

function doRiversFollowTerrain(world: WorldState): boolean {
  let pointCount = 0;
  let pointsOnWater = 0;

  for (const river of world.water.rivers) {
    for (const point of river.points) {
      const cell = world.grid.cellAt(point.x, point.z);

      if (cell < 0) {
        continue;
      }

      pointCount += 1;

      if (world.isWater(cell) || world.terrain.riverStrength[cell] > 0) {
        pointsOnWater += 1;
      }
    }
  }

  if (pointCount < FEWEST_TELLING_RIVER_POINTS) {
    return true;
  }

  return pointsOnWater >= SHARE_OF_RIVER_ON_WATER * pointCount;
}

export function restoreSavedWorld(simulation: Simulation, state: SavedWorldState): void {
  const currentSpecies = new Int16Array(256).fill(MISSING_SPECIES);

  for (const [savedSpecies, name] of state.plantSpecies.entries()) {
    currentSpecies[savedSpecies] = speciesNamed(name);
  }

  const { society, vegetationGrowth, world } = state.simulation;
  const { species } = world.vegetation;
  const missing: number[] = [];

  for (let plant = 0; plant < world.vegetation.count; plant += 1) {
    if (currentSpecies[species[plant]] === MISSING_SPECIES) {
      missing.push(plant);
      species[plant] = PlantSpecies.Boulder;
    } else {
      species[plant] = currentSpecies[species[plant]];
    }
  }

  vegetationGrowth.nursery.seedlings = vegetationGrowth.nursery.seedlings
    .filter((seedling) => {
      return currentSpecies[seedling.species] !== MISSING_SPECIES;
    })
    .map((seedling) => {
      return { ...seedling, species: currentSpecies[seedling.species] };
    });

  for (const tribe of society.tribes) {
    for (const plot of tribe.plots) {
      plot.spots = plot.spots.filter((spot) => {
        return currentSpecies[spot.species] !== MISSING_SPECIES;
      });

      for (const spot of plot.spots) {
        spot.species = currentSpecies[spot.species];
      }
    }
  }

  simulation.restore(state.simulation);

  for (const plant of missing) {
    simulation.world.removePlant(plant);
  }
}

export function hasLandChanged(simulation: Simulation, state: SavedWorldState): boolean {
  if (state.generationFingerprint !== null) {
    return state.generationFingerprint !== simulation.world.generationFingerprint;
  }

  return !doRiversFollowTerrain(simulation.world);
}

export function summarizeWorld(simulation: Simulation): WorldSummary {
  const calendar = simulation.calendar.view();
  const tribes = simulation.society.tribes();

  const eraIndex = tribes.reduce((highest, tribe) => {
    return Math.max(highest, tribe.eraIndex);
  }, 0);

  return {
    day: calendar.day,
    eraIndex,
    eraName: ERAS[eraIndex].name,
    population: simulation.society.population,
    seasonName: calendar.seasonName,
    tribeCount: tribes.length,
    year: calendar.year,
  };
}
