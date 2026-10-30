import type { WorldGrid } from "../../world/world-grid.ts";

export const NO_PATCH = -1;

export function cellsAround(grid: WorldGrid, cell: number, innerRadius: number, outerRadius: number): number[] {
  const x = grid.cellCenterX(cell);
  const z = grid.cellCenterZ(cell);

  return grid.cellsInRadius(x, z, outerRadius).filter((other) => {
    return Math.hypot(grid.cellCenterX(other) - x, grid.cellCenterZ(other) - z) >= innerRadius;
  });
}

export function labelPatches(grid: WorldGrid, isInside: (cell: number) => boolean): Int32Array {
  const labels = new Int32Array(grid.cellCount).fill(NO_PATCH);

  for (let start = 0; start < grid.cellCount; start += 1) {
    if (labels[start] !== NO_PATCH || !isInside(start)) {
      continue;
    }

    const stack = [start];

    labels[start] = start;

    for (let cell = stack.pop(); cell !== undefined; cell = stack.pop()) {
      for (const neighbor of cellsAround(grid, cell, 1, grid.cellSize)) {
        if (labels[neighbor] === NO_PATCH && isInside(neighbor)) {
          labels[neighbor] = start;
          stack.push(neighbor);
        }
      }
    }
  }

  return labels;
}
