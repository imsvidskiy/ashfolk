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

interface ErosionBrush {
  columns: Int32Array;
  offsets: Int32Array;
  radius: number;
  rows: Int32Array;
  weights: Float32Array;
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
