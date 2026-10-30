import { Biome } from "../../content/biomes.ts";
import { Ground } from "../../content/grounds.ts";
import { clamp, saturate, smoothstep } from "../../shared/math.ts";
import type { RandomSource } from "../../shared/random.ts";
import { type CellRegion, regionOfCells } from "../../world/change-tracking.ts";
import type { River, RiverPoint } from "../../world/water.ts";
import type { WorldState } from "./world-state.ts";

const UNEDITABLE_RIM = 2;
const CRATER_RIM_REACH = 1.35;
const CRATER_RIM_HEIGHT = 0.28;
const CRATER_RIM_WIDTH = 0.24;
const CAPTURED_RIVER_REACH = 0.9;
const BREACH_FLANK_CELLS = 2;
const CRATER_WALL_SLOPE = 0.6;
const DESERT_DRYNESS = 0.5;
const QUAKE_BLUR_CELLS = 2;
const QUAKE_SWELL = 3;
const CONE_FLANK_CURVE = 1.5;
const CRATER_DEPTH_SHARE = 0.3;

interface CircleArea {
  radius: number;
  x: number;
  z: number;
}

interface AreaCell {
  cell: number;
  column: number;
  distance: number;
  row: number;
}

interface Cone extends CircleArea {
  readonly craterShare: number;
}

interface Leveling {
  readonly keptRelief: number;
  readonly largestChange: number;
  readonly level: number;
}

function areaRegion(world: WorldState, area: CircleArea): CellRegion {
  return world.grid.circleBounds(area.x, area.z, area.radius);
}

export function cellsInArea(world: WorldState, area: CircleArea): AreaCell[] {
  const { grid } = world;

  const region = areaRegion(world, area);
  const cells: AreaCell[] = [];

  for (let row = region.firstRow; row <= region.lastRow; row += 1) {
    const deltaZ = grid.centerZ(row) - area.z;

    for (let column = region.firstColumn; column <= region.lastColumn; column += 1) {
      const deltaX = grid.centerX(column) - area.x;

      const distance = Math.hypot(deltaX, deltaZ);

      if (distance <= area.radius) {
        cells.push({ cell: grid.index(column, row), column, distance, row });
      }
    }
  }

  return cells;
}

export function brushFalloff(distance: number, radius: number): number {
  return 0.5 + 0.5 * Math.cos((Math.min(distance, radius) / radius) * Math.PI);
}

function editableCells(world: WorldState, area: CircleArea): AreaCell[] {
  const lastEditable = world.grid.cellsPerSide - UNEDITABLE_RIM;

  return cellsInArea(world, area).filter((areaCell) => {
    return (
      areaCell.column >= UNEDITABLE_RIM &&
      areaCell.row >= UNEDITABLE_RIM &&
      areaCell.column < lastEditable &&
      areaCell.row < lastEditable
    );
  });
}

export function raiseTerrain(
  world: WorldState,
  area: CircleArea,
  amount: number,
  profile = (distance: number) => {
    return brushFalloff(distance, area.radius);
  }
): void {
  const cells = editableCells(world, area);

  if (cells.length === 0) {
    return;
  }

  for (const areaCell of cells) {
    const { cell } = areaCell;

    world.setHeight(cell, world.terrain.height[cell] + amount * profile(areaCell.distance));
    firmUpDriedLakebed(world, cell, amount);
  }

  world.finishHeightEdit(areaRegion(world, area));
}

function coneProfile(cone: Cone, distance: number): number {
  const relativeDistance = distance / cone.radius;

  if (relativeDistance >= 1) {
    return 0;
  }

  const flank = ((1 - Math.max(relativeDistance, cone.craterShare)) / (1 - cone.craterShare)) ** CONE_FLANK_CURVE;
  const bowl = Math.max(0, 1 - (relativeDistance / cone.craterShare) ** 2);

  return flank - bowl * CRATER_DEPTH_SHARE;
}

export function swellCone(world: WorldState, cone: Cone, amount: number): void {
  raiseTerrain(world, cone, amount, (distance) => {
    return coneProfile(cone, distance);
  });
}

function firmUpDriedLakebed(world: WorldState, cell: number, amount: number): void {
  if (amount <= 0 || world.isWater(cell)) {
    return;
  }

  if (world.terrain.biome[cell] === Biome.Water && world.terrain.ground[cell] === Ground.Sand) {
    world.setGround(cell, Ground.Dirt);
  }
}

export function flattenTerrain(world: WorldState, area: CircleArea, targetHeight: number, strength: number): void {
  const cells = editableCells(world, area);

  if (cells.length === 0) {
    return;
  }

  for (const areaCell of cells) {
    const height = world.terrain.height[areaCell.cell];
    const amount = saturate(brushFalloff(areaCell.distance, area.radius) * strength);

    world.setHeight(areaCell.cell, height + (targetHeight - height) * amount);
    fillInCarving(world, areaCell.cell, amount);
  }

  world.finishHeightEdit(areaRegion(world, area));
}

function fillInCarving(world: WorldState, cell: number, amount: number): void {
  world.terrain.carving[cell] *= 1 - amount;
}

export function levelGround(world: WorldState, cells: readonly number[], leveling: Leveling): void {
  const { keptRelief, largestChange, level } = leveling;

  if (cells.length === 0) {
    return;
  }

  for (const cell of cells) {
    const height = world.terrain.height[cell];

    const change = (level - height) * (1 - keptRelief);

    world.setHeight(cell, height + clamp(change, -largestChange, largestChange));
    fillInCarving(world, cell, 1);
  }

  world.finishHeightEdit(regionOfCells(world.grid, cells, 1));
}

export function smoothTerrain(world: WorldState, area: CircleArea, strength: number): void {
  const heights = world.terrain.height;
  const { cellsPerSide } = world.grid;

  const cells = editableCells(world, area);

  if (cells.length === 0) {
    return;
  }

  const targets = cells.map((areaCell) => {
    const { cell } = areaCell;

    const average =
      (heights[cell - 1] +
        heights[cell + 1] +
        heights[cell - cellsPerSide] +
        heights[cell + cellsPerSide] +
        heights[cell - cellsPerSide - 1] +
        heights[cell - cellsPerSide + 1] +
        heights[cell + cellsPerSide - 1] +
        heights[cell + cellsPerSide + 1]) /
      8;

    const amount = saturate(brushFalloff(areaCell.distance, area.radius) * strength);

    return { amount, cell, height: heights[cell] + (average - heights[cell]) * amount };
  });

  for (const target of targets) {
    world.setHeight(target.cell, target.height);
    fillInCarving(world, target.cell, target.amount);
  }

  world.finishHeightEdit(areaRegion(world, area));
}

function distanceFromCenter(area: CircleArea, point: RiverPoint): number {
  return Math.hypot(point.x - area.x, point.z - area.z);
}

function firstCapturedPoint(river: River, crater: CircleArea): number {
  return river.points.findIndex((point) => {
    return distanceFromCenter(crater, point) < crater.radius * CAPTURED_RIVER_REACH;
  });
}

function opennessAt(breach: ReadonlyMap<number, number>, cell: number): number {
  const openness = breach.get(cell);

  if (openness === undefined) {
    return 0;
  }

  return openness;
}

function openChannel(world: WorldState, point: RiverPoint, breach: Map<number, number>): void {
  const { grid } = world;

  const open = point.width / 2 + grid.cellSize;
  const flank = open + BREACH_FLANK_CELLS * grid.cellSize;

  for (const cell of grid.cellsInRadius(point.x, point.z, flank)) {
    const distance = Math.hypot(grid.cellCenterX(cell) - point.x, grid.cellCenterZ(cell) - point.z);

    const openness = 1 - smoothstep(open, flank, distance);

    if (openness > opennessAt(breach, cell)) {
      breach.set(cell, openness);
    }
  }
}

function riverBreach(world: WorldState, crater: CircleArea, rimReach: number): Map<number, number> {
  const breach = new Map<number, number>();

  for (const river of world.water.rivers) {
    const inflow = river.points.slice(0, firstCapturedPoint(river, crater) + 1);

    for (const point of inflow) {
      if (distanceFromCenter(crater, point) <= rimReach + point.width) {
        openChannel(world, point, breach);
      }
    }
  }

  return breach;
}

export function carveCrater(world: WorldState, crater: CircleArea, depth: number): void {
  const reach: CircleArea = { ...crater, radius: crater.radius * CRATER_RIM_REACH };
  const cells = editableCells(world, reach);

  if (cells.length === 0) {
    return;
  }

  const breach = riverBreach(world, crater, reach.radius);

  for (const areaCell of cells) {
    const relativeDistance = areaCell.distance / crater.radius;

    const bowl = -depth * Math.max(0, 1 - relativeDistance * relativeDistance);
    const rim = depth * CRATER_RIM_HEIGHT * Math.exp(-(((relativeDistance - 1) / CRATER_RIM_WIDTH) ** 2));
    const standingRim = rim * (1 - opennessAt(breach, areaCell.cell));

    world.setHeight(areaCell.cell, world.terrain.height[areaCell.cell] + bowl + standingRim);
  }

  bareCraterWalls(world, cells);
  world.finishSuddenHeightEdit(areaRegion(world, reach));
}

function bareCraterWalls(world: WorldState, cells: readonly AreaCell[]): void {
  for (const { cell } of cells) {
    if (world.slope(cell) > CRATER_WALL_SLOPE) {
      world.setGround(cell, world.terrain.dryness[cell] > DESERT_DRYNESS ? Ground.RedRock : Ground.Rock);
    }
  }
}

export function shakeTerrain(world: WorldState, area: CircleArea, magnitude: number, random: RandomSource): void {
  const cells = editableCells(world, area);

  if (cells.length === 0) {
    return;
  }

  const region = areaRegion(world, area);
  const width = region.lastColumn - region.firstColumn + 1;
  const jolts = new Float32Array(width * (region.lastRow - region.firstRow + 1));

  for (const areaCell of cells) {
    const closeness = 1 - areaCell.distance / area.radius;

    jolts[(areaCell.row - region.firstRow) * width + areaCell.column - region.firstColumn] =
      closeness * (random.next() - 0.45) * 5 * magnitude;
  }

  for (const areaCell of cells) {
    const swell = averageJolt(jolts, width, areaCell.column - region.firstColumn, areaCell.row - region.firstRow);

    world.setHeight(areaCell.cell, world.terrain.height[areaCell.cell] + swell * QUAKE_SWELL);
  }

  world.finishSuddenHeightEdit(region);
}

function averageJolt(jolts: Float32Array, width: number, column: number, row: number): number {
  const rows = jolts.length / width;

  let total = 0;
  let count = 0;

  for (let rowOffset = -QUAKE_BLUR_CELLS; rowOffset <= QUAKE_BLUR_CELLS; rowOffset += 1) {
    for (let columnOffset = -QUAKE_BLUR_CELLS; columnOffset <= QUAKE_BLUR_CELLS; columnOffset += 1) {
      const neighborColumn = column + columnOffset;
      const neighborRow = row + rowOffset;

      if (neighborColumn >= 0 && neighborRow >= 0 && neighborColumn < width && neighborRow < rows) {
        total += jolts[neighborRow * width + neighborColumn];
        count += 1;
      }
    }
  }

  return total / count;
}
