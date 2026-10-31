import { clamp, floor, int, ivec2, max, mix, smoothstep, textureLoad, vec2 } from "three/tsl";
import { ClampToEdgeWrapping, DataTexture, NearestFilter, type Node, RedFormat, UnsignedByteType } from "three/webgpu";
import { Ground } from "../../content/grounds.ts";
import type { WorldMirror } from "../../game/world-mirror.ts";
import { hashToUnit } from "../../shared/math.ts";
import { GROUND_CHANNELS, GroundChannel } from "../../world/agent-buffers.ts";
import type { CellRegion, RowRun } from "../../world/change-tracking.ts";
import { gradientXAt, gradientZAt } from "../../world/footing.ts";
import { NEIGHBOR_OFFSETS, type WorldGrid } from "../../world/world-grid.ts";

export const FurrowAxis = {
  AlongX: 1,
  AlongZ: 2,
  None: 0,
} as const;

const BYTE = 255;
const CONTOUR_SLOPE = 0.04;
const TIE_SALT = 23.9;

type FurrowAxisCode = (typeof FurrowAxis)[keyof typeof FurrowAxis];

interface FieldShape {
  readonly cells: readonly number[];
  readonly gradientX: number;
  readonly gradientZ: number;
  readonly height: number;
  readonly width: number;
}

interface FieldShares {
  readonly axis: Node<"int">;
  readonly shares: readonly Node<"float">[];
}

function axisOf(shape: FieldShape): FurrowAxisCode {
  const { cells, gradientX, gradientZ, height, width } = shape;

  if (Math.hypot(gradientX, gradientZ) >= CONTOUR_SLOPE) {
    return Math.abs(gradientX) > Math.abs(gradientZ) ? FurrowAxis.AlongZ : FurrowAxis.AlongX;
  }

  if (width !== height) {
    return width > height ? FurrowAxis.AlongX : FurrowAxis.AlongZ;
  }

  return hashToUnit(Math.min(...cells), cells.length, TIE_SALT) < 0.5 ? FurrowAxis.AlongX : FurrowAxis.AlongZ;
}

export function fieldSharesNode(
  plan: DataTexture,
  grid: WorldGrid,
  point: Node<"vec2">,
  edgeWidths: readonly number[],
  blur: Node<"float">
): FieldShares {
  const last = grid.cellsPerSide - 1;
  const cellCoordinate = point.add(grid.halfSize).div(grid.cellSize).sub(0.5);

  const base = floor(cellCoordinate);
  const fraction = cellCoordinate.sub(base);

  function axisAt(column: number, row: number): Node<"float"> {
    const cell = ivec2(clamp(base.add(vec2(column, row)), vec2(0, 0), vec2(last, last)));

    return textureLoad(plan, cell).x.mul(BYTE);
  }

  const northWest = axisAt(0, 0);
  const northEast = axisAt(1, 0);
  const southWest = axisAt(0, 1);
  const southEast = axisAt(1, 1);

  const axis = int(max(max(northWest, northEast), max(southWest, southEast)).add(0.5));

  const shares = edgeWidths.map((edgeWidth) => {
    const width = max(blur, edgeWidth / grid.cellSize);
    const across = smoothstep(width.oneMinus().mul(0.5), width.add(1).mul(0.5), fraction);

    const near = mix(northWest.min(1), northEast.min(1), across.x);
    const far = mix(southWest.min(1), southEast.min(1), across.x);

    return mix(near, far, across.y);
  });

  return { axis, shares };
}

export class FieldPlan {
  readonly texture: DataTexture;
  readonly #axes: Uint8Array;
  readonly #farms = new Set<number>();
  readonly #mirror: WorldMirror;
  #revision = 0;

  constructor(mirror: WorldMirror) {
    const { cellCount, cellsPerSide } = mirror.grid;

    this.#mirror = mirror;
    this.#axes = new Uint8Array(cellCount);
    this.texture = new DataTexture(this.#axes, cellsPerSide, cellsPerSide, RedFormat, UnsignedByteType);
    this.texture.minFilter = NearestFilter;
    this.texture.magFilter = NearestFilter;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;

    this.groundChanged([{ firstRow: 0, rowCount: cellsPerSide }]);
    this.texture.needsUpdate = true;
  }

  get revision(): number {
    return this.#revision;
  }

  axisAt(cell: number): number {
    return this.#axes[cell];
  }

  groundChanged(runs: readonly RowRun[]): void {
    let hasChanged = false;

    for (const run of runs) {
      for (let row = run.firstRow; row < run.firstRow + run.rowCount; row += 1) {
        if (this.#followRow(row)) {
          hasChanged = true;
        }
      }
    }

    if (hasChanged) {
      this.#plan();
    }
  }

  heightsChanged(region: CellRegion): void {
    const { grid } = this.#mirror;

    for (const cell of this.#farms) {
      const column = grid.columnOf(cell);
      const row = grid.rowOf(cell);

      if (
        column >= region.firstColumn &&
        column <= region.lastColumn &&
        row >= region.firstRow &&
        row <= region.lastRow
      ) {
        this.#plan();

        return;
      }
    }
  }

  dispose(): void {
    this.texture.dispose();
  }

  #followRow(row: number): boolean {
    const { grid, ground } = this.#mirror;

    let hasChanged = false;

    for (let column = 0; column < grid.cellsPerSide; column += 1) {
      const cell = grid.index(column, row);
      const isFarm = ground[cell * GROUND_CHANNELS + GroundChannel.Ground] === Ground.Farm;

      if (isFarm === this.#farms.has(cell)) {
        continue;
      }

      hasChanged = true;

      if (isFarm) {
        this.#farms.add(cell);
      } else {
        this.#farms.delete(cell);
        this.#axes[cell] = FurrowAxis.None;
      }
    }

    return hasChanged;
  }

  #plan(): void {
    const visited = new Set<number>();

    for (const cell of this.#farms) {
      if (visited.has(cell)) {
        continue;
      }

      const shape = this.#shapeFrom(cell, visited);
      const axis = axisOf(shape);

      for (const member of shape.cells) {
        this.#axes[member] = axis;
      }
    }

    this.texture.needsUpdate = true;
    this.#revision += 1;
  }

  #shapeFrom(start: number, visited: Set<number>): FieldShape {
    const { grid, terrain } = this.#mirror;

    const cells = [start];

    let gradientX = 0;
    let gradientZ = 0;
    let firstColumn = grid.columnOf(start);
    let lastColumn = firstColumn;
    let firstRow = grid.rowOf(start);
    let lastRow = firstRow;

    visited.add(start);

    for (const cell of cells) {
      const column = grid.columnOf(cell);
      const row = grid.rowOf(cell);

      gradientX += gradientXAt(terrain.height, grid, cell);
      gradientZ += gradientZAt(terrain.height, grid, cell);
      firstColumn = Math.min(firstColumn, column);
      lastColumn = Math.max(lastColumn, column);
      firstRow = Math.min(firstRow, row);
      lastRow = Math.max(lastRow, row);

      for (const offset of NEIGHBOR_OFFSETS) {
        const neighbor = grid.index(column + offset.column, row + offset.row);

        if (!grid.contains(column + offset.column, row + offset.row) || visited.has(neighbor)) {
          continue;
        }

        if (this.#farms.has(neighbor)) {
          visited.add(neighbor);
          cells.push(neighbor);
        }
      }
    }

    return {
      cells,
      gradientX: gradientX / cells.length,
      gradientZ: gradientZ / cells.length,
      height: lastRow - firstRow + 1,
      width: lastColumn - firstColumn + 1,
    };
  }
}
