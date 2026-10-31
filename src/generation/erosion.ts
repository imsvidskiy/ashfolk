import { clamp, lerp } from "../shared/math.ts";
import type { RandomSource } from "../shared/random.ts";

const BRUSH_RADIUS = 3;
const CAPACITY = 4;
const DEPOSITION_SPEED = 0.3;
const EROSION_SPEED = 0.32;
const EVAPORATION = 0.012;
const GRAVITY = 4;
const HEIGHT_SCALE = 1600;
const INERTIA = 0.06;
const MAXIMUM_STEPS = 60;
const MINIMUM_CAPACITY = 0.01;
const SETTLED_EXCESS = 0.02;
const SMOOTHING = 0.2;
const LARGEST_SORTED_SHARE = 0.1;

interface ErosionBrush {
  columns: Int32Array;
  offsets: Int32Array;
  radius: number;
  rows: Int32Array;
  weights: Float32Array;
}

interface Neighborhood {
  columns: Int32Array;
  distances: Float32Array;
  offsets: Int32Array;
  rows: Int32Array;
}

interface DropletTerrain {
  readonly brush: ErosionBrush;
  readonly map: Float32Array;
  readonly resistance: Float32Array;
  readonly size: number;
}

interface CoarseSpan {
  readonly after: Int32Array;
  readonly amount: Float64Array;
  readonly before: Int32Array;
}

export interface ErosionScale {
  readonly dropletsPerCell: number;
  readonly factor: number;
}

export interface ErosionPlan {
  readonly coarseReach: Float32Array;
  readonly resistance: Float32Array;
  readonly scales: readonly ErosionScale[];
}

interface CellList {
  readonly cells: Int32Array;
  count: number;
  readonly isListed: Uint8Array;
}

interface SlopeRelaxation {
  readonly active: CellList;
  readonly cellSize: number;
  readonly change: Float32Array;
  readonly changed: CellList;
  readonly excesses: Float64Array;
  readonly heights: Float32Array;
  readonly neighborhood: Neighborhood;
  readonly size: number;
  readonly talus: Float32Array;
}

function createBrush(radius: number, size: number): ErosionBrush {
  const columns: number[] = [];
  const rows: number[] = [];
  const weights: number[] = [];
  let weightSum = 0;

  for (let row = -radius; row <= radius; row += 1) {
    for (let column = -radius; column <= radius; column += 1) {
      const distanceFromCenter = Math.sqrt(column * column + row * row);

      if (distanceFromCenter > radius) {
        continue;
      }

      const weight = 1 - distanceFromCenter / radius;

      columns.push(column);
      rows.push(row);
      weights.push(weight);
      weightSum += weight;
    }
  }

  return {
    columns: Int32Array.from(columns),
    offsets: Int32Array.from(columns, (column, index) => {
      return rows[index] * size + column;
    }),
    radius,
    rows: Int32Array.from(rows),
    weights: Float32Array.from(weights, (weight) => {
      return weight / weightSum;
    }),
  };
}

function createNeighborhood(size: number): Neighborhood {
  const columns = Int32Array.of(-1, 1, 0, 0, -1, 1, -1, 1);
  const rows = Int32Array.of(0, 0, -1, 1, -1, -1, 1, 1);

  return {
    columns,
    distances: Float32Array.of(1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2),
    offsets: columns.map((column, index) => {
      return rows[index] * size + column;
    }),
    rows,
  };
}

function heightAt(map: Float32Array, size: number, x: number, z: number): number {
  const column = Math.floor(x);
  const row = Math.floor(z);

  const offsetX = x - column;
  const offsetZ = z - row;
  const index = row * size + column;

  const northWest = map[index];
  const northEast = map[index + 1];
  const southWest = map[index + size];
  const southEast = map[index + size + 1];

  return lerp(lerp(northWest, northEast, offsetX), lerp(southWest, southEast, offsetX), offsetZ);
}

function isOnMap(column: number, row: number, size: number): boolean {
  return column >= 0 && row >= 0 && column < size && row < size;
}

function erode(
  map: Float32Array,
  size: number,
  brush: ErosionBrush,
  centerColumn: number,
  centerRow: number,
  amount: number
): number {
  const { offsets, radius, weights } = brush;

  const center = centerRow * size + centerColumn;
  const isInside =
    centerColumn >= radius && centerRow >= radius && centerColumn < size - radius && centerRow < size - radius;

  let removed = 0;

  if (isInside) {
    for (let brushIndex = 0; brushIndex < weights.length; brushIndex += 1) {
      const index = center + offsets[brushIndex];
      const take = Math.min(map[index], amount * weights[brushIndex]);

      map[index] -= take;
      removed += take;
    }

    return removed;
  }

  for (let brushIndex = 0; brushIndex < weights.length; brushIndex += 1) {
    if (!isOnMap(centerColumn + brush.columns[brushIndex], centerRow + brush.rows[brushIndex], size)) {
      continue;
    }

    const index = center + offsets[brushIndex];
    const take = Math.min(map[index], amount * weights[brushIndex]);

    map[index] -= take;
    removed += take;
  }

  return removed;
}

function depositedAmount(heightChange: number, sediment: number, capacity: number): number {
  if (heightChange > 0) {
    return Math.min(heightChange, sediment);
  }

  return (sediment - capacity) * DEPOSITION_SPEED;
}

function simulateDroplet(terrain: DropletTerrain, random: RandomSource): void {
  const { brush, map, size } = terrain;

  const limit = size - 2;

  let directionX = 0;
  let directionZ = 0;
  let speed = 1;
  let water = 1;
  let sediment = 0;
  let x = random.next() * limit;
  let z = random.next() * limit;

  for (let step = 0; step < MAXIMUM_STEPS; step += 1) {
    const column = Math.floor(x);
    const row = Math.floor(z);

    const offsetX = x - column;
    const offsetZ = z - row;
    const index = row * size + column;

    const northWest = map[index];
    const northEast = map[index + 1];
    const southWest = map[index + size];
    const southEast = map[index + size + 1];

    const startHeight = lerp(lerp(northWest, northEast, offsetX), lerp(southWest, southEast, offsetX), offsetZ);
    const gradientX = (northEast - northWest) * (1 - offsetZ) + (southEast - southWest) * offsetZ;
    const gradientZ = (southWest - northWest) * (1 - offsetX) + (southEast - northEast) * offsetX;

    directionX = directionX * INERTIA - gradientX * (1 - INERTIA);
    directionZ = directionZ * INERTIA - gradientZ * (1 - INERTIA);

    const length = Math.sqrt(directionX * directionX + directionZ * directionZ);

    if (length < 1e-9) {
      return;
    }

    directionX /= length;
    directionZ /= length;
    x += directionX;
    z += directionZ;

    if (x < 0 || x >= limit || z < 0 || z >= limit) {
      return;
    }

    const heightChange = heightAt(map, size, x, z) - startHeight;
    const capacity = Math.max(-heightChange * speed * water * CAPACITY, MINIMUM_CAPACITY);

    if (sediment > capacity || heightChange > 0) {
      const amount = depositedAmount(heightChange, sediment, capacity);

      sediment -= amount;

      map[index] += amount * (1 - offsetX) * (1 - offsetZ);
      map[index + 1] += amount * offsetX * (1 - offsetZ);
      map[index + size] += amount * (1 - offsetX) * offsetZ;
      map[index + size + 1] += amount * offsetX * offsetZ;
    } else {
      const softness = 1 - terrain.resistance[index];
      const amount = Math.min((capacity - sediment) * EROSION_SPEED, -heightChange) * softness;

      sediment += erode(map, size, brush, column, row, amount);
    }

    speed = Math.sqrt(Math.max(0, speed * speed - heightChange * GRAVITY));
    water *= 1 - EVAPORATION;
  }
}

function erodeHydraulically(
  heights: Float32Array,
  resistance: Float32Array,
  random: RandomSource,
  dropletCount: number
): void {
  const size = Math.round(Math.sqrt(heights.length));
  const map = Float32Array.from(heights, (height) => {
    return height / HEIGHT_SCALE;
  });
  const terrain: DropletTerrain = { brush: createBrush(BRUSH_RADIUS, size), map, resistance, size };

  for (let droplet = 0; droplet < dropletCount; droplet += 1) {
    simulateDroplet(terrain, random);
  }

  for (let index = 0; index < map.length; index += 1) {
    heights[index] = map[index] * HEIGHT_SCALE;
  }
}

function downsample(heights: Float32Array, size: number, factor: number): Float32Array {
  const coarseSize = size / factor;
  const coarse = new Float32Array(coarseSize * coarseSize);
  const share = 1 / (factor * factor);

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      coarse[Math.floor(row / factor) * coarseSize + Math.floor(column / factor)] +=
        heights[row * size + column] * share;
    }
  }

  return coarse;
}

function coarseSpans(size: number, factor: number, coarseSize: number): CoarseSpan {
  const last = coarseSize - 1;
  const spans: CoarseSpan = {
    after: new Int32Array(size),
    amount: new Float64Array(size),
    before: new Int32Array(size),
  };

  for (let fine = 0; fine < size; fine += 1) {
    const coarse = clamp((fine - (factor - 1) / 2) / factor, 0, last);
    const before = Math.floor(coarse);

    spans.before[fine] = before;
    spans.after[fine] = Math.min(last, before + 1);
    spans.amount[fine] = coarse - before;
  }

  return spans;
}

function addUpsampledChange(
  heights: Float32Array,
  size: number,
  change: Float32Array,
  factor: number,
  reach: Float32Array
): void {
  const coarseSize = size / factor;
  const { after, amount, before } = coarseSpans(size, factor, coarseSize);

  for (let row = 0; row < size; row += 1) {
    const top = before[row] * coarseSize;
    const bottom = after[row] * coarseSize;
    const downward = amount[row];

    for (let column = 0; column < size; column += 1) {
      const left = before[column];
      const right = after[column];
      const rightward = amount[column];

      const upper = lerp(change[top + left], change[top + right], rightward);
      const lower = lerp(change[bottom + left], change[bottom + right], rightward);

      heights[row * size + column] += lerp(upper, lower, downward) * reach[row * size + column];
    }
  }
}

export function erodeAcrossScales(
  heights: Float32Array,
  size: number,
  random: RandomSource,
  { coarseReach, resistance, scales }: ErosionPlan
): void {
  for (const scale of scales) {
    const coarseSize = size / scale.factor;
    const dropletCount = Math.round(coarseSize * coarseSize * scale.dropletsPerCell);

    if (scale.factor === 1) {
      erodeHydraulically(heights, resistance, random, dropletCount);

      continue;
    }

    const coarse = downsample(heights, size, scale.factor);
    const before = Float32Array.from(coarse);

    erodeHydraulically(coarse, downsample(resistance, size, scale.factor), random, dropletCount);
    addUpsampledChange(
      heights,
      size,
      coarse.map((height, cell) => {
        return height - before[cell];
      }),
      scale.factor,
      coarseReach
    );
  }
}

function createCellList(cellCount: number): CellList {
  return { cells: new Int32Array(cellCount), count: 0, isListed: new Uint8Array(cellCount) };
}

function listCell(list: CellList, cell: number): void {
  if (list.isListed[cell] === 1) {
    return;
  }

  list.isListed[cell] = 1;
  list.cells[list.count] = cell;
  list.count += 1;
}

function shedExcess(relaxation: SlopeRelaxation, cell: number): boolean {
  const { change, changed, excesses, heights, neighborhood, size } = relaxation;

  const column = cell % size;
  const row = (cell - column) / size;
  const height = heights[cell];
  const allowedDrop = relaxation.talus[cell] * relaxation.cellSize;
  const isInside = column > 0 && row > 0 && column < size - 1 && row < size - 1;

  let total = 0;
  let largest = 0;

  for (let neighbor = 0; neighbor < 8; neighbor += 1) {
    excesses[neighbor] = 0;

    if (!(isInside || isOnMap(column + neighborhood.columns[neighbor], row + neighborhood.rows[neighbor], size))) {
      continue;
    }

    const excess =
      height - heights[cell + neighborhood.offsets[neighbor]] - allowedDrop * neighborhood.distances[neighbor];

    if (excess > 0) {
      excesses[neighbor] = excess;
      total += excess;
      largest = Math.max(largest, excess);
    }
  }

  if (largest <= SETTLED_EXCESS) {
    return false;
  }

  const moved = 0.4 * largest;

  listCell(changed, cell);

  for (let neighbor = 0; neighbor < 8; neighbor += 1) {
    const excess = excesses[neighbor];

    if (excess > 0) {
      const share = (moved * excess) / total;
      const target = cell + neighborhood.offsets[neighbor];

      change[target] += share;
      change[cell] -= share;
      listCell(changed, target);
    }
  }

  return true;
}

function applyRelaxation(relaxation: SlopeRelaxation): void {
  const { active, change, changed, heights, neighborhood, size } = relaxation;

  for (let index = 0; index < changed.count; index += 1) {
    const cell = changed.cells[index];

    changed.isListed[cell] = 0;

    if (change[cell] === 0) {
      continue;
    }

    const column = cell % size;
    const row = (cell - column) / size;
    const isInside = column > 0 && row > 0 && column < size - 1 && row < size - 1;

    heights[cell] += change[cell];
    change[cell] = 0;
    listCell(active, cell);

    for (let neighbor = 0; neighbor < 8; neighbor += 1) {
      if (isInside || isOnMap(column + neighborhood.columns[neighbor], row + neighborhood.rows[neighbor], size)) {
        listCell(active, cell + neighborhood.offsets[neighbor]);
      }
    }
  }

  changed.count = 0;
}

function sortListed(list: CellList): void {
  const { cells, isListed } = list;

  if (list.count < isListed.length * LARGEST_SORTED_SHARE) {
    cells.subarray(0, list.count).sort();

    return;
  }

  list.count = 0;

  for (let cell = 0; cell < isListed.length; cell += 1) {
    if (isListed[cell] === 1) {
      cells[list.count] = cell;
      list.count += 1;
    }
  }
}

function shedActiveCells(relaxation: SlopeRelaxation): boolean {
  const { active } = relaxation;

  let hasShed = false;

  sortListed(active);

  for (let index = 0; index < active.count; index += 1) {
    const cell = active.cells[index];

    active.isListed[cell] = 0;

    if (shedExcess(relaxation, cell)) {
      hasShed = true;
    }
  }

  active.count = 0;

  return hasShed;
}

export function relaxSlopes(
  heights: Float32Array,
  size: number,
  cellSize: number,
  talus: Float32Array,
  maximumIterations: number
): number {
  const relaxation: SlopeRelaxation = {
    active: createCellList(heights.length),
    cellSize,
    change: new Float32Array(heights.length),
    changed: createCellList(heights.length),
    excesses: new Float64Array(8),
    heights,
    neighborhood: createNeighborhood(size),
    size,
    talus,
  };

  for (let cell = 0; cell < heights.length; cell += 1) {
    listCell(relaxation.active, cell);
  }

  for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
    if (!shedActiveCells(relaxation)) {
      return iteration;
    }

    applyRelaxation(relaxation);
  }

  return maximumIterations;
}

function lowerToward(heights: Float32Array, cell: number, neighbor: number, allowedDrop: number): void {
  heights[cell] = Math.min(heights[cell], heights[neighbor] + allowedDrop);
}

function limitFromEarlierCells(heights: Float32Array, size: number, straight: number, diagonal: number): void {
  const last = size - 1;

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const cell = row * size + column;

      if (column > 0) {
        lowerToward(heights, cell, cell - 1, straight);
      }

      if (row === 0) {
        continue;
      }

      lowerToward(heights, cell, cell - size, straight);

      if (column > 0) {
        lowerToward(heights, cell, cell - size - 1, diagonal);
      }

      if (column < last) {
        lowerToward(heights, cell, cell - size + 1, diagonal);
      }
    }
  }
}

function limitFromLaterCells(heights: Float32Array, size: number, straight: number, diagonal: number): void {
  const last = size - 1;

  for (let row = last; row >= 0; row -= 1) {
    for (let column = last; column >= 0; column -= 1) {
      const cell = row * size + column;

      if (column < last) {
        lowerToward(heights, cell, cell + 1, straight);
      }

      if (row === last) {
        continue;
      }

      lowerToward(heights, cell, cell + size, straight);

      if (column < last) {
        lowerToward(heights, cell, cell + size + 1, diagonal);
      }

      if (column > 0) {
        lowerToward(heights, cell, cell + size - 1, diagonal);
      }
    }
  }
}

export function limitSlopes(heights: Float32Array, size: number, cellSize: number, steepestSlope: number): void {
  const straight = steepestSlope * cellSize;

  limitFromEarlierCells(heights, size, straight, straight * Math.SQRT2);
  limitFromLaterCells(heights, size, straight, straight * Math.SQRT2);
}

export function smoothHeights(heights: Float32Array, size: number): void {
  const smoothed = new Float32Array(heights.length);

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const index = row * size + column;
      const left = heights[row * size + Math.max(0, column - 1)];
      const right = heights[row * size + Math.min(size - 1, column + 1)];
      const up = heights[Math.max(0, row - 1) * size + column];
      const down = heights[Math.min(size - 1, row + 1) * size + column];

      smoothed[index] = lerp(heights[index], (left + right + up + down) * 0.25, SMOOTHING);
    }
  }

  heights.set(smoothed);
}
