import { DEFAULT_GRID_DIMENSIONS, type GridDimensions } from "./world-grid.ts";

export const ISLAND_SIZES = ["small", "normal", "large"] as const;

export type IslandSizeKind = (typeof ISLAND_SIZES)[number];

const CELLS_PER_SIDE: Readonly<Record<IslandSizeKind, number>> = { large: 768, normal: 640, small: 512 };

export function isIslandSizeKind(value: string): value is IslandSizeKind {
  return ISLAND_SIZES.some((size) => {
    return size === value;
  });
}

export function islandDimensions(size: IslandSizeKind): GridDimensions {
  if (size === "normal") {
    return DEFAULT_GRID_DIMENSIONS;
  }

  return { cellSize: DEFAULT_GRID_DIMENSIONS.cellSize, cellsPerSide: CELLS_PER_SIDE[size] };
}

export function islandSizeOf(dimensions: GridDimensions): IslandSizeKind {
  const size = ISLAND_SIZES.find((kind) => {
    return dimensions.cellSize === DEFAULT_GRID_DIMENSIONS.cellSize && dimensions.cellsPerSide === CELLS_PER_SIDE[kind];
  });

  return size === undefined ? "normal" : size;
}

export function islandSpanShare(dimensions: GridDimensions): number {
  return CELLS_PER_SIDE[islandSizeOf(dimensions)] / CELLS_PER_SIDE.normal;
}

export function countForArea(dimensions: GridDimensions, normalCount: number): number {
  return Math.max(1, Math.round(normalCount * islandSpanShare(dimensions) ** 2));
}
