import { clamp, Fn, float, floor, If, ivec2, max, min, mix, select, textureLoad, vec2 } from "three/tsl";
import type { DataTexture, Node } from "three/webgpu";
import type { WorldGrid } from "../../world/world-grid.ts";
import { PATCH_CELLS } from "./terrain-patches.ts";
import type { TerrainTextures } from "./terrain-textures.ts";

const CORNERS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
] as const;

export interface Corner {
  readonly cell: Node<"ivec2">;
  readonly weight: Node<"float">;
}

export function sampleCellsNode(cells: DataTexture, grid: WorldGrid, point: Node<"vec2">): Node<"vec4"> {
  const last = grid.cellsPerSide - 1;
  const cellCoordinate = point.add(grid.halfSize).div(grid.cellSize).sub(0.5);

  const base = floor(cellCoordinate);
  const fraction = cellCoordinate.sub(base);

  function valueAt(column: number, row: number): Node<"vec4"> {
    return textureLoad(cells, ivec2(clamp(base.add(vec2(column, row)), vec2(0, 0), vec2(last, last))));
  }

  const near = mix(valueAt(0, 0), valueAt(1, 0), fraction.x);
  const far = mix(valueAt(0, 1), valueAt(1, 1), fraction.x);

  return mix(near, far, fraction.y);
}

export function cornersAt(size: number, coordinates: Node<"vec2">): Corner[] {
  const last = size - 1;
  const cellCoordinate = coordinates.mul(size).sub(0.5);
  const base = floor(cellCoordinate);
  const fraction = cellCoordinate.sub(base);
  const across = float(1).sub(fraction);

  return CORNERS.map(([column, row]) => {
    return {
      cell: ivec2(clamp(base.add(vec2(column, row)), vec2(0, 0), vec2(last, last))),
      weight: (column === 0 ? across.x : fraction.x).mul(row === 0 ? across.y : fraction.y),
    };
  });
}

export function cellAtNode(grid: WorldGrid, point: Node<"vec2">): Node<"ivec2"> {
  const last = grid.cellsPerSide - 1;

  return ivec2(clamp(floor(point.add(grid.halfSize).div(grid.cellSize)), vec2(0, 0), vec2(last, last)));
}

export function mapCoordinatesNode(grid: WorldGrid, point: Node<"vec2">): Node<"vec2"> {
  return point.add(grid.halfSize).div(grid.worldSize);
}

export function sampleHeightNode(heights: DataTexture, grid: WorldGrid, point: Node<"vec2">): Node<"float"> {
  return sampleCellsNode(heights, grid, point).x;
}

function patchCellNode(grid: WorldGrid, point: Node<"vec2">): Node<"vec2"> {
  const last = grid.cellsPerSide - 1;

  return clamp(point.add(grid.halfSize).div(grid.cellSize).sub(0.5), vec2(0, 0), vec2(last, last));
}

function patchStepNode(textures: TerrainTextures, cell: Node<"vec2">): Node<"float"> {
  const lastPatch = textures.patchesPerSide - 1;
  const patch = clamp(floor(cell.div(PATCH_CELLS)), vec2(0, 0), vec2(lastPatch, lastPatch));

  return textureLoad(textures.patchSteps, ivec2(patch)).x;
}

export function renderedHeightNode(textures: TerrainTextures, grid: WorldGrid, point: Node<"vec2">): Node<"float"> {
  const cell = patchCellNode(grid, point);

  return renderedHeightFrom(textures, grid, cell, patchStepNode(textures, cell));
}

function renderedHeightFrom(
  textures: TerrainTextures,
  grid: WorldGrid,
  cell: Node<"vec2">,
  step: Node<"float">
): Node<"float"> {
  const last = grid.cellsPerSide - 1;

  const origin = floor(cell.div(PATCH_CELLS)).mul(PATCH_CELLS);
  const start = origin.add(floor(cell.sub(origin).div(step)).mul(step));
  const end = min(start.add(step), vec2(last, last));
  const along = cell.sub(start).div(max(end.sub(start), vec2(1, 1)));

  function heightAt(column: Node<"float">, row: Node<"float">): Node<"float"> {
    return textureLoad(textures.height, ivec2(vec2(column, row))).x;
  }

  const first = heightAt(start.x, start.y);
  const right = heightAt(end.x, start.y);
  const below = heightAt(start.x, end.y);
  const diagonal = heightAt(end.x, end.y);

  const center = first.add(right).add(below).add(diagonal).mul(0.25);
  const across = float(1).sub(along);

  const bottomTriangle = first.add(right.sub(first).mul(along.x)).add(center.mul(2).sub(first).sub(right).mul(along.y));
  const topTriangle = below
    .add(diagonal.sub(below).mul(along.x))
    .add(center.mul(2).sub(below).sub(diagonal).mul(across.y));
  const leftTriangle = first.add(below.sub(first).mul(along.y)).add(center.mul(2).sub(first).sub(below).mul(along.x));
  const rightTriangle = right
    .add(diagonal.sub(right).mul(along.y))
    .add(center.mul(2).sub(right).sub(diagonal).mul(across.x));

  const isAboveFirstDiagonal = along.y.greaterThan(along.x);
  const isAboveSecondDiagonal = along.y.greaterThan(across.x);

  return select(
    isAboveFirstDiagonal,
    select(isAboveSecondDiagonal, topTriangle, leftTriangle),
    select(isAboveSecondDiagonal, rightTriangle, bottomTriangle)
  );
}

export function coarseGroundOffsetNode(textures: TerrainTextures, grid: WorldGrid, point: Node<"vec2">): Node<"float"> {
  return Fn(() => {
    const offset = float(0).toVar();
    const cell = patchCellNode(grid, point);
    const step = patchStepNode(textures, cell);

    If(step.greaterThan(1), () => {
      offset.assign(renderedHeightFrom(textures, grid, cell, step).sub(sampleHeightNode(textures.height, grid, point)));
    });

    return offset;
  })();
}

export function groundOffsetNode(textures: TerrainTextures, grid: WorldGrid, point: Node<"vec2">): Node<"float"> {
  return renderedHeightNode(textures, grid, point).sub(sampleHeightNode(textures.height, grid, point));
}
