import { Ground } from "../content/grounds.ts";
import { ignore } from "../shared/ignore.ts";
import { lerp, smoothstep } from "../shared/math.ts";
import { createRandom } from "../shared/random.ts";
import { isOnIsland } from "../world/coast.ts";
import type { Crossing } from "../world/crossings.ts";
import type { Deposit } from "../world/deposits.ts";
import { createIslandShape, type IslandShapeKind } from "../world/island-shape.ts";
import type { Monument } from "../world/monuments.ts";
import type { TerrainData } from "../world/terrain-data.ts";
import { VegetationStore } from "../world/vegetation-store.ts";
import type { WaterFeatures } from "../world/water.ts";
import { type GridDimensions, WorldGrid } from "../world/world-grid.ts";
import { buildClimate } from "./climate.ts";
import { planCrossings } from "./crossings.ts";
import { exposeDeposits, planDeposits } from "./deposits.ts";
import {
  type ErosionPlan,
  type ErosionScale,
  erodeAcrossScales,
  limitSlopes,
  relaxSlopes,
  smoothHeights,
} from "./erosion.ts";
import {
  DEFAULT_GENERATION_OPTIONS,
  type GenerationOptions,
  type GenerationProgress,
  type IslandSketch,
} from "./generation-options.ts";
import { computeHydrology } from "./hydrology.ts";
import { type Basin, basinShapeAt, type IslandLayout, planIslandLayout } from "./island-layout.ts";
import { digRiverLakes, easeLakeShores, fillSinks } from "./lake-basins.ts";
import { planMonuments } from "./monuments.ts";
import { createRelief, islandPointAt, type Relief } from "./relief.ts";
import { carveValleys } from "./valleys.ts";
import { plantInitialVegetation } from "./vegetation.ts";
import { openWoodland } from "./woodland.ts";

const VEGETATION_CAPACITY_PER_CELL = 1.25;
const SOIL_TALUS = 0.78;
const BEDROCK_TALUS = 0.92;
const CAPROCK_TALUS = 1.15;
const BEDROCK_HEIGHT = 650;
const SUMMIT_HEIGHT = 950;
const STEEPEST_SLOPE = 1.25;
const BASIN_LEVEL_EDGE = 0.1;
const BASIN_LEVEL_CORE = 0.5;
const ROUGH_RELAXATION_ITERATIONS = 24;
const FINAL_RELAXATION_ITERATIONS = 72;
const DESERT_RESISTANCE = 0.85;
const LOWLAND_HEIGHT = 420;
const UPLAND_HEIGHT = 650;
const VALLEY_CELL_SIZES = [40, 20] as const;
const VALLEY_DROPLETS_PER_CELL = 1.6;
const GULLY_DROPLETS_PER_CELL = 1.2;

export interface GeneratedWorld {
  crossings: readonly Crossing[];
  deposits: readonly Deposit[];
  dimensions: GridDimensions;
  monuments: readonly Monument[];
  seed: number;
  shape: IslandShapeKind;
  terrain: TerrainData;
  vegetation: VegetationStore;
  water: WaterFeatures;
}

function erosionScales(grid: WorldGrid, strength: number): ErosionScale[] {
  const coarse = VALLEY_CELL_SIZES.map((meters) => {
    return Math.round(meters / grid.cellSize);
  })
    .filter((factor) => {
      return factor >= 2 && grid.cellsPerSide % factor === 0;
    })
    .map((factor) => {
      return { dropletsPerCell: VALLEY_DROPLETS_PER_CELL * strength, factor };
    });

  return [...coarse, { dropletsPerCell: GULLY_DROPLETS_PER_CELL * strength, factor: 1 }];
}

function erosionPlan(grid: WorldGrid, heights: Float32Array, dryness: Float32Array, strength: number): ErosionPlan {
  return {
    coarseReach: heights.map((height, cell) => {
      return smoothstep(LOWLAND_HEIGHT, UPLAND_HEIGHT, height) * (1 - dryness[cell]);
    }),
    resistance: dryness.map((value) => {
      return DESERT_RESISTANCE * value;
    }),
    scales: erosionScales(grid, strength),
  };
}

function talusSlopes(heights: Float32Array, dryness: Float32Array): Float32Array {
  return heights.map((height, cell) => {
    const rock = lerp(SOIL_TALUS, BEDROCK_TALUS, smoothstep(BEDROCK_HEIGHT, SUMMIT_HEIGHT, height));

    return lerp(rock, CAPROCK_TALUS, dryness[cell]);
  });
}

function digLakeBasins(heights: Float32Array, grid: WorldGrid, basins: readonly Basin[]): void {
  const floors = basins.map((basin) => {
    return heights[grid.cellAt(basin.x * grid.halfSize, basin.z * grid.halfSize)];
  });

  for (let row = 0; row < grid.cellsPerSide; row += 1) {
    for (let column = 0; column < grid.cellsPerSide; column += 1) {
      const cell = grid.index(column, row);
      const point = islandPointAt(grid, column, row);

      for (const [index, basin] of basins.entries()) {
        const shape = basinShapeAt(basin, point.x, point.z);
        const level = lerp(heights[cell], floors[index], smoothstep(BASIN_LEVEL_EDGE, BASIN_LEVEL_CORE, shape));

        heights[cell] = level - basin.depth * shape;
      }
    }
  }
}

function boundaryDistances(grid: WorldGrid, relief: Relief): (cell: number) => number {
  return (cell) => {
    return relief.boundaryDistanceAt(islandPointAt(grid, grid.columnOf(cell), grid.rowOf(cell)));
  };
}

function buildRelief(grid: WorldGrid, seed: number, layout: IslandLayout, shapeKind: IslandShapeKind) {
  const shape = createIslandShape(shapeKind, seed);
  const relief = createRelief(seed, layout, shape, grid.halfSize);
  const coastDistance = new Float32Array(grid.cellCount);
  const desert = new Float64Array(grid.cellCount);
  const heights = new Float32Array(grid.cellCount);

  for (let row = 0; row < grid.cellsPerSide; row += 1) {
    for (let column = 0; column < grid.cellsPerSide; column += 1) {
      const sample = relief.sampleAt(islandPointAt(grid, column, row));
      const cell = grid.index(column, row);

      coastDistance[cell] = sample.coastDistance * grid.halfSize;
      desert[cell] = sample.desert;
      heights[cell] = sample.height;
    }
  }

  return { coastDistance, desert, dryness: Float32Array.from(desert), heights, relief };
}

export function cellMask(cellCount: number, owners: readonly { readonly cells: readonly number[] }[]): Uint8Array {
  const mask = new Uint8Array(cellCount);

  for (const owner of owners) {
    for (const cell of owner.cells) {
      mask[cell] = 1;
    }
  }

  return mask;
}

function bareOffIsland(ground: Uint8Array, coastDistance: Float32Array): void {
  for (let cell = 0; cell < ground.length; cell += 1) {
    if (!isOnIsland(coastDistance, cell)) {
      ground[cell] = Ground.Rock;
    }
  }
}

export function generateWorld(
  seed: number,
  options: GenerationOptions = DEFAULT_GENERATION_OPTIONS,
  onProgress: (progress: GenerationProgress) => void = ignore
): GeneratedWorld {
  const grid = new WorldGrid(options.dimensions);
  const size = grid.cellsPerSide;

  onProgress({ island: null, stage: "relief" });

  const layout = planIslandLayout(seed);
  const { coastDistance, desert, dryness, heights, relief } = buildRelief(grid, seed, layout, options.shape);

  const talus = talusSlopes(heights, dryness);

  const sketch: IslandSketch = {
    cellSize: grid.cellSize,
    cellsPerSide: size,
    coastDistance,
    ground: null,
    height: heights,
    waterSurface: null,
  };

  relaxSlopes(heights, size, grid.cellSize, talus, ROUGH_RELAXATION_ITERATIONS);
  onProgress({ island: sketch, stage: "erosion" });
  erodeAcrossScales(
    heights,
    size,
    createRandom(seed * 7 + 3),
    erosionPlan(grid, heights, dryness, options.erosionStrength)
  );
  digLakeBasins(heights, grid, layout.basins);
  digRiverLakes(heights, {
    boundaryDistance: boundaryDistances(grid, relief),
    coastDistance,
    dryness,
    grid,
    random: createRandom(seed * 11 + 5),
  });
  carveValleys(heights, grid, dryness, coastDistance);
  relaxSlopes(heights, size, grid.cellSize, talus, FINAL_RELAXATION_ITERATIONS);
  limitSlopes(heights, size, grid.cellSize, STEEPEST_SLOPE);
  smoothHeights(heights, size);
  easeLakeShores(heights, grid, coastDistance, fillSinks(heights, grid, dryness, coastDistance));
  onProgress({ island: sketch, stage: "water" });

  const hydrology = computeHydrology(heights, grid, dryness, coastDistance);

  onProgress({ island: { ...sketch, waterSurface: hydrology.waterSurface }, stage: "climate" });

  const climate = buildClimate(layout.climate, {
    coastDistance,
    desert,
    grid,
    heights,
    lakeIds: hydrology.lakeIds,
    riverStrength: hydrology.riverStrength,
    rivers: hydrology.features.rivers,
    seed,
    waterSurface: hydrology.waterSurface,
  });

  bareOffIsland(climate.ground, coastDistance);

  const terrain: TerrainData = {
    ...climate,
    carving: hydrology.carving,
    coastDistance,
    dryness,
    height: heights,
    riverStrength: hydrology.riverStrength,
    waterSurface: hydrology.waterSurface,
    woodland: new Float32Array(grid.cellCount).fill(1),
  };

  onProgress({
    island: { ...sketch, ground: climate.ground, waterSurface: hydrology.waterSurface },
    stage: "vegetation",
  });
  openWoodland(terrain, grid, seed);

  const ruins = planMonuments(grid, terrain, seed);
  const ruinGround = cellMask(grid.cellCount, ruins.monuments);
  const crossings = planCrossings({
    grid,
    isBlocked: (cell) => {
      return ruinGround[cell] === 1;
    },
    lakeIds: hydrology.lakeIds,
    terrain,
    water: hydrology.features,
  });
  const vegetation = new VegetationStore(grid, Math.round(grid.cellCount * VEGETATION_CAPACITY_PER_CELL));

  const reserved = cellMask(grid.cellCount, [...ruins.monuments, ...hydrology.features.springs]);

  plantInitialVegetation(vegetation, grid, terrain, seed, reserved);

  for (const piece of ruins.pieces) {
    vegetation.add(piece);
  }

  const deposits = planDeposits(grid, terrain, seed, reserved);

  exposeDeposits(terrain, vegetation, deposits);
  vegetation.discardChanges();

  return {
    crossings,
    deposits,
    dimensions: options.dimensions,
    monuments: ruins.monuments,
    seed,
    shape: options.shape,
    terrain,
    vegetation,
    water: hydrology.features,
  };
}
