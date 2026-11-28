import { lerp } from "../shared/math.ts";
import { CellSet } from "../world/cell-set.ts";

const SETTLED_EXCESS = 0.02;
const SMOOTHING = 0.2;

interface Neighborhood {
  columns: Int32Array;
  distances: Float32Array;
  offsets: Int32Array;
  rows: Int32Array;
}

interface SlopeRelaxation {
  readonly active: CellSet;
  readonly cellSize: number;
  readonly change: Float32Array;
  readonly changed: CellSet;
  readonly excesses: Float64Array;
  readonly heights: Float32Array;
  readonly neighborhood: Neighborhood;
  readonly size: number;
  readonly talus: Float32Array;
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

function hasNeighbor(neighborhood: Neighborhood, column: number, row: number, neighbor: number, size: number): boolean {
  const neighborColumn = column + neighborhood.columns[neighbor];
  const neighborRow = row + neighborhood.rows[neighbor];

  return neighborColumn >= 0 && neighborRow >= 0 && neighborColumn < size && neighborRow < size;
}

function shedExcess(relaxation: SlopeRelaxation, cell: number): void {
  const { change, changed, excesses, heights, neighborhood, size } = relaxation;

  const column = cell % size;
  const row = (cell - column) / size;
  const height = heights[cell];
  const allowedDrop = relaxation.talus[cell] * relaxation.cellSize;
  const isInside = column > 0 && row > 0 && column < size - 1 && row < size - 1;

  let total = 0;
  let largest = 0;

  for (let neighbor = 0; neighbor < neighborhood.offsets.length; neighbor += 1) {
    excesses[neighbor] = 0;

    if (!(isInside || hasNeighbor(neighborhood, column, row, neighbor, size))) {
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
    return;
  }

  const moved = 0.4 * largest;

  changed.add(cell);

  for (let neighbor = 0; neighbor < neighborhood.offsets.length; neighbor += 1) {
    const excess = excesses[neighbor];

    if (excess > 0) {
      const share = (moved * excess) / total;
      const target = cell + neighborhood.offsets[neighbor];

      change[target] += share;
      change[cell] -= share;
      changed.add(target);
    }
  }
}

function applyRelaxation(relaxation: SlopeRelaxation): void {
  const { active, change, changed, heights, neighborhood, size } = relaxation;

  changed.retain((cell) => {
    if (change[cell] === 0) {
      return false;
    }

    const column = cell % size;
    const row = (cell - column) / size;
    const isInside = column > 0 && row > 0 && column < size - 1 && row < size - 1;

    heights[cell] += change[cell];
    change[cell] = 0;
    active.add(cell);

    for (let neighbor = 0; neighbor < neighborhood.offsets.length; neighbor += 1) {
      if (isInside || hasNeighbor(neighborhood, column, row, neighbor, size)) {
        active.add(cell + neighborhood.offsets[neighbor]);
      }
    }

    return false;
  });
}

function shedActiveCells(relaxation: SlopeRelaxation): void {
  const { active } = relaxation;

  active.sort();
  active.retain((cell) => {
    shedExcess(relaxation, cell);

    return false;
  });
}

export function relaxSlopes(
  heights: Float32Array,
  size: number,
  cellSize: number,
  talus: Float32Array,
  maximumIterations: number
): number {
  const relaxation: SlopeRelaxation = {
    active: new CellSet(heights.length),
    cellSize,
    change: new Float32Array(heights.length),
    changed: new CellSet(heights.length),
    excesses: new Float64Array(8),
    heights,
    neighborhood: createNeighborhood(size),
    size,
    talus,
  };

  for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
    if (iteration === 0) {
      for (let cell = 0; cell < heights.length; cell += 1) {
        shedExcess(relaxation, cell);
      }
    } else {
      shedActiveCells(relaxation);
    }

    if (relaxation.changed.size === 0) {
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
