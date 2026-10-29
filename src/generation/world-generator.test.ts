import { beforeAll, describe, expect, it, it as test } from "vitest";
import { Biome } from "../content/biomes.ts";
import { Ground, isPoolGround } from "../content/grounds.ts";
import { isTreeSpecies, plantSpeciesDefinition, TREE_SPACING } from "../content/plants.ts";
import { isOnIsland } from "../world/coast.ts";
import { admitsWildPlant, slopeAt } from "../world/footing.ts";
import { ISLAND_SHAPES, type IslandShapeKind } from "../world/island-shape.ts";
import { islandDimensions } from "../world/island-size.ts";
import type { TerrainData } from "../world/terrain-data.ts";
import { sampleHeight } from "../world/terrain-sampling.ts";
import {
  hasWater,
  NO_WATER,
  pondEdgeReach,
  pondOutlineExtent,
  pondOutlineRadius,
  type River,
  type RiverPoint,
  SPRING_KINDS,
  type Spring,
} from "../world/water.ts";
import { NEIGHBOR_OFFSETS, WorldGrid } from "../world/world-grid.ts";
import { generationFingerprint } from "./generation-fingerprint.ts";
import { DEFAULT_GENERATION_OPTIONS, type GenerationProgress, type IslandSketch } from "./generation-options.ts";
import { pondShoreReach } from "./ponds.ts";
import { SOURCE_REACH } from "./river-spacing.ts";
import { type GeneratedWorld, generateWorld } from "./world-generator.ts";

const TEST_DIMENSIONS = { cellSize: 40, cellsPerSide: 128 };
const DETERMINISM_DIMENSIONS = { cellSize: 20, cellsPerSide: 128 };
const DETERMINISM_SEEDS = [7, 11, 13];
const STEEP = 1;
const CLIFF = Math.tan((55 * Math.PI) / 180);
const SMALLEST_RIVER_GAP = 35;
const CONFLUENCE_REACH = 100;
const JUNCTION_CELLS = 1.5;
const TRUNK_LAKE_CELLS = 1.5;
const SMOOTHING_SLACK = 10;
const LAKE_REACH = 20;
const RIVER_SAMPLE_STEP = 5;
const FLOAT_SLACK = 1e-3;
const INLAND_REACH = 60;
const HANGING_SLACK = 0.3;
const SHALLOWEST_BED = 0.3;
const GENTLE_REACH_DROP = 0.05;
const SIDEHILL_CROSS_SLOPE = 0.12;
const NEIGHBOR_CELLS = 1.5;
const WATER_LEVEL_CELLS = 2.5;
const STRAIGHT_RUN = 150;
const STRAIGHT_DEVIATION = 3;
const VARIETY_DIMENSIONS = { cellSize: 50, cellsPerSide: 128 };
const VARIETY_SEEDS = Array.from({ length: 16 }, (_, index) => {
  return index + 1;
});
const CAMP_SLOPE = 0.22;
const CAMP_COAST_MARGIN = 120;
const BIOME_GROUPS = {
  cold: [Biome.Alpine, Biome.Glacier, Biome.Tundra],
  desert: [Biome.Desert, Biome.Mesa],
  forest: [Biome.Forest, Biome.Taiga],
  swamp: [Biome.Swamp],
} as const;
const OUTLINE_SAMPLES = 64;
const SMALLEST_MEAN_POND_AREA = 1500;
const LEAST_MEAN_OUTLINE_SPREAD = 1.5;
const LAKE_SHORE_REACH = 100;
const HIGHEST_LAKE_SHORE = 25;

let world: GeneratedWorld;
let squareWorld: GeneratedWorld;
const stages = new Set<string>();
const sketches = new Map<string, IslandSketch | null>();
const testWorlds = new Map<string, GeneratedWorld>();

interface SwampSurvey {
  readonly faults: string[];
  landCells: number;
  patches: number;
  poolCells: number;
  swampCells: number;
}

interface IslandSurvey {
  readonly flatShare: number;
  readonly highGroundAngle: number;
  readonly lakeShoreRise: number;
  readonly lakes: number;
  readonly rivers: number;
  readonly shares: Readonly<Record<keyof typeof BIOME_GROUPS, number>>;
}

interface PointBounds {
  maximumX: number;
  maximumZ: number;
  minimumX: number;
  minimumZ: number;
}

function testWorld(seed: number, shape: IslandShapeKind = "round"): GeneratedWorld {
  const key = `${seed}:${shape}`;
  const cached = testWorlds.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const generated = generateWorld(
    seed,
    { dimensions: TEST_DIMENSIONS, erosionStrength: 1, shape },
    (progress: GenerationProgress) => {
      stages.add(progress.stage);
      sketches.set(progress.stage, progress.island);
    }
  );

  testWorlds.set(key, generated);

  return generated;
}

function slopesOf(terrain: TerrainData, grid: WorldGrid): number[] {
  return Array.from({ length: grid.cellCount }, (_, cell) => {
    return slopeAt(terrain.height, grid, cell);
  });
}

function shareAbove(values: readonly number[], limit: number): number {
  return (
    values.filter((value) => {
      return value > limit;
    }).length / values.length
  );
}

function edgeSides(grid: WorldGrid): number[][] {
  const last = grid.cellsPerSide - 1;
  const positions = Array.from({ length: grid.cellsPerSide }, (_, position) => {
    return position;
  });

  return [
    positions.map((position) => {
      return grid.index(position, 0);
    }),
    positions.map((position) => {
      return grid.index(position, last);
    }),
    positions.map((position) => {
      return grid.index(0, position);
    }),
    positions.map((position) => {
      return grid.index(last, position);
    }),
  ];
}

function coastCells(terrain: TerrainData, grid: WorldGrid): number[] {
  return Array.from({ length: grid.cellCount }, (_, cell) => {
    return cell;
  }).filter((cell) => {
    return (
      isOnIsland(terrain.coastDistance, cell) &&
      grid.cellsInRadius(grid.cellCenterX(cell), grid.cellCenterZ(cell), grid.cellSize * 1.5).some((neighbor) => {
        return !isOnIsland(terrain.coastDistance, neighbor);
      })
    );
  });
}

function largestStepAlong(heights: Float32Array, cells: readonly number[]): number {
  let largest = 0;

  for (let position = 1; position < cells.length; position += 1) {
    largest = Math.max(largest, Math.abs(heights[cells[position]] - heights[cells[position - 1]]));
  }

  return largest;
}

function isRiverWater(terrain: TerrainData, cell: number): boolean {
  return terrain.riverStrength[cell] > 0 && hasWater(terrain.waterSurface[cell], terrain.height[cell]);
}

function cellsAround(grid: WorldGrid, cell: number, innerRadius: number, outerRadius: number): number[] {
  const x = grid.cellCenterX(cell);
  const z = grid.cellCenterZ(cell);

  return grid.cellsInRadius(x, z, outerRadius).filter((other) => {
    return Math.hypot(grid.cellCenterX(other) - x, grid.cellCenterZ(other) - z) >= innerRadius;
  });
}

function misplacedPlants(generated: GeneratedWorld): string[] {
  const { terrain, vegetation } = generated;

  const grid = new WorldGrid(generated.dimensions);
  const misplaced: string[] = [];

  for (let plant = 0; plant < vegetation.count; plant += 1) {
    const { name, steepestSlope } = plantSpeciesDefinition(vegetation.species[plant]);

    const cell = grid.cellAt(vegetation.x[plant], vegetation.z[plant]);
    const slope = slopeAt(terrain.height, grid, cell);

    if (slope > steepestSlope) {
      misplaced.push(`${name} on slope ${slope.toFixed(2)}`);
    }

    if (hasWater(terrain.waterSurface[cell], terrain.height[cell])) {
      misplaced.push(`${name} in water`);
    }

    if (isPoolGround(terrain.ground[cell])) {
      misplaced.push(`${name} in a bog pool`);
    }
  }

  return misplaced;
}

function closestTreeGap(generated: GeneratedWorld): number {
  const { vegetation } = generated;

  const grid = new WorldGrid(generated.dimensions);
  const treesByCell = new Map<number, number[]>();
  let closest = Number.POSITIVE_INFINITY;

  for (let plant = 0; plant < vegetation.count; plant += 1) {
    if (!isTreeSpecies(vegetation.species[plant])) {
      continue;
    }

    const x = vegetation.x[plant];
    const z = vegetation.z[plant];
    const column = grid.columnAt(x);
    const row = grid.rowAt(z);

    for (let nearRow = row - 1; nearRow <= row + 1; nearRow += 1) {
      for (let nearColumn = column - 1; nearColumn <= column + 1; nearColumn += 1) {
        const near = grid.contains(nearColumn, nearRow) ? treesByCell.get(grid.index(nearColumn, nearRow)) : undefined;

        for (const other of near === undefined ? [] : near) {
          closest = Math.min(closest, Math.hypot(vegetation.x[other] - x, vegetation.z[other] - z));
        }
      }
    }

    const cell = grid.index(column, row);
    const trees = treesByCell.get(cell);

    if (trees === undefined) {
      treesByCell.set(cell, [plant]);
    } else {
      trees.push(plant);
    }
  }

  return closest;
}

function surveySwamps(generated: GeneratedWorld): SwampSurvey {
  const { terrain } = generated;

  const grid = new WorldGrid(generated.dimensions);
  const seen = new Uint8Array(grid.cellCount);
  const survey: SwampSurvey = { faults: [], landCells: 0, patches: 0, poolCells: 0, swampCells: 0 };

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    const isSwamp = terrain.biome[cell] === Biome.Swamp;

    if (isOnIsland(terrain.coastDistance, cell) && terrain.biome[cell] !== Biome.Water) {
      survey.landCells += 1;
    }

    if (isPoolGround(terrain.ground[cell])) {
      survey.poolCells += 1;

      if (!isSwamp) {
        survey.faults.push(`pool outside a swamp at ${cell}`);
      }
    }

    if (!isSwamp) {
      continue;
    }

    survey.swampCells += 1;

    if (terrain.dryness[cell] > 0.35 || terrain.height[cell] > 620 || slopeAt(terrain.height, grid, cell) > 0.4) {
      survey.faults.push(`swamp on dry, high or steep ground at ${cell}`);
    }

    if (seen[cell] === 0) {
      survey.patches += 1;
      markPatch(grid, terrain, cell, seen);
    }
  }

  return survey;
}

function markPatch(grid: WorldGrid, terrain: TerrainData, start: number, seen: Uint8Array): void {
  const pending = [start];

  seen[start] = 1;

  for (const cell of pending) {
    for (const offset of NEIGHBOR_OFFSETS) {
      const column = grid.columnOf(cell) + offset.column;
      const row = grid.rowOf(cell) + offset.row;

      if (!grid.contains(column, row)) {
        continue;
      }

      const neighbor = grid.index(column, row);

      if (seen[neighbor] === 0 && terrain.biome[neighbor] === Biome.Swamp) {
        seen[neighbor] = 1;
        pending.push(neighbor);
      }
    }
  }
}

function isWooded(terrain: TerrainData, cell: number): boolean {
  return terrain.biome[cell] === Biome.Forest || terrain.biome[cell] === Biome.Taiga;
}

function nearWater(terrain: TerrainData, grid: WorldGrid, cell: number, radius: number): boolean {
  return grid.cellsInRadius(grid.cellCenterX(cell), grid.cellCenterZ(cell), radius).some((other) => {
    return hasWater(terrain.waterSurface[other], terrain.height[other]);
  });
}

function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

function quantile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((first, second) => {
    return first - second;
  });

  return sorted[Math.floor(sorted.length * share)];
}

function waterLevelBesideRiver(terrain: TerrainData, grid: WorldGrid, cell: number): number {
  let total = 0;
  let count = 0;
  let isBesideRiver = false;

  for (const offset of NEIGHBOR_OFFSETS) {
    const column = grid.columnOf(cell) + offset.column;
    const row = grid.rowOf(cell) + offset.row;

    if (!grid.contains(column, row)) {
      continue;
    }

    const neighbor = grid.index(column, row);

    if (!hasWater(terrain.waterSurface[neighbor], terrain.height[neighbor])) {
      continue;
    }

    total += terrain.waterSurface[neighbor];
    count += 1;

    if (isRiverWater(terrain, neighbor)) {
      isBesideRiver = true;
    }
  }

  return isBesideRiver ? total / count : Number.NaN;
}

function bankRises(terrain: TerrainData, grid: WorldGrid): number[] {
  const rises: number[] = [];

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    const isDryLand =
      isOnIsland(terrain.coastDistance, cell) && !hasWater(terrain.waterSurface[cell], terrain.height[cell]);

    const water = isDryLand ? waterLevelBesideRiver(terrain, grid, cell) : Number.NaN;

    if (Number.isFinite(water)) {
      rises.push(terrain.height[cell] - water);
    }
  }

  return rises;
}

function riverPathCells(grid: WorldGrid, river: River): number[] {
  const cells: number[] = [];

  for (const point of river.points) {
    const cell = grid.cellAt(point.x, point.z);

    if (cell !== cells.at(-1)) {
      cells.push(cell);
    }
  }

  return cells;
}

function isLakeWater(terrain: TerrainData, cell: number): boolean {
  return terrain.riverStrength[cell] === 0 && hasWater(terrain.waterSurface[cell], terrain.height[cell]);
}

function riverFaults(generated: GeneratedWorld): string[] {
  const { terrain } = generated;

  const grid = new WorldGrid(generated.dimensions);
  const faults: string[] = [];

  for (const river of generated.water.rivers) {
    let level = Number.POSITIVE_INFINITY;

    for (const cell of riverPathCells(grid, river)) {
      const where = `river ${river.id} at ${grid.cellCenterX(cell)}, ${grid.cellCenterZ(cell)}`;

      if (isLakeWater(terrain, cell)) {
        continue;
      }

      if (!isRiverWater(terrain, cell)) {
        faults.push(`${where} runs dry`);

        continue;
      }

      if (terrain.waterSurface[cell] > level + 1e-3) {
        faults.push(`${where} rises by ${(terrain.waterSurface[cell] - level).toFixed(2)}`);
      }

      level = Math.min(level, terrain.waterSurface[cell]);
    }
  }

  return faults;
}

function isCoastTaken(terrain: TerrainData, grid: WorldGrid, cell: number): boolean {
  return grid
    .cellsInRadius(grid.cellCenterX(cell), grid.cellCenterZ(cell), grid.cellSize * 1.5)
    .filter((neighbor) => {
      return !isOnIsland(terrain.coastDistance, neighbor);
    })
    .every((neighbor) => {
      return terrain.waterSurface[neighbor] !== NO_WATER;
    });
}

function reachesPastCoast(generated: GeneratedWorld, grid: WorldGrid, mouth: number): boolean {
  const { terrain } = generated;

  if (generated.shape === "square") {
    return grid.isOnEdge(mouth);
  }

  return !isOnIsland(terrain.coastDistance, mouth) || isCoastTaken(terrain, grid, mouth);
}

function mouthFaults(generated: GeneratedWorld): string[] {
  const { terrain } = generated;

  const grid = new WorldGrid(generated.dimensions);
  const faults: string[] = [];

  for (const river of generated.water.rivers.filter((candidate) => {
    return candidate.reachesEdge;
  })) {
    const mouth = riverPathCells(grid, river).at(-1);
    const end = river.points.at(-1);

    if (mouth === undefined || end === undefined) {
      continue;
    }

    const isPastCoast = reachesPastCoast(generated, grid, mouth);
    const waterfall = generated.water.waterfalls.find((candidate) => {
      return candidate.x === end.x && candidate.z === end.z;
    });

    if (!isPastCoast) {
      faults.push(`river ${river.id} ends inland at ${grid.cellCenterX(mouth)}, ${grid.cellCenterZ(mouth)}`);
    }

    if (waterfall === undefined || Math.abs(waterfall.top - terrain.waterSurface[mouth]) > 0.1) {
      faults.push(`river ${river.id} does not meet its waterfall`);
    }
  }

  return faults;
}

function isFedByLake(generated: GeneratedWorld, grid: WorldGrid, river: River): boolean {
  const [head] = river.points;

  return grid.cellsInRadius(head.x, head.z, grid.cellSize * 2.5).some((cell) => {
    return isLakeWater(generated.terrain, cell);
  });
}

function isTrunkFedByLake(generated: GeneratedWorld, grid: WorldGrid, river: River): boolean {
  const [head] = riverPathCells(grid, river);

  return grid
    .cellsInRadius(grid.cellCenterX(head), grid.cellCenterZ(head), grid.cellSize * TRUNK_LAKE_CELLS)
    .some((cell) => {
      return isLakeWater(generated.terrain, cell);
    });
}

function pondsOf(generated: GeneratedWorld): Spring[] {
  return generated.water.springs.filter((spring) => {
    return spring.kind === "pond";
  });
}

function outlineSpread(pond: Spring): number {
  const radii = Array.from({ length: OUTLINE_SAMPLES }, (_, sample) => {
    return pondOutlineRadius(pond, (sample / OUTLINE_SAMPLES) * Math.PI * 2);
  });

  return Math.max(...radii) / Math.min(...radii);
}

function pondWaterCells(generated: GeneratedWorld, grid: WorldGrid, pond: Spring): number[] {
  const { terrain } = generated;

  return grid.cellsInRadius(pond.x, pond.z, pondOutlineExtent(pond)).filter((cell) => {
    return (
      hasWater(terrain.waterSurface[cell], terrain.height[cell]) &&
      terrain.riverStrength[cell] === 0 &&
      Math.abs(terrain.waterSurface[cell] - pond.level) < 0.05
    );
  });
}

function meanOf(values: readonly number[]): number {
  return (
    values.reduce((sum, value) => {
      return sum + value;
    }, 0) / values.length
  );
}

function ownRiverFaults(pond: Spring, river: River): string[] {
  const leaving = river.points.findIndex((point) => {
    return pondEdgeReach(pond, point.x, point.z) < -point.width / 2;
  });

  if (leaving < 0) {
    return [];
  }

  const turnsBack = river.points.slice(leaving).some((point) => {
    return pondEdgeReach(pond, point.x, point.z) > -point.width / 2;
  });

  return turnsBack ? [`river ${river.id} turns back into its own pond`] : [];
}

function pondShoreFaults(generated: GeneratedWorld, grid: WorldGrid, pond: Spring): string[] {
  const { terrain } = generated;

  const faults: string[] = [];

  if (sampleHeight(terrain.coastDistance, grid, pond.x, pond.z) < pondShoreReach(pond)) {
    faults.push(`the pond of river ${pond.river} reaches the coast`);
  }

  const isNearLake = grid.cellsInRadius(pond.x, pond.z, pondOutlineExtent(pond)).some((cell) => {
    return isLakeWater(terrain, cell) && Math.abs(terrain.waterSurface[cell] - pond.level) >= 0.05;
  });

  if (isNearLake) {
    faults.push(`the pond of river ${pond.river} runs into a lake`);
  }

  return faults;
}

function pondFaults(generated: GeneratedWorld): string[] {
  const grid = new WorldGrid(generated.dimensions);
  const ponds = pondsOf(generated);
  const faults: string[] = [];

  for (const pond of ponds) {
    const [head] = generated.water.rivers[pond.river].points;

    if (pondEdgeReach(pond, head.x, head.z) <= 0) {
      faults.push(`the pond of river ${pond.river} does not hold its river head`);
    }

    faults.push(...pondShoreFaults(generated, grid, pond));

    for (const river of generated.water.rivers) {
      if (river.id === pond.river) {
        faults.push(...ownRiverFaults(pond, river));

        continue;
      }

      const isInside = river.points.some((point) => {
        return pondEdgeReach(pond, point.x, point.z) > 0;
      });

      if (isInside) {
        faults.push(`the pond of river ${pond.river} swallows river ${river.id}`);
      }
    }

    for (const other of generated.water.springs) {
      if (other.kind !== "pond" && pondEdgeReach(pond, other.x, other.z) > -other.radius) {
        faults.push(`the pond of river ${pond.river} covers the cave of river ${other.river}`);
      }

      if (
        other.kind === "pond" &&
        other !== pond &&
        Math.hypot(other.x - pond.x, other.z - pond.z) < pondShoreReach(pond) + pondShoreReach(other)
      ) {
        faults.push(`the ponds of rivers ${pond.river} and ${other.river} run together`);
      }
    }
  }

  return faults;
}

function headFaults(generated: GeneratedWorld): string[] {
  const grid = new WorldGrid(generated.dimensions);
  const faults: string[] = [];

  for (const river of generated.water.rivers) {
    const spring = generated.water.springs.find((candidate) => {
      return candidate.river === river.id;
    });
    const [head] = river.points;
    const ahead = river.points.find((point) => {
      return Math.hypot(point.x - head.x, point.z - head.z) >= 25;
    });

    if (spring === undefined) {
      if (!isFedByLake(generated, grid, river)) {
        faults.push(`river ${river.id} starts from nothing at ${head.x.toFixed(0)}, ${head.z.toFixed(0)}`);
      }

      continue;
    }

    if (ahead === undefined) {
      continue;
    }

    const facing =
      (spring.directionX * (ahead.x - head.x) + spring.directionZ * (ahead.z - head.z)) /
      Math.hypot(ahead.x - head.x, ahead.z - head.z);
    const behind = spring.directionX * (head.x - spring.x) + spring.directionZ * (head.z - spring.z);

    if (facing < 0.95 || behind < 0) {
      faults.push(`the ${spring.kind} of river ${river.id} does not face down the river`);
    }
  }

  return faults;
}

function riverEnd(river: River): RiverPoint {
  const end = river.points.at(-1);

  if (end === undefined) {
    throw new Error(`River ${river.id} has no points`);
  }

  return end;
}

function isNear(point: RiverPoint, other: RiverPoint, reach: number): boolean {
  return Math.hypot(point.x - other.x, point.z - other.z) < reach;
}

function joinsRiver(tributary: River, main: River, reach: number): boolean {
  const end = riverEnd(tributary);

  return main.points.some((point) => {
    return isNear(point, end, reach);
  });
}

function confluencesOf(rivers: readonly River[], first: River, second: River, reach: number): RiverPoint[] {
  const confluences: RiverPoint[] = [];

  for (const [tributary, main] of [
    [first, second],
    [second, first],
  ] as const) {
    if (joinsRiver(tributary, main, reach)) {
      confluences.push(riverEnd(tributary));
    }
  }

  for (const third of rivers) {
    if (third !== first && third !== second && joinsRiver(first, third, reach) && joinsRiver(second, third, reach)) {
      confluences.push(riverEnd(first), riverEnd(second));
    }
  }

  return confluences;
}

function boundsOf(points: readonly RiverPoint[]): PointBounds {
  const bounds = {
    maximumX: Number.NEGATIVE_INFINITY,
    maximumZ: Number.NEGATIVE_INFINITY,
    minimumX: Number.POSITIVE_INFINITY,
    minimumZ: Number.POSITIVE_INFINITY,
  };

  for (const point of points) {
    bounds.minimumX = Math.min(bounds.minimumX, point.x);
    bounds.maximumX = Math.max(bounds.maximumX, point.x);
    bounds.minimumZ = Math.min(bounds.minimumZ, point.z);
    bounds.maximumZ = Math.max(bounds.maximumZ, point.z);
  }

  return bounds;
}

function squaredDistanceToBounds(point: RiverPoint, bounds: PointBounds): number {
  const offsetX = Math.max(bounds.minimumX - point.x, 0, point.x - bounds.maximumX);
  const offsetZ = Math.max(bounds.minimumZ - point.z, 0, point.z - bounds.maximumZ);

  return offsetX * offsetX + offsetZ * offsetZ;
}

function closestDistinctRivers(generated: GeneratedWorld): number {
  const { cellSize } = generated.dimensions;
  const { rivers } = generated.water;

  let closestSquared = Number.POSITIVE_INFINITY;

  for (const [index, first] of rivers.entries()) {
    for (const second of rivers.slice(index + 1)) {
      const confluences = confluencesOf(rivers, first, second, cellSize * JUNCTION_CELLS);

      function isApart(point: RiverPoint): boolean {
        return confluences.every((confluence) => {
          return !isNear(point, confluence, CONFLUENCE_REACH);
        });
      }

      const firstPoints = first.points.filter(isApart);
      const secondPoints = second.points.filter(isApart);
      const secondBounds = boundsOf(secondPoints);

      for (const point of firstPoints) {
        if (squaredDistanceToBounds(point, secondBounds) >= closestSquared) {
          continue;
        }

        for (const other of secondPoints) {
          const offsetX = point.x - other.x;
          const offsetZ = point.z - other.z;

          closestSquared = Math.min(closestSquared, offsetX * offsetX + offsetZ * offsetZ);
        }
      }
    }
  }

  return Math.sqrt(closestSquared);
}

function resampledRiver(river: River): { x: number; z: number }[] {
  const samples = river.points.slice(0, 1).map((point) => {
    return { x: point.x, z: point.z };
  });

  let carried = 0;

  for (let index = 1; index < river.points.length; index += 1) {
    const start = river.points[index - 1];
    const end = river.points[index];
    const length = Math.hypot(end.x - start.x, end.z - start.z);

    let along = RIVER_SAMPLE_STEP - carried;

    for (; along <= length; along += RIVER_SAMPLE_STEP) {
      samples.push({
        x: start.x + ((end.x - start.x) * along) / length,
        z: start.z + ((end.z - start.z) * along) / length,
      });
    }

    carried = length - (along - RIVER_SAMPLE_STEP);
  }

  return samples;
}

function straightSamples(samples: readonly { x: number; z: number }[]): number {
  const window = Math.round(STRAIGHT_RUN / RIVER_SAMPLE_STEP);
  const isStraight = new Uint8Array(samples.length);

  for (let first = 0; first + window < samples.length; first += 1) {
    const start = samples[first];
    const end = samples[first + window];
    const chordX = end.x - start.x;
    const chordZ = end.z - start.z;
    const chord = Math.hypot(chordX, chordZ);

    const deviations = samples.slice(first, first + window + 1).map((sample) => {
      return Math.abs((sample.x - start.x) * chordZ - (sample.z - start.z) * chordX) / chord;
    });

    if (Math.max(...deviations) < STRAIGHT_DEVIATION) {
      isStraight.fill(1, first, first + window + 1);
    }
  }

  return isStraight.reduce((total, flag) => {
    return total + flag;
  }, 0);
}

function straightRiverShare(generated: GeneratedWorld): number {
  const rivers = generated.water.rivers.map(resampledRiver);

  const total = rivers.reduce((sum, samples) => {
    return sum + samples.length;
  }, 0);
  const straight = rivers.reduce((sum, samples) => {
    return sum + straightSamples(samples);
  }, 0);

  return straight / total;
}

function alongToNearest(river: River, target: RiverPoint): { along: number; distance: number } {
  let along = 0;
  let best = { along: 0, distance: Number.POSITIVE_INFINITY };

  for (const [index, point] of river.points.entries()) {
    const previous = river.points[Math.max(0, index - 1)];

    along += Math.hypot(point.x - previous.x, point.z - previous.z);

    const distance = Math.hypot(point.x - target.x, point.z - target.z);

    if (distance < best.distance) {
      best = { along, distance };
    }
  }

  return best;
}

function joinsNearSources(generated: GeneratedWorld): string[] {
  const { cellSize } = generated.dimensions;
  const { rivers } = generated.water;

  const grid = new WorldGrid(generated.dimensions);
  const trunks = rivers.filter((river) => {
    return !isTrunkFedByLake(generated, grid, river);
  });
  const faults: string[] = [];

  for (const tributary of rivers) {
    const end = riverEnd(tributary);

    for (const main of trunks) {
      if (main === tributary) {
        continue;
      }

      const nearest = alongToNearest(main, end);

      if (nearest.distance < cellSize * JUNCTION_CELLS && nearest.along < SOURCE_REACH - SMOOTHING_SLACK) {
        faults.push(`river ${tributary.id} joins river ${main.id} ${Math.round(nearest.along)} m below its source`);
      }
    }
  }

  return faults;
}

function endsAwayFromWater(generated: GeneratedWorld): string[] {
  const { cellSize } = generated.dimensions;
  const { rivers } = generated.water;

  const grid = new WorldGrid(generated.dimensions);

  return rivers
    .filter((river) => {
      const end = riverEnd(river);

      const joins = rivers.some((other) => {
        return other !== river && joinsRiver(river, other, cellSize * JUNCTION_CELLS);
      });
      const reachesLake = grid.cellsInRadius(end.x, end.z, LAKE_REACH).some((cell) => {
        return isLakeWater(generated.terrain, cell);
      });

      return !(river.reachesEdge || joins || reachesLake);
    })
    .map((river) => {
      const end = riverEnd(river);

      return `river ${river.id} ends at ${Math.round(end.x)}, ${Math.round(end.z)}`;
    });
}

function lowestRiverWaterNear(terrain: TerrainData, grid: WorldGrid, cell: number): number {
  const waters = cellsAround(grid, cell, 1, grid.cellSize * WATER_LEVEL_CELLS)
    .filter((near) => {
      return isRiverWater(terrain, near);
    })
    .map((near) => {
      return terrain.waterSurface[near];
    });

  return Math.min(...waters);
}

function hangingRiverEdges(generated: GeneratedWorld): { edges: number; hanging: number } {
  const { terrain } = generated;

  const grid = new WorldGrid(generated.dimensions);
  let edges = 0;
  let hanging = 0;

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (hasWater(terrain.waterSurface[cell], terrain.height[cell]) || terrain.coastDistance[cell] < INLAND_REACH) {
      continue;
    }

    const neighbors = cellsAround(grid, cell, 1, grid.cellSize * NEIGHBOR_CELLS);

    const touchesLake = neighbors.some((near) => {
      return isLakeWater(terrain, near);
    });
    const touchesRiver = neighbors.some((near) => {
      return isRiverWater(terrain, near);
    });

    if (touchesLake || !touchesRiver) {
      continue;
    }

    edges += 1;

    if (terrain.height[cell] < lowestRiverWaterNear(terrain, grid, cell) - HANGING_SLACK) {
      hanging += 1;
    }
  }

  return { edges, hanging };
}

function bedDepthsBelowBanks(generated: GeneratedWorld): { all: number[]; sidehill: number[] } {
  const { terrain } = generated;

  const grid = new WorldGrid(generated.dimensions);
  const all: number[] = [];
  const sidehill: number[] = [];

  for (const river of generated.water.rivers) {
    for (let index = 2; index < river.points.length - 2; index += 1) {
      const point = river.points[index];
      const before = river.points[index - 2];
      const after = river.points[index + 2];
      const length = Math.max(1e-6, Math.hypot(after.x - before.x, after.z - before.z));
      const cell = grid.cellAt(point.x, point.z);

      const upstream = grid.cellAt(before.x, before.z);
      const downstream = grid.cellAt(after.x, after.z);
      const drop = terrain.waterSurface[upstream] - terrain.waterSurface[downstream];
      const isGentle =
        isRiverWater(terrain, upstream) && isRiverWater(terrain, downstream) && drop / length <= GENTLE_REACH_DROP;
      const isInland = terrain.coastDistance[cell] >= INLAND_REACH;

      if (!(isGentle && isInland && isRiverWater(terrain, cell))) {
        continue;
      }

      const offset = point.width / 2 + grid.cellSize;
      const banks = [-1, 1].map((side) => {
        return grid.cellAt(
          point.x - ((after.z - before.z) / length) * offset * side,
          point.z + ((after.x - before.x) / length) * offset * side
        );
      });

      const isDryLand = banks.every((bank) => {
        return isOnIsland(terrain.coastDistance, bank) && !hasWater(terrain.waterSurface[bank], terrain.height[bank]);
      });

      if (!isDryLand) {
        continue;
      }

      const depth = Math.min(terrain.height[banks[0]], terrain.height[banks[1]]) - terrain.height[cell];
      const uncarvedRise = Math.abs(
        terrain.height[banks[0]] + terrain.carving[banks[0]] - terrain.height[banks[1]] - terrain.carving[banks[1]]
      );

      all.push(depth);

      if (uncarvedRise / (2 * offset) > SIDEHILL_CROSS_SLOPE) {
        sidehill.push(depth);
      }
    }
  }

  return { all, sidehill };
}

function slopesAddedByCarving(generated: GeneratedWorld): number[] {
  const { terrain } = generated;

  const grid = new WorldGrid(generated.dimensions);
  const uncarved = terrain.height.map((height, cell) => {
    return height + terrain.carving[cell];
  });
  const added: number[] = [];

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    const isCarvedLand =
      terrain.carving[cell] > 1 &&
      terrain.coastDistance[cell] >= INLAND_REACH &&
      !hasWater(terrain.waterSurface[cell], terrain.height[cell]);

    if (isCarvedLand && !grid.isOnEdge(cell)) {
      added.push(slopeAt(terrain.height, grid, cell) - slopeAt(uncarved, grid, cell));
    }
  }

  return added;
}

function distanceToWaterfall(generated: GeneratedWorld, grid: WorldGrid, cell: number): number {
  const x = grid.cellCenterX(cell);
  const z = grid.cellCenterZ(cell);

  return Math.min(
    ...generated.water.waterfalls.map((waterfall) => {
      return Math.hypot(waterfall.x - x, waterfall.z - z);
    })
  );
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
    if (!(isLakeWater(terrain, cell) && levels.has(terrain.waterSurface[cell]))) {
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

function surveyIsland(generated: GeneratedWorld): IslandSurvey {
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

beforeAll(() => {
  world = testWorld(7);
  squareWorld = testWorld(7, "square");
});

describe("world generation", () => {
  it("reports every stage", () => {
    expect([...stages].sort()).toEqual(["climate", "erosion", "relief", "vegetation", "water"]);
  });

  it("sketches the island as it forms", () => {
    expect(sketches.get("relief")).toBeNull();
    expect(sketches.get("erosion")).toMatchObject({ ground: null, waterSurface: null });
    expect(sketches.get("climate")).toMatchObject({ ground: null, waterSurface: expect.any(Float32Array) });
    expect(sketches.get("vegetation")).toMatchObject({
      ground: expect.any(Uint8Array),
      waterSurface: expect.any(Float32Array),
    });
  });

  it("differs between seeds", () => {
    const other = testWorld(8);

    expect(other.terrain.height).not.toEqual(world.terrain.height);
  });

  it("builds mountains, lowlands and a lake basin", () => {
    let highest = Number.NEGATIVE_INFINITY;
    let lowest = Number.POSITIVE_INFINITY;

    for (const height of squareWorld.terrain.height) {
      highest = Math.max(highest, height);
      lowest = Math.min(lowest, height);
    }

    expect(highest).toBeGreaterThan(900);
    expect(lowest).toBeLessThan(200);
    expect(squareWorld.water.lakes.length).toBeGreaterThanOrEqual(3);
  });

  it("raises mountains and a lake on the round island too", () => {
    const heights = world.terrain.height.filter((_, cell) => {
      return isOnIsland(world.terrain.coastDistance, cell);
    });

    expect(Math.max(...heights)).toBeGreaterThan(900);
    expect(Math.min(...heights)).toBeLessThan(200);
    expect(world.water.lakes.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps the square island whole to its edges", () => {
    expect(
      squareWorld.terrain.coastDistance.every((distance) => {
        return distance > 0;
      })
    ).toBe(true);
  });

  it("covers lake cells with water at the lake level", () => {
    const lake = world.water.lakes.at(0);
    const grid = new WorldGrid(TEST_DIMENSIONS);

    expect(lake).toBeDefined();

    if (lake === undefined) {
      return;
    }

    const cell = grid.cellAt(lake.centerX, lake.centerZ);

    const surface = world.terrain.waterSurface[cell];

    expect(surface).not.toBe(NO_WATER);
  });

  it("traces rivers that flow downhill", () => {
    expect(world.water.rivers.length).toBeGreaterThan(0);

    for (const river of world.water.rivers) {
      const surfaces = river.points.map((point) => {
        return point.surface;
      });

      for (let pointIndex = 1; pointIndex < surfaces.length; pointIndex += 1) {
        expect(surfaces[pointIndex]).toBeLessThanOrEqual(surfaces[pointIndex - 1] + 1e-3);
      }
    }
  });

  it("keeps the water of every river falling from its source to its mouth on several seeds and both shapes", () => {
    for (const seed of [3, 7, 11, 19]) {
      for (const shape of ISLAND_SHAPES) {
        const generated = testWorld(seed, shape);

        expect(generated.water.rivers.length).toBeGreaterThan(0);
        expect(riverFaults(generated)).toEqual([]);
      }
    }
  });

  it("runs the rivers that leave the island past the coast to the top of their waterfalls", () => {
    for (const generated of [world, squareWorld, testWorld(11), testWorld(11, "square")]) {
      expect(generated.water.waterfalls.length).toBeGreaterThan(0);
      expect(mouthFaults(generated)).toEqual([]);
    }
  });

  it("keeps distinct rivers apart instead of running them side by side on several seeds and both shapes", () => {
    for (const seed of [3, 7, 11]) {
      for (const shape of ISLAND_SHAPES) {
        const generated = testWorld(seed, shape);

        expect(closestDistinctRivers(generated)).toBeGreaterThan(SMALLEST_RIVER_GAP);
      }
    }
  });

  it("starts every river at a pond or a cave facing down the river", () => {
    for (const generated of [world, squareWorld, testWorld(11), testWorld(19, "square")]) {
      expect(generated.water.springs.length).toBeGreaterThan(0);
      expect(headFaults(generated)).toEqual([]);
    }
  });

  it("digs ponds as still water at the level of the river head and keeps plants off every spring", () => {
    const grid = new WorldGrid(TEST_DIMENSIONS);
    const ponds = pondsOf(world);

    expect(ponds.length).toBeGreaterThan(0);

    for (const pond of ponds) {
      const cell = grid.cellAt(pond.x, pond.z);

      expect(hasWater(world.terrain.waterSurface[cell], world.terrain.height[cell])).toBe(true);
      expect(world.terrain.waterSurface[cell]).toBeCloseTo(pond.level, 1);
      expect(world.terrain.riverStrength[cell]).toBe(0);
    }

    const springGround = new Set(
      world.water.springs.flatMap((spring) => {
        return spring.cells;
      })
    );

    for (let plant = 0; plant < world.vegetation.count; plant += 1) {
      expect(springGround.has(grid.cellAt(world.vegetation.x[plant], world.vegetation.z[plant]))).toBe(false);
    }
  });

  it("lets rivers leave the island as waterfalls", () => {
    const edgeRivers = world.water.rivers.filter((river) => {
      return river.reachesEdge;
    });

    expect(world.water.waterfalls).toHaveLength(edgeRivers.length);

    for (const waterfall of world.water.waterfalls) {
      expect(Math.hypot(waterfall.directionX, waterfall.directionZ)).toBeCloseTo(1);
    }
  });

  it("points every waterfall out of the island, the way its river leaves", () => {
    for (const generated of [world, squareWorld]) {
      const grid = new WorldGrid(generated.dimensions);

      for (const { directionX, directionZ, x, z } of generated.water.waterfalls) {
        const upstream = sampleHeight(generated.terrain.coastDistance, grid, x - directionX * 30, z - directionZ * 30);

        expect(upstream).toBeGreaterThan(sampleHeight(generated.terrain.coastDistance, grid, x, z));
      }
    }
  });

  it("keeps every plant clear of the coast so none hangs over the edge", () => {
    const grid = new WorldGrid(TEST_DIMENSIONS);

    for (let plant = 0; plant < world.vegetation.count; plant += 1) {
      const x = world.vegetation.x[plant];
      const z = world.vegetation.z[plant];

      expect(sampleHeight(world.terrain.coastDistance, grid, x, z)).toBeGreaterThan(6);
    }
  });

  it("rounds the island off with a coast inside the square", () => {
    const grid = new WorldGrid(TEST_DIMENSIONS);
    const last = grid.cellsPerSide - 1;
    const middle = Math.floor(grid.cellsPerSide / 2);

    for (const corner of [grid.index(0, 0), grid.index(last, 0), grid.index(0, last), grid.index(last, last)]) {
      expect(isOnIsland(world.terrain.coastDistance, corner)).toBe(false);
    }

    expect(isOnIsland(world.terrain.coastDistance, grid.index(middle, middle))).toBe(true);

    for (let plant = 0; plant < world.vegetation.count; plant += 1) {
      const cell = grid.cellAt(world.vegetation.x[plant], world.vegetation.z[plant]);

      expect(isOnIsland(world.terrain.coastDistance, cell)).toBe(true);
    }

    const fallingWater = Array.from({ length: grid.cellCount }, (_, cell) => {
      return cell;
    }).filter((cell) => {
      return !isOnIsland(world.terrain.coastDistance, cell) && world.terrain.waterSurface[cell] !== NO_WATER;
    });

    for (const cell of fallingWater) {
      expect(distanceToWaterfall(world, grid, cell)).toBeLessThan(grid.cellSize * 2);
    }
  });

  it("classifies water cells as water and plants nothing in them", () => {
    const grid = new WorldGrid(TEST_DIMENSIONS);

    const waterCells = Array.from({ length: grid.cellCount }, (_, cell) => {
      return cell;
    }).filter((cell) => {
      return hasWater(world.terrain.waterSurface[cell], world.terrain.height[cell]);
    });

    for (const cell of waterCells) {
      expect(world.terrain.biome[cell]).toBe(Biome.Water);
    }

    for (let plant = 0; plant < world.vegetation.count; plant += 1) {
      const cell = grid.cellAt(world.vegetation.x[plant], world.vegetation.z[plant]);

      expect(hasWater(world.terrain.waterSurface[cell], world.terrain.height[cell])).toBe(false);
    }
  });

  it("keeps the square island rim at a moderate height", () => {
    const grid = new WorldGrid(TEST_DIMENSIONS);

    const rim = edgeSides(grid).flatMap((side) => {
      return side.map((cell) => {
        return squareWorld.terrain.height[cell];
      });
    });

    expect(Math.min(...rim)).toBeGreaterThan(120);
    expect(Math.max(...rim)).toBeLessThan(400);
  });

  it("eases the round island down to a low shore", () => {
    const grid = new WorldGrid(TEST_DIMENSIONS);

    const shore = coastCells(world.terrain, grid).map((cell) => {
      return world.terrain.height[cell];
    });

    expect(Math.min(...shore)).toBeGreaterThan(30);
    expect(Math.max(...shore)).toBeLessThan(300);
  });

  it("keeps slopes realistic, with few cliffs", () => {
    const slopes = slopesOf(world.terrain, new WorldGrid(TEST_DIMENSIONS));

    const meanSlope =
      (Math.atan(
        slopes.reduce((total, slope) => {
          return total + slope;
        }, 0) / slopes.length
      ) *
        180) /
      Math.PI;

    expect(meanSlope).toBeGreaterThan(14);
    expect(meanSlope).toBeLessThan(24);
    expect(shareAbove(slopes, STEEP)).toBeLessThan(0.03);
    expect(shareAbove(slopes, CLIFF)).toBeLessThan(0.001);
  });

  it("sinks rivers into valleys below the land around them", () => {
    const { terrain } = world;

    const grid = new WorldGrid(TEST_DIMENSIONS);
    const depths: number[] = [];

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      if (!isRiverWater(terrain, cell)) {
        continue;
      }

      const land = cellsAround(grid, cell, 60, 100).filter((other) => {
        return !hasWater(terrain.waterSurface[other], terrain.height[other]);
      });

      if (land.length > 0) {
        depths.push(
          land.reduce((total, other) => {
            return total + terrain.height[other];
          }, 0) /
            land.length -
            terrain.waterSurface[cell]
        );
      }
    }

    expect(depths.length).toBeGreaterThan(100);
    expect(median(depths)).toBeGreaterThan(5);
  });

  it("lines warm, low river banks outside wetlands with sand and keeps trees off it", () => {
    const { terrain, vegetation } = world;

    const grid = new WorldGrid(TEST_DIMENSIONS);
    const banks = new Set<number>();

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      if (!isRiverWater(terrain, cell)) {
        continue;
      }

      for (const bank of cellsAround(grid, cell, 1, grid.cellSize * 1.5)) {
        const isLow = terrain.height[bank] < terrain.waterSurface[cell] + 1.5;
        const isGentle = slopeAt(terrain.height, grid, bank) < 0.25;
        const isWarm = terrain.baseTemperature[bank] > 4;

        const isWetland = terrain.ground[bank] === Ground.Swamp || terrain.ground[bank] === Ground.Bog;

        if (isLow && isGentle && isWarm && !isWetland && !hasWater(terrain.waterSurface[bank], terrain.height[bank])) {
          banks.add(bank);
        }
      }
    }

    const sandy = [...banks].filter((bank) => {
      return terrain.ground[bank] === Ground.Sand;
    });

    expect(banks.size).toBeGreaterThan(50);
    expect(sandy.length / banks.size).toBeGreaterThan(0.8);

    const trees = Array.from({ length: vegetation.count }, (_, plant) => {
      return plant;
    }).filter((plant) => {
      return isTreeSpecies(vegetation.species[plant]);
    });

    for (const tree of trees) {
      expect(terrain.ground[grid.cellAt(vegetation.x[tree], vegetation.z[tree])]).not.toBe(Ground.Sand);
    }
  });

  it("plants nothing on ground steeper than its species can hold", () => {
    expect(misplacedPlants(world)).toEqual([]);
  });

  it("opens glades, sparse stands and riverside meadows in the forests", () => {
    const { terrain } = world;

    const grid = new WorldGrid(TEST_DIMENSIONS);
    const wooded = Array.from({ length: grid.cellCount }, (_, cell) => {
      return cell;
    }).filter((cell) => {
      return isWooded(terrain, cell);
    });

    const densities = wooded.map((cell) => {
      return terrain.woodland[cell];
    });
    const mean =
      densities.reduce((total, density) => {
        return total + density;
      }, 0) / densities.length;

    const banks = wooded.filter((cell) => {
      return nearWater(terrain, grid, cell, 50);
    });
    const bankMean =
      banks.reduce((total, cell) => {
        return total + terrain.woodland[cell];
      }, 0) / banks.length;

    expect(wooded.length).toBeGreaterThan(1000);
    expect(mean).toBeGreaterThan(0.5);
    expect(mean).toBeLessThan(0.85);
    expect(
      densities.filter((density) => {
        return density < 0.05;
      }).length / densities.length
    ).toBeGreaterThan(0.025);
    expect(
      densities.filter((density) => {
        return density > 0.85;
      }).length / densities.length
    ).toBeGreaterThan(0.2);
    expect(bankMean).toBeLessThan(mean * 0.7);

    for (const cell of wooded.filter((woodedCell) => {
      return terrain.woodland[woodedCell] < 0.3;
    })) {
      expect(terrain.ground[cell]).not.toBe(Ground.Forest);
    }
  });

  it("grows no wild plant where the woodland turns it away", () => {
    const { terrain, vegetation } = world;

    const grid = new WorldGrid(TEST_DIMENSIONS);

    for (let plant = 0; plant < vegetation.count; plant += 1) {
      const cell = grid.cellAt(vegetation.x[plant], vegetation.z[plant]);

      expect(admitsWildPlant(terrain, grid, cell, vegetation.species[plant])).toBe(true);
    }
  });

  it("produces many biomes and a living vegetation cover", () => {
    const biomes = new Set(world.terrain.biome);

    expect(biomes.size).toBeGreaterThanOrEqual(8);
    expect(world.vegetation.aliveCount).toBeGreaterThan(1000);
  });
});

describe.each(ISLAND_SHAPES)("a %s world generated twice from one seed", (shape) => {
  test("comes out the same in every stage", () => {
    const options = { dimensions: DETERMINISM_DIMENSIONS, erosionStrength: 1, shape };

    const firsts = DETERMINISM_SEEDS.map((seed) => {
      return generateWorld(seed, options);
    });

    expect(
      firsts.some((first) => {
        return first.crossings.length > 0;
      })
    ).toBe(true);
    expect(
      firsts.some((first) => {
        return first.deposits.length > 0;
      })
    ).toBe(true);
    expect(
      firsts.some((first) => {
        return first.monuments.length > 0;
      })
    ).toBe(true);

    for (const [index, seed] of DETERMINISM_SEEDS.entries()) {
      const again = generateWorld(seed, options);

      expect(again).toEqual(firsts[index]);
      expect(again.vegetation.exportBuffers()).toEqual(firsts[index].vegetation.exportBuffers());
    }
  });
});

describe("full-size island rim", () => {
  let fullSize: GeneratedWorld;
  let fullSquare: GeneratedWorld;

  beforeAll(() => {
    fullSize = generateWorld(7);
    fullSquare = generateWorld(1, { ...DEFAULT_GENERATION_OPTIONS, shape: "square" });
  }, 60_000);

  it("meets the square cliff at a moderate height without steps that could open gaps", () => {
    const grid = new WorldGrid(fullSquare.dimensions);

    const { height } = fullSquare.terrain;

    for (const side of edgeSides(grid)) {
      const heights = side.map((cell) => {
        return height[cell];
      });

      expect(Math.min(...heights)).toBeGreaterThan(120);
      expect(Math.max(...heights)).toBeLessThan(400);
      expect(largestStepAlong(height, side)).toBeLessThan(15);
    }
  });

  it("meets the round coast at a moderate height", () => {
    const shore = coastCells(fullSize.terrain, new WorldGrid(fullSize.dimensions)).map((cell) => {
      return fullSize.terrain.height[cell];
    });

    expect(Math.min(...shore)).toBeGreaterThan(100);
    expect(Math.max(...shore)).toBeLessThan(300);
  });

  it("lowers the banks of rivers to just above the water beside them on both shapes", () => {
    for (const generated of [fullSize, fullSquare]) {
      const rises = bankRises(generated.terrain, new WorldGrid(generated.dimensions));

      expect(rises.length).toBeGreaterThan(2000);
      expect(median(rises)).toBeLessThan(0.3);
      expect(quantile(rises, 0.9)).toBeLessThan(0.5);
    }
  });

  it("keeps full-size rivers falling all the way to the coast and their waterfalls on both shapes", () => {
    for (const generated of [fullSize, fullSquare]) {
      expect(riverFaults(generated)).toEqual([]);
      expect(mouthFaults(generated)).toEqual([]);
    }
  });

  it("keeps the full-size rivers apart on both shapes", () => {
    expect(closestDistinctRivers(fullSize)).toBeGreaterThan(SMALLEST_RIVER_GAP);
    expect(closestDistinctRivers(fullSquare)).toBeGreaterThan(SMALLEST_RIVER_GAP);
  });

  it("bends full-size rivers instead of running them dead straight down even slopes on both shapes", () => {
    expect(straightRiverShare(fullSize)).toBeLessThan(0.05);
    expect(straightRiverShare(fullSquare)).toBeLessThan(0.05);
  });

  it("starts every full-size river at a pond or a cave on both shapes", () => {
    for (const generated of [fullSize, fullSquare]) {
      const kinds = new Set(
        generated.water.springs.map((spring) => {
          return spring.kind;
        })
      );

      expect(headFaults(generated)).toEqual([]);
      expect([...kinds].sort()).toEqual([...SPRING_KINDS].sort());
    }
  });

  it("digs spring ponds larger than before and of varied shapes on both shapes", () => {
    for (const generated of [fullSize, fullSquare]) {
      const grid = new WorldGrid(generated.dimensions);
      const ponds = pondsOf(generated);

      const areas = ponds.map((pond) => {
        return pondWaterCells(generated, grid, pond).length * grid.cellSize * grid.cellSize;
      });

      expect(ponds.length).toBeGreaterThan(5);
      expect(meanOf(areas)).toBeGreaterThan(SMALLEST_MEAN_POND_AREA);
      expect(meanOf(ponds.map(outlineSpread))).toBeGreaterThan(LEAST_MEAN_OUTLINE_SPREAD);
      expect(
        new Set(
          ponds.map((pond) => {
            return outlineSpread(pond).toFixed(2);
          })
        ).size
      ).toBeGreaterThan(ponds.length / 2);
    }
  });

  it("keeps each spring pond at its river head, inland and clear of rivers, caves and other ponds", () => {
    expect(pondFaults(fullSize)).toEqual([]);
    expect(pondFaults(fullSquare)).toEqual([]);
  });

  it("keeps every plant of the full island off water and off ground too steep for it", () => {
    expect(misplacedPlants(fullSize)).toEqual([]);
    expect(misplacedPlants(fullSquare)).toEqual([]);
  });

  it("keeps the trees of the full island apart", () => {
    expect(closestTreeGap(fullSize)).toBeGreaterThanOrEqual(TREE_SPACING - FLOAT_SLACK);
    expect(closestTreeGap(fullSquare)).toBeGreaterThanOrEqual(TREE_SPACING - FLOAT_SLACK);
  });

  it("grows several swamps with pools on low, flat, wet ground on both shapes", () => {
    for (const generated of [fullSize, fullSquare]) {
      const survey = surveySwamps(generated);

      expect(survey.faults).toEqual([]);
      expect(survey.swampCells / survey.landCells).toBeGreaterThan(0.01);
      expect(survey.swampCells / survey.landCells).toBeLessThan(0.07);
      expect(survey.patches).toBeGreaterThanOrEqual(4);
      expect(survey.poolCells).toBeGreaterThan(survey.swampCells * 0.03);
    }
  });

  it("has few slopes steeper than 45 degrees and almost none steeper than 55", () => {
    const slopes = slopesOf(fullSize.terrain, new WorldGrid(fullSize.dimensions));

    expect(shareAbove(slopes, STEEP)).toBeLessThan(0.03);
    expect(shareAbove(slopes, CLIFF)).toBeLessThan(0.0005);
  });
});

describe("islands across seeds", () => {
  const options = { dimensions: VARIETY_DIMENSIONS, erosionStrength: 1 };
  const surveys: IslandSurvey[] = [];

  beforeAll(() => {
    for (const seed of VARIETY_SEEDS) {
      surveys.push(surveyIsland(generateWorld(seed, { ...options, shape: "round" })));
    }

    for (const seed of VARIETY_SEEDS.slice(0, 6)) {
      surveys.push(surveyIsland(generateWorld(seed, { ...options, shape: "square" })));
    }
  }, 60_000);

  it("turns the highest ground toward most points of the compass", () => {
    const octants = new Set(
      surveys.map((survey) => {
        return (Math.round(survey.highGroundAngle / (Math.PI / 4)) + 8) % 8;
      })
    );

    expect(octants.size).toBeGreaterThanOrEqual(6);
  });

  it("mixes the biomes differently, within bounds", () => {
    const forests = surveys.map((survey) => {
      return survey.shares.forest;
    });
    const colds = surveys.map((survey) => {
      return survey.shares.cold;
    });
    const deserts = surveys.map((survey) => {
      return survey.shares.desert;
    });

    expect(Math.max(...forests) - Math.min(...forests)).toBeGreaterThan(0.15);
    expect(Math.max(...colds) - Math.min(...colds)).toBeGreaterThan(0.03);
    expect(
      deserts.filter((share) => {
        return share < 0.005;
      }).length
    ).toBeGreaterThanOrEqual(2);
    expect(
      deserts.filter((share) => {
        return share > 0.08;
      }).length
    ).toBeGreaterThanOrEqual(2);

    for (const { shares } of surveys) {
      expect(shares.forest).toBeGreaterThan(0.3);
      expect(shares.forest).toBeLessThan(0.85);
      expect(shares.desert).toBeLessThan(0.2);
      expect(shares.cold).toBeLessThan(0.25);
      expect(shares.swamp).toBeGreaterThan(0.001);
      expect(shares.swamp).toBeLessThan(0.07);
    }
  });

  it("rises gently from the shore of every lake, with no mountain standing in the water", () => {
    for (const survey of surveys) {
      expect(survey.lakeShoreRise).toBeLessThan(HIGHEST_LAKE_SHORE);
    }
  });

  it("leaves every island enough flat land, rivers and a lake", () => {
    for (const survey of surveys) {
      expect(survey.flatShare).toBeGreaterThan(0.06);
      expect(survey.rivers).toBeGreaterThanOrEqual(15);
      expect(survey.lakes).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("full-size river joins", () => {
  let worlds: GeneratedWorld[];

  beforeAll(() => {
    worlds = [
      generateWorld(10),
      generateWorld(1),
      generateWorld(3, { ...DEFAULT_GENERATION_OPTIONS, shape: "square" }),
      generateWorld(8, { ...DEFAULT_GENERATION_OPTIONS, shape: "square" }),
    ];
  }, 180_000);

  it("joins no river into another just below its cave or pond on several seeds and both shapes", () => {
    for (const generated of worlds) {
      expect(joinsNearSources(generated)).toEqual([]);
    }
  });

  it("ends every river in water: past the coast, in a lake or in another river", () => {
    for (const generated of worlds) {
      expect(endsAwayFromWater(generated)).toEqual([]);
    }
  });

  it("keeps the land beside every river at least as high as its water on several seeds and both shapes", () => {
    for (const generated of worlds) {
      const { edges, hanging } = hangingRiverEdges(generated);

      expect(edges).toBeGreaterThan(3000);
      expect(hanging / edges).toBeLessThan(0.005);
    }
  });

  it("sinks river beds below both banks, across hillsides too", () => {
    for (const generated of worlds) {
      const { all, sidehill } = bedDepthsBelowBanks(generated);

      expect(all.length).toBeGreaterThan(500);
      expect(sidehill.length).toBeGreaterThan(50);
      expect(1 - shareAbove(all, SHALLOWEST_BED)).toBeLessThan(0.08);
      expect(1 - shareAbove(sidehill, SHALLOWEST_BED)).toBeLessThan(0.22);
      expect(median(sidehill)).toBeGreaterThan(0.8);
    }
  });

  it("blends cut banks gently into the land around them", () => {
    for (const generated of worlds) {
      const added = slopesAddedByCarving(generated);

      expect(quantile(added, 0.9)).toBeLessThan(0.25);
      expect(quantile(added, 0.99)).toBeLessThan(0.65);
    }
  });
});

describe("small and large islands", () => {
  let small: GeneratedWorld;
  let large: GeneratedWorld;
  let largeSquare: GeneratedWorld;

  beforeAll(() => {
    small = generateWorld(7, { ...DEFAULT_GENERATION_OPTIONS, dimensions: islandDimensions("small") });
    large = generateWorld(1, { ...DEFAULT_GENERATION_OPTIONS, dimensions: islandDimensions("large") });
    largeSquare = generateWorld(2, {
      ...DEFAULT_GENERATION_OPTIONS,
      dimensions: islandDimensions("large"),
      shape: "square",
    });
  }, 180_000);

  it("grows each island on its own grid", () => {
    expect(small.dimensions).toEqual(islandDimensions("small"));
    expect(small.terrain.height).toHaveLength(512 * 512);
    expect(large.terrain.height).toHaveLength(768 * 768);
  });

  it("ends every river in water and keeps it falling to its mouth", () => {
    for (const generated of [small, large, largeSquare]) {
      expect(endsAwayFromWater(generated)).toEqual([]);
      expect(riverFaults(generated)).toEqual([]);
      expect(mouthFaults(generated)).toEqual([]);
    }
  });

  it("leaves flat land, rivers and lakes, more of them on the larger island", () => {
    const smallSurvey = surveyIsland(small);
    const largeSurvey = surveyIsland(large);

    for (const survey of [smallSurvey, largeSurvey, surveyIsland(largeSquare)]) {
      expect(survey.flatShare).toBeGreaterThan(0.06);
      expect(survey.lakes).toBeGreaterThanOrEqual(1);
      expect(survey.rivers).toBeGreaterThanOrEqual(8);
    }

    expect(largeSurvey.rivers).toBeGreaterThan(smallSurvey.rivers);
  });

  it("plants as densely on the large island as on the small one", () => {
    const densities = [small, large].map((generated) => {
      const landCells = generated.terrain.coastDistance.filter((distance) => {
        return distance > 0;
      }).length;

      return generated.vegetation.count / landCells;
    });

    const [smallDensity = 0, largeDensity = 0] = densities;

    expect(largeDensity / smallDensity).toBeGreaterThan(0.75);
    expect(largeDensity / smallDensity).toBeLessThan(1.33);
    expect(large.vegetation.count).toBeGreaterThan(small.vegetation.count);
  });

  it("grows the same small island from the same seed", () => {
    const again = generateWorld(7, { ...DEFAULT_GENERATION_OPTIONS, dimensions: islandDimensions("small") });

    expect(generationFingerprint(again)).toBe(generationFingerprint(small));
  }, 60_000);
});
