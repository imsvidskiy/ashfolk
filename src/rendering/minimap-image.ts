import { type Color, GROUNDS, seasonalGroundColor } from "../content/grounds.ts";
import type { WorldMirror } from "../game/world-mirror.ts";
import type { IslandSketch } from "../generation/generation-options.ts";
import { clamp, lerp, saturate } from "../shared/math.ts";
import { GROUND_CHANNELS, GroundChannel } from "../world/agent-buffers.ts";
import { isOnIsland } from "../world/coast.ts";
import { hasWater } from "../world/water.ts";

const BYTE = 255;
const SLOPE_SHADE = 0.26;
const DEEPEST_TINT = 8;
const WATER_SHALLOW: Color = [0.42, 0.66, 0.78];
const WATER_DEEP: Color = [0.16, 0.36, 0.58];
const BARE_LAND: Color = [0.74, 0.68, 0.56];
const SKETCH_SEASON = 0;
const SKETCH_BLUR_CELLS = 2;

function waterColor(depth: number): Color {
  const amount = saturate(depth / DEEPEST_TINT);

  return [
    lerp(WATER_SHALLOW[0], WATER_DEEP[0], amount),
    lerp(WATER_SHALLOW[1], WATER_DEEP[1], amount),
    lerp(WATER_SHALLOW[2], WATER_DEEP[2], amount),
  ];
}

function slopeShade(height: Float32Array, cellsPerSide: number, cellSize: number, column: number, row: number): number {
  const last = cellsPerSide - 1;
  const here = height[row * cellsPerSide + column];

  const east = height[row * cellsPerSide + Math.min(last, column + 1)];
  const south = height[Math.min(last, row + 1) * cellsPerSide + column];

  const slope = (here - east + here - south) / cellSize;

  return clamp(1 + slope * SLOPE_SHADE, 0.6, 1.25);
}

function blurRows(source: Float32Array, cellsPerSide: number, isAcross: boolean): Float32Array {
  const last = cellsPerSide - 1;

  const blurred = new Float32Array(source.length);

  for (let row = 0; row < cellsPerSide; row += 1) {
    for (let column = 0; column < cellsPerSide; column += 1) {
      let sum = 0;

      for (let offset = -SKETCH_BLUR_CELLS; offset <= SKETCH_BLUR_CELLS; offset += 1) {
        const sampleRow = isAcross ? row : clamp(row + offset, 0, last);
        const sampleColumn = isAcross ? clamp(column + offset, 0, last) : column;

        sum += source[sampleRow * cellsPerSide + sampleColumn];
      }

      blurred[row * cellsPerSide + column] = sum / (2 * SKETCH_BLUR_CELLS + 1);
    }
  }

  return blurred;
}

function softenedHeight(height: Float32Array, cellsPerSide: number): Float32Array {
  return blurRows(blurRows(height, cellsPerSide, true), cellsPerSide, false);
}

function writePixel(image: ImageData, pixel: number, color: Color, shade: number): void {
  const offset = pixel * 4;

  image.data[offset] = saturate(color[0] * shade) * BYTE;
  image.data[offset + 1] = saturate(color[1] * shade) * BYTE;
  image.data[offset + 2] = saturate(color[2] * shade) * BYTE;
  image.data[offset + 3] = BYTE;
}

function cellColor(mirror: WorldMirror, palette: readonly Color[], cell: number): Color {
  const { ground, terrain } = mirror;

  const level = terrain.waterSurface[cell];
  const height = terrain.height[cell];

  if (hasWater(level, height)) {
    return waterColor(level - height);
  }

  return palette[ground[cell * GROUND_CHANNELS + GroundChannel.Ground]];
}

function sketchColor(island: IslandSketch, palette: readonly Color[], cell: number): Color {
  const { ground, height, waterSurface } = island;

  if (waterSurface !== null && hasWater(waterSurface[cell], height[cell])) {
    return waterColor(waterSurface[cell] - height[cell]);
  }

  if (ground === null) {
    return BARE_LAND;
  }

  return palette[ground[cell]];
}

export function paintMinimapTerrain(mirror: WorldMirror, size: number): ImageData {
  const { frame, grid, terrain } = mirror;

  const image = new ImageData(size, size);
  const palette = GROUNDS.map((_, index) => {
    return seasonalGroundColor(index, frame.calendar.season);
  });

  for (let pixelRow = 0; pixelRow < size; pixelRow += 1) {
    const row = Math.floor((pixelRow / size) * grid.cellsPerSide);

    for (let pixelColumn = 0; pixelColumn < size; pixelColumn += 1) {
      const column = Math.floor((pixelColumn / size) * grid.cellsPerSide);
      const cell = grid.index(column, row);

      if (!isOnIsland(terrain.coastDistance, cell)) {
        continue;
      }

      const shade = slopeShade(terrain.height, grid.cellsPerSide, grid.cellSize, column, row);

      writePixel(image, pixelRow * size + pixelColumn, cellColor(mirror, palette, cell), shade);
    }
  }

  return image;
}

export function paintIslandSketch(island: IslandSketch): ImageData {
  const { cellSize, cellsPerSide, coastDistance } = island;

  const height = softenedHeight(island.height, cellsPerSide);
  const image = new ImageData(cellsPerSide, cellsPerSide);
  const palette = GROUNDS.map((_, index) => {
    return seasonalGroundColor(index, SKETCH_SEASON);
  });

  for (let row = 0; row < cellsPerSide; row += 1) {
    for (let column = 0; column < cellsPerSide; column += 1) {
      const cell = row * cellsPerSide + column;

      if (!isOnIsland(coastDistance, cell)) {
        continue;
      }

      writePixel(
        image,
        cell,
        sketchColor(island, palette, cell),
        slopeShade(height, cellsPerSide, cellSize, column, row)
      );
    }
  }

  return image;
}
