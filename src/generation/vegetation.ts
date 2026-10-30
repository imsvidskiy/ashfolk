import { type BiomeIndex, isBiomeIndex } from "../content/biomes.ts";
import { WILD_BERRY_RULES } from "../content/cultivated-plants.ts";
import { groundDefinition } from "../content/grounds.ts";
import {
  canGrowAt,
  isRockSpecies,
  isTreeSpecies,
  PLANTING_RULES,
  type PlantingRule,
  plantSpeciesDefinition,
  ROCK_RULES,
  TREE_SPACING,
} from "../content/plants.ts";
import { FULL_TURN, hashToUnit } from "../shared/math.ts";
import { createRandom, type RandomSource } from "../shared/random.ts";
import { isOnIsland } from "../world/coast.ts";
import { hasRoomToGrow } from "../world/footing.ts";
import type { TerrainData } from "../world/terrain-data.ts";
import { isWaterCell, touchesWaterCell } from "../world/terrain-sampling.ts";
import type { PlantPlacement, VegetationStore } from "../world/vegetation-store.ts";
import type { WorldGrid } from "../world/world-grid.ts";

export const INITIAL_PLANT_DAY = -999;
const BIOME_BLEND_CELLS = 8;

export function plantHeight(species: number, random: RandomSource, heightScale: number): number {
  const [shortest, tallest] = plantSpeciesDefinition(species).heightRange;

  return random.between(shortest, tallest) * heightScale;
}

function blendedBiome(terrain: TerrainData, grid: WorldGrid, cell: number, seed: number): number {
  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);
  const reach = BIOME_BLEND_CELLS * 2 + 1;

  const neighborColumn = column + Math.floor(hashToUnit(column, row, seed) * reach) - BIOME_BLEND_CELLS;
  const neighborRow = row + Math.floor(hashToUnit(row, column, seed + 1) * reach) - BIOME_BLEND_CELLS;

  if (!grid.contains(neighborColumn, neighborRow)) {
    return terrain.biome[cell];
  }

  const neighbor = grid.index(neighborColumn, neighborRow);

  if (isWaterCell(terrain, neighbor)) {
    return terrain.biome[cell];
  }

  return terrain.biome[neighbor];
}

function plantableBiome(terrain: TerrainData, grid: WorldGrid, cell: number, seed: number): BiomeIndex | null {
  if (touchesWaterCell(terrain, grid, cell) || !isOnIsland(terrain.coastDistance, cell)) {
    return null;
  }

  const biome = blendedBiome(terrain, grid, cell, seed);

  return isBiomeIndex(biome) ? biome : null;
}

export function clearingAt(terrain: TerrainData, cell: number): number {
  return 0.45 + 0.9 * (0.5 + 0.5 * terrain.variation[cell]);
}

export function plantingChance(rule: PlantingRule, clearing: number, holdsTrees: boolean): number {
  if (isRockSpecies(rule.species)) {
    return rule.chancePerCell;
  }

  if (!holdsTrees && isTreeSpecies(rule.species)) {
    return 0;
  }

  return rule.chancePerCell * clearing;
}

function sow(rule: PlantingRule, random: RandomSource, grid: WorldGrid, cell: number): PlantPlacement {
  return {
    bornDay: INITIAL_PLANT_DAY,
    height: plantHeight(rule.species, random, rule.heightScale),
    rotation: random.next() * FULL_TURN,
    seed: random.next(),
    species: rule.species,
    x: grid.cellCenterX(cell) + random.between(-0.42, 0.42) * grid.cellSize,
    z: grid.cellCenterZ(cell) + random.between(-0.42, 0.42) * grid.cellSize,
  };
}

function plantWildBerries(
  store: VegetationStore,
  grid: WorldGrid,
  terrain: TerrainData,
  seed: number,
  reserved: Uint8Array
): void {
  const berries = createRandom(seed * 3 + 3);

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (reserved[cell] !== 0) {
      continue;
    }

    const biome = plantableBiome(terrain, grid, cell, seed);

    if (biome === null) {
      continue;
    }

    const clearing = clearingAt(terrain, cell);

    for (const rule of WILD_BERRY_RULES[biome]) {
      if (!berries.chance(rule.chancePerCell * clearing)) {
        continue;
      }

      const plant = sow(rule, berries, grid, cell);

      if (hasRoomToGrow(terrain, grid, plant.x, plant.z, plant.species)) {
        store.add(plant);
      }
    }
  }
}

export function plantInitialVegetation(
  store: VegetationStore,
  grid: WorldGrid,
  terrain: TerrainData,
  seed: number,
  reserved: Uint8Array = new Uint8Array(grid.cellCount)
): void {
  const random = createRandom(seed * 3 + 1);
  const rocks = createRandom(seed * 3 + 2);

  function plantWhereRoom(plant: PlantPlacement, cell: number): void {
    if (reserved[cell] !== 0 || !hasRoomToGrow(terrain, grid, plant.x, plant.z, plant.species)) {
      return;
    }

    if (!(isTreeSpecies(plant.species) && store.hasTreeWithin(plant.x, plant.z, TREE_SPACING))) {
      store.add(plant);
    }
  }

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    const biome = plantableBiome(terrain, grid, cell, seed);

    if (biome === null) {
      continue;
    }

    const { holdsTrees } = groundDefinition(terrain.ground[cell]);

    const temperature = terrain.baseTemperature[cell];
    const clearing = clearingAt(terrain, cell);

    for (const rule of PLANTING_RULES[biome]) {
      if (canGrowAt(rule, temperature) && random.chance(plantingChance(rule, clearing, holdsTrees))) {
        plantWhereRoom(sow(rule, random, grid, cell), cell);
      }
    }

    for (const rule of ROCK_RULES[biome]) {
      if (canGrowAt(rule, temperature) && rocks.chance(rule.chancePerCell)) {
        plantWhereRoom(sow(rule, rocks, grid, cell), cell);
      }
    }
  }

  plantWildBerries(store, grid, terrain, seed, reserved);
}
