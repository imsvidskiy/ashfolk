import { Biome } from "../../content/biomes.ts";
import { isOnIsland } from "../../world/coast.ts";
import { slopeAt } from "../../world/footing.ts";
import { isStandingWater } from "../../world/terrain-sampling.ts";
import { hasWater } from "../../world/water.ts";
import { WorldGrid } from "../../world/world-grid.ts";
import type { GeneratedWorld } from "../world-generator.ts";

const CAMP_SLOPE = 0.22;
const CAMP_COAST_MARGIN = 120;
const LAKE_SHORE_REACH = 100;
const BIOME_GROUPS = {
  cold: [Biome.Alpine, Biome.Glacier, Biome.Tundra],
  desert: [Biome.Desert, Biome.Mesa],
  forest: [Biome.Forest, Biome.Taiga],
  swamp: [Biome.Swamp],
} as const;

export interface IslandSurvey {
  readonly flatShare: number;
  readonly highGroundAngle: number;
  readonly lakeShoreRise: number;
  readonly lakes: number;
  readonly rivers: number;
  readonly shares: Readonly<Record<keyof typeof BIOME_GROUPS, number>>;
}

function countOf(counts: ReadonlyMap<number, number>, biome: number): number {
  const count = counts.get(biome);

  return count === undefined ? 0 : count;
}

function highestLakeShore(generated: GeneratedWorld): number {
  const { terrain } = generated;

  const grid = new WorldGrid(generated.dimensions);
  const levels = new Set(
    generated.water.lakes.map((lake) => {
      return lake.level;
    })
  );
  const nearestLevels = new Float32Array(grid.cellCount).fill(Number.NEGATIVE_INFINITY);

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (!(isStandingWater(terrain, cell) && levels.has(terrain.waterSurface[cell]))) {
      continue;
    }

    for (const near of grid.cellsInRadius(grid.cellCenterX(cell), grid.cellCenterZ(cell), LAKE_SHORE_REACH)) {
      nearestLevels[near] = Math.max(nearestLevels[near], terrain.waterSurface[cell]);
    }
  }

  let highest = Number.NEGATIVE_INFINITY;

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    const isDryLand =
      isOnIsland(terrain.coastDistance, cell) && !hasWater(terrain.waterSurface[cell], terrain.height[cell]);

    if (isDryLand && nearestLevels[cell] > Number.NEGATIVE_INFINITY) {
      highest = Math.max(highest, terrain.height[cell] - nearestLevels[cell]);
    }
  }

  return highest;
}

export function surveyIsland(generated: GeneratedWorld): IslandSurvey {
  const { terrain } = generated;

  const grid = new WorldGrid(generated.dimensions);
  const counts = new Map<number, number>();
  let landCells = 0;
  let flatCells = 0;
  let heightSum = 0;

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (!isOnIsland(terrain.coastDistance, cell)) {
      continue;
    }

    landCells += 1;
    heightSum += terrain.height[cell];
    counts.set(terrain.biome[cell], countOf(counts, terrain.biome[cell]) + 1);

    const isDry = !hasWater(terrain.waterSurface[cell], terrain.height[cell]) && terrain.biome[cell] !== Biome.Swamp;

    if (isDry && terrain.coastDistance[cell] > CAMP_COAST_MARGIN && slopeAt(terrain.height, grid, cell) < CAMP_SLOPE) {
      flatCells += 1;
    }
  }

  const meanHeight = heightSum / landCells;
  let towardX = 0;
  let towardZ = 0;

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (!isOnIsland(terrain.coastDistance, cell)) {
      continue;
    }

    const weight = Math.max(0, terrain.height[cell] - meanHeight);

    towardX += weight * grid.cellCenterX(cell);
    towardZ += weight * grid.cellCenterZ(cell);
  }

  function shareOf(biomes: readonly number[]): number {
    return (
      biomes.reduce((total, biome) => {
        return total + countOf(counts, biome);
      }, 0) / landCells
    );
  }

  return {
    flatShare: flatCells / landCells,
    highGroundAngle: Math.atan2(towardZ, towardX),
    lakeShoreRise: highestLakeShore(generated),
    lakes: generated.water.lakes.length,
    rivers: generated.water.rivers.length,
    shares: {
      cold: shareOf(BIOME_GROUPS.cold),
      desert: shareOf(BIOME_GROUPS.desert),
      forest: shareOf(BIOME_GROUPS.forest),
      swamp: shareOf(BIOME_GROUPS.swamp),
    },
  };
}
