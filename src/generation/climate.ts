import { Biome, type BiomeIndex } from "../content/biomes.ts";
import { Ground, type GroundIndex } from "../content/grounds.ts";
import { lerp, saturate, smoothstep } from "../shared/math.ts";
import { createNoiseSampler, type NoiseSampler } from "../shared/noise.ts";
import { createRandom } from "../shared/random.ts";
import { gradientXAt, gradientZAt, slopeAt } from "../world/footing.ts";
import { hasWater } from "../world/water.ts";
import { ORTHOGONAL_STEPS, type WorldGrid } from "../world/world-grid.ts";
import type { ClimateProfile } from "./island-layout.ts";
import { type IslandPoint, islandPointAt } from "./relief.ts";
import {
  findPools,
  findSmallAreas,
  isStillWater,
  isWetland,
  matchWetlandShare,
  measureWetness,
  type WetlandInputs,
} from "./wetlands.ts";

const MAXIMUM_WATER_DISTANCE = 64;
const LAPSE_PER_METER = 0.0095;
const SUMMIT_CHILL = 5.5;
const SUMMIT_CHILL_START = 800;
const SUMMIT_CHILL_FULL = 1150;
const GLACIER_TEMPERATURE = -2.4;
const ICE_CLIFF_SLOPE = 1.2;
const BARE_ROCK_SLOPE = 0.9;
const WEAK_ROCK_SLOPE = 1.15;
const STRONG_ROCK_SLOPE = 0.86;
const WEAK_COLD_ROCK_SLOPE = 0.75;
const STRONG_COLD_ROCK_SLOPE = 0.45;
const ROCK_ECOTONE_TEMPERATURE = 3;
const ESCARPMENT_SLOPE = 0.62;
const TREE_LINE_TEMPERATURE = 1.6;
const ALPINE_SLOPE = 0.42;
const SHORE_TEMPERATURE = 3;
const WIDE_RIVER_STRENGTH = 130;
const BROAD_RIVER_STRENGTH = 85;
const RIVER_BANK_RISE = 1.4;
const RIVER_BANK_RISE_PER_CELL = 0.9;
const STEEPEST_RIVER_BANK = 0.36;
const BOG_TEMPERATURE = 3;

const BIOME_GROUND: Readonly<Record<BiomeIndex, GroundIndex>> = {
  [Biome.Alpine]: Ground.Rock,
  [Biome.Beach]: Ground.Sand,
  [Biome.Desert]: Ground.Sand,
  [Biome.Forest]: Ground.Forest,
  [Biome.Glacier]: Ground.Snow,
  [Biome.Meadow]: Ground.Meadow,
  [Biome.Mesa]: Ground.RedRock,
  [Biome.Scrub]: Ground.Scrub,
  [Biome.Steppe]: Ground.Steppe,
  [Biome.Swamp]: Ground.Swamp,
  [Biome.Taiga]: Ground.Forest,
  [Biome.Tundra]: Ground.Tundra,
  [Biome.Water]: Ground.Sand,
};

interface ClimateResult {
  baseTemperature: Float32Array;
  biome: Uint8Array;
  ground: Uint8Array;
  moisture: Float32Array;
  variation: Float32Array;
}

interface CellClimate {
  desert: number;
  height: number;
  isNearShore: boolean;
  isRiverBank: boolean;
  isWater: boolean;
  isWetland: boolean;
  moisture: number;
  rockSlope: number;
  slope: number;
  temperature: number;
}

interface Slopes {
  shaded: Float32Array;
  slope: Float32Array;
}

interface ClimateFields {
  readonly inputs: WetlandInputs;
  readonly noise: NoiseSampler;
  readonly profile: ClimateProfile;
  readonly riverBanks: Uint8Array;
  readonly rockStrength: Float32Array;
  readonly slopes: Slopes;
  readonly waterDistance: Float32Array;
  readonly wetness: Float32Array;
}

interface DrainedLand {
  biome: Uint8Array;
  ground: Uint8Array;
}

function summitChill(height: number): number {
  return SUMMIT_CHILL * smoothstep(SUMMIT_CHILL_START, SUMMIT_CHILL_FULL, height);
}

export function altitudeChill(height: number): number {
  return LAPSE_PER_METER * height + summitChill(height);
}

function baseTemperature(profile: ClimateProfile, height: number, warmSide: number, desert: number): number {
  const summit = summitChill(height);

  return 9.6 + profile.temperatureOffset - LAPSE_PER_METER * (height - 200) - summit + warmSide + 3.5 * desert;
}

export function bareRockSlope(temperature: number, rockStrength: number, desert: number): number {
  if (desert > 0.5) {
    return BARE_ROCK_SLOPE;
  }

  const outcrop = saturate(0.5 + 0.5 * rockStrength);
  const lowland = lerp(WEAK_ROCK_SLOPE, STRONG_ROCK_SLOPE, outcrop);
  const cold = lerp(WEAK_COLD_ROCK_SLOPE, STRONG_COLD_ROCK_SLOPE, outcrop);
  const alpine = smoothstep(TREE_LINE_TEMPERATURE + ROCK_ECOTONE_TEMPERATURE, TREE_LINE_TEMPERATURE, temperature);

  return lerp(lowland, cold, alpine);
}

function classifyColdOrSteep(cell: CellClimate): BiomeIndex | null {
  if (cell.temperature < GLACIER_TEMPERATURE) {
    return cell.slope > ICE_CLIFF_SLOPE ? Biome.Alpine : Biome.Glacier;
  }

  if (cell.slope > cell.rockSlope) {
    return cell.desert > 0.5 ? Biome.Mesa : Biome.Alpine;
  }

  if (cell.desert > 0.5 && cell.slope > ESCARPMENT_SLOPE) {
    return Biome.Mesa;
  }

  if ((cell.isNearShore || cell.isRiverBank) && cell.temperature > SHORE_TEMPERATURE && !cell.isWetland) {
    return Biome.Beach;
  }

  if (cell.temperature < TREE_LINE_TEMPERATURE) {
    return cell.slope > ALPINE_SLOPE ? Biome.Alpine : Biome.Tundra;
  }

  return null;
}

function classifyDry(cell: CellClimate): BiomeIndex {
  if (cell.desert > 0.5 && cell.height > 470) {
    return Biome.Mesa;
  }

  return cell.moisture > 0.5 ? Biome.Steppe : Biome.Desert;
}

function classifyTemperate(cell: CellClimate): BiomeIndex {
  if (cell.isWetland && cell.temperature > BOG_TEMPERATURE) {
    return Biome.Swamp;
  }

  if (cell.temperature < 5) {
    return cell.moisture > 0.4 ? Biome.Taiga : Biome.Tundra;
  }

  if (cell.temperature < 8.2) {
    if (cell.moisture > 0.5) {
      return Biome.Taiga;
    }

    return cell.moisture > 0.36 ? Biome.Meadow : Biome.Steppe;
  }

  if (cell.moisture > 0.6) {
    return Biome.Forest;
  }

  if (cell.moisture > 0.45) {
    return Biome.Meadow;
  }

  if (cell.moisture > 0.32) {
    return cell.slope > 0.45 ? Biome.Scrub : Biome.Steppe;
  }

  return cell.desert > 0.25 ? Biome.Desert : Biome.Steppe;
}

function classifyBiome(cell: CellClimate): BiomeIndex {
  if (cell.isWater) {
    return Biome.Water;
  }

  const coldOrSteep = classifyColdOrSteep(cell);

  if (coldOrSteep !== null) {
    return coldOrSteep;
  }

  if (cell.desert > 0.55) {
    return classifyDry(cell);
  }

  return classifyTemperate(cell);
}

function distanceToWater(grid: WorldGrid, waterSurface: Float32Array, heights: Float32Array): Float32Array {
  const distances = new Float32Array(grid.cellCount).fill(MAXIMUM_WATER_DISTANCE);
  const queue = new Int32Array(grid.cellCount);
  let head = 0;
  let tail = 0;

  for (const [cell, surface] of waterSurface.entries()) {
    if (hasWater(surface, heights[cell])) {
      distances[cell] = 0;
      queue[tail] = cell;
      tail += 1;
    }
  }

  while (head < tail) {
    const cell = queue[head];
    const next = distances[cell] + 1;

    head += 1;

    if (next >= MAXIMUM_WATER_DISTANCE) {
      continue;
    }

    const column = grid.columnOf(cell);
    const row = grid.rowOf(cell);

    for (const [columnOffset, rowOffset] of ORTHOGONAL_STEPS) {
      if (!grid.contains(column + columnOffset, row + rowOffset)) {
        continue;
      }

      const neighbor = grid.index(column + columnOffset, row + rowOffset);

      if (distances[neighbor] > next) {
        distances[neighbor] = next;
        queue[tail] = neighbor;
        tail += 1;
      }
    }
  }

  return distances;
}

function shadedFacing(
  profile: ClimateProfile,
  warmth: number,
  gradientX: number,
  gradientZ: number,
  slope: number
): number {
  if (slope < 1e-4 || warmth === 0) {
    return 0;
  }

  const uphillTowardWarmth = (gradientX * profile.warmthX + gradientZ * profile.warmthZ) / warmth;

  return (uphillTowardWarmth / slope) * Math.min(1, slope * 3);
}

function measureSlopes(profile: ClimateProfile, grid: WorldGrid, heights: Float32Array, slopes: Float64Array): Slopes {
  const warmth = Math.hypot(profile.warmthX, profile.warmthZ);

  const shaded = slopes.map((slope, cell) => {
    return shadedFacing(profile, warmth, gradientXAt(heights, grid, cell), gradientZAt(heights, grid, cell), slope);
  });

  return { shaded: Float32Array.from(shaded), slope: Float32Array.from(slopes) };
}

function riverBankWidth(strength: number): number {
  if (strength >= WIDE_RIVER_STRENGTH) {
    return 3;
  }

  return strength >= BROAD_RIVER_STRENGTH ? 2 : 1;
}

function markRiverBank(inputs: WetlandInputs, slopes: Float32Array, banks: Uint8Array, source: number): void {
  const { grid, heights, waterSurface } = inputs;

  const width = riverBankWidth(inputs.riverStrength[source]);
  const column = grid.columnOf(source);
  const row = grid.rowOf(source);

  for (let rowOffset = -width; rowOffset <= width; rowOffset += 1) {
    for (let columnOffset = -width; columnOffset <= width; columnOffset += 1) {
      const distance = Math.hypot(columnOffset, rowOffset);

      if (distance > width + 0.5 || !grid.contains(column + columnOffset, row + rowOffset)) {
        continue;
      }

      const cell = grid.index(column + columnOffset, row + rowOffset);
      const rise = heights[cell] - waterSurface[source];
      const isLowAndGentle = rise <= RIVER_BANK_RISE + RIVER_BANK_RISE_PER_CELL * distance;

      if (isLowAndGentle && slopes[cell] <= STEEPEST_RIVER_BANK && !hasWater(waterSurface[cell], heights[cell])) {
        banks[cell] = 1;
      }
    }
  }
}

function findRiverBanks(inputs: WetlandInputs, slopes: Float32Array): Uint8Array {
  const { heights, riverStrength, waterSurface } = inputs;

  const banks = new Uint8Array(heights.length);

  for (const [cell, strength] of riverStrength.entries()) {
    if (strength > 0 && hasWater(waterSurface[cell], heights[cell])) {
      markRiverBank(inputs, slopes, banks, cell);
    }
  }

  return banks;
}

function isNearLakeShore(inputs: WetlandInputs, column: number, row: number, height: number): boolean {
  const { grid } = inputs;

  for (let rowOffset = -3; rowOffset <= 3; rowOffset += 1) {
    for (let columnOffset = -3; columnOffset <= 3; columnOffset += 1) {
      const neighborColumn = column + columnOffset;
      const neighborRow = row + rowOffset;

      if (!grid.contains(neighborColumn, neighborRow)) {
        continue;
      }

      const neighbor = grid.index(neighborColumn, neighborRow);

      if (isStillWater(inputs, neighbor) && height < inputs.waterSurface[neighbor] + 2.6) {
        return true;
      }
    }
  }

  return false;
}

function groundFor(biome: BiomeIndex, cell: CellClimate, waterLevel: number): GroundIndex {
  if (cell.isWater) {
    return cell.height > waterLevel - 1.5 ? Ground.Sand : Ground.Rock;
  }

  if (biome === Biome.Steppe && cell.moisture > 0.44 && cell.temperature < 13) {
    return Ground.Meadow;
  }

  return BIOME_GROUND[biome];
}

function shapeSwamps(inputs: WetlandInputs, result: ClimateResult, wetness: Float32Array, drained: DrainedLand): void {
  const { grid, seed } = inputs;

  for (const cell of findSmallAreas(grid, (candidate) => {
    return result.biome[candidate] === Biome.Swamp;
  })) {
    result.biome[cell] = drained.biome[cell];
    result.ground[cell] = drained.ground[cell];
  }

  for (const cell of findPools(grid, seed, wetness, (candidate) => {
    return result.biome[candidate] === Biome.Swamp;
  })) {
    result.ground[cell] = Ground.Bog;
  }
}

function cellClimate(fields: ClimateFields, column: number, row: number, point: IslandPoint): CellClimate {
  const { inputs, noise, profile, riverBanks, rockStrength, slopes, waterDistance, wetness } = fields;

  const cell = inputs.grid.index(column, row);
  const height = inputs.heights[cell];
  const desert = inputs.desert[cell];
  const shaded = slopes.shaded[cell];
  const moistureNoise = 0.28 * noise.fractal(point.x * 1.3 + 11, point.z * 1.3 - 7, { octaves: 4 });
  const waterInfluence = 0.36 * Math.exp(-waterDistance[cell] / 13);

  const warmSide = profile.warmthX * point.x + profile.warmthZ * point.z;
  const temperature = baseTemperature(profile, height, warmSide, desert);
  const isWater = hasWater(inputs.waterSurface[cell], height);
  const moisture = saturate(
    0.5 + profile.moistureOffset + moistureNoise + waterInfluence + 0.14 * shaded - 0.8 * desert - 0.01 * warmSide
  );

  const isNearShore =
    !isWater &&
    waterDistance[cell] <= 2 &&
    inputs.riverStrength[cell] === 0 &&
    isNearLakeShore(inputs, column, row, height);

  return {
    desert,
    height,
    isNearShore,
    isRiverBank: riverBanks[cell] === 1,
    isWater,
    isWetland: isWetland(wetness[cell]),
    moisture,
    rockSlope: bareRockSlope(temperature, rockStrength[cell], desert),
    slope: slopes.slope[cell],
    temperature,
  };
}

export function buildClimate(
  profile: ClimateProfile,
  inputs: WetlandInputs,
  rockStrength: Float32Array
): ClimateResult {
  const { grid, heights, waterSurface } = inputs;

  const noise = createNoiseSampler(createRandom(inputs.seed * 13 + 5));
  const waterDistance = distanceToWater(grid, waterSurface, heights);
  const exactSlopes = Float64Array.from({ length: grid.cellCount }, (_, cell) => {
    return slopeAt(heights, grid, cell);
  });
  const slopes = measureSlopes(profile, grid, heights, exactSlopes);
  const riverBanks = findRiverBanks(inputs, slopes.slope);
  const wetness = measureWetness(inputs, exactSlopes);
  const fields: ClimateFields = { inputs, noise, profile, riverBanks, rockStrength, slopes, waterDistance, wetness };
  const drained = new Uint8Array(grid.cellCount);
  const drainedGround = new Uint8Array(grid.cellCount);
  const result: ClimateResult = {
    baseTemperature: new Float32Array(grid.cellCount),
    biome: new Uint8Array(grid.cellCount),
    ground: new Uint8Array(grid.cellCount),
    moisture: new Float32Array(grid.cellCount),
    variation: new Float32Array(grid.cellCount),
  };

  matchWetlandShare(wetness, inputs.coastDistance, profile.wetlandShare);

  for (let row = 0; row < grid.cellsPerSide; row += 1) {
    for (let column = 0; column < grid.cellsPerSide; column += 1) {
      const point = islandPointAt(grid, column, row);
      const cell = grid.index(column, row);
      const climate = cellClimate(fields, column, row, point);

      const biome = classifyBiome(climate);

      if (biome === Biome.Swamp) {
        const drainedClimate = { ...climate, isWetland: false };
        const drainedBiome = classifyBiome(drainedClimate);

        drained[cell] = drainedBiome;
        drainedGround[cell] = groundFor(drainedBiome, drainedClimate, waterSurface[cell]);
      }

      result.biome[cell] = biome;
      result.ground[cell] = groundFor(biome, climate, waterSurface[cell]);
      result.baseTemperature[cell] = climate.temperature;
      result.moisture[cell] = climate.moisture;
      result.variation[cell] = noise.fractal(point.x * 9 + 3, point.z * 9 - 7, { octaves: 2 });
    }
  }

  shapeSwamps(inputs, result, wetness, { biome: drained, ground: drainedGround });

  return result;
}
