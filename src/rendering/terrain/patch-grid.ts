import {
  Box3,
  type Frustum,
  Group,
  InstancedBufferAttribute,
  type InstancedBufferGeometry,
  type Material,
  Mesh,
  type PerspectiveCamera,
} from "three/webgpu";
import type { CellRegion } from "../../world/change-tracking.ts";
import type { WorldGrid } from "../../world/world-grid.ts";
import { toInstancedGeometry } from "../instancing.ts";
import { HIDDEN_LEVEL, levelWithin } from "../view-input.ts";
import {
  createPatchGeometry,
  PATCH_CELLS,
  PATCH_LEVEL_DISTANCES,
  PATCH_STEPS,
  type PatchEdges,
  type PatchStep,
} from "./terrain-patches.ts";

const NO_LEVEL = -1;

interface PatchGridOptions {
  readonly edges: PatchEdges;
  readonly materials: readonly Material[];
  readonly pieceCells: number;
  readonly renderOrder: number;
  readonly shouldCastShadow: boolean;
}

export interface HeightRange {
  readonly highest: number;
  readonly lowest: number;
}

export interface PatchPiece {
  readonly firstColumn: number;
  readonly firstRow: number;
  readonly material: number;
}

export interface PatchContent extends HeightRange {
  readonly pieces: readonly PatchPiece[];
}

interface Patch {
  readonly bounds: Box3;
  pieces: readonly PatchPiece[];
  readonly region: CellRegion;
}

interface PatchLevel {
  readonly geometry: InstancedBufferGeometry;
  readonly mesh: Mesh;
  readonly origins: InstancedBufferAttribute;
}

type PatchMeasure = (region: CellRegion) => PatchContent | null;

function overlaps(changed: CellRegion, region: CellRegion): boolean {
  return (
    changed.lastColumn >= region.firstColumn - 1 &&
    changed.firstColumn <= region.lastColumn + 1 &&
    changed.lastRow >= region.firstRow - 1 &&
    changed.firstRow <= region.lastRow + 1
  );
}

function isPatchVisible(patch: Patch, frustum: Frustum): boolean {
  return patch.pieces.length > 0 && frustum.intersectsBox(patch.bounds);
}

function levelFor(patch: Patch, camera: PerspectiveCamera, detail: number, sharedLevel: number): number {
  if (sharedLevel !== NO_LEVEL) {
    return sharedLevel;
  }

  const level = levelWithin(patch.bounds.distanceToPoint(camera.position), PATCH_LEVEL_DISTANCES, detail);

  if (level === HIDDEN_LEVEL) {
    return PATCH_STEPS.length - 1;
  }

  return level;
}

export class PatchGrid {
  readonly group = new Group();
  readonly #chosenLevels: Int8Array;
  readonly #counts: number[][];
  readonly #grid: WorldGrid;
  readonly #levels: readonly (readonly PatchLevel[])[];
  readonly #measure: PatchMeasure;
  readonly #patches: Patch[] = [];
  #hasNewPieces = false;

  constructor(grid: WorldGrid, measure: PatchMeasure, options: PatchGridOptions) {
    const patchesPerSide = Math.ceil(grid.cellsPerSide / PATCH_CELLS);
    const piecesPerPatch = (PATCH_CELLS / options.pieceCells) ** 2;
    const patchCount = patchesPerSide * patchesPerSide;

    this.#grid = grid;
    this.#measure = measure;
    this.#levels = options.materials.map((material) => {
      return PATCH_STEPS.map((step) => {
        return this.#createLevel(step, material, patchCount * piecesPerPatch, options);
      });
    });
    this.#counts = this.#levels.map((levels) => {
      return levels.map(() => {
        return 0;
      });
    });
    this.#chosenLevels = new Int8Array(patchCount).fill(NO_LEVEL);

    for (let row = 0; row < patchesPerSide; row += 1) {
      for (let column = 0; column < patchesPerSide; column += 1) {
        this.#patches.push(this.#createPatch(column, row));
      }
    }
  }

  get chosenLevels(): Readonly<Int8Array> {
    return this.#chosenLevels;
  }

  remeasure(region: CellRegion | null): void {
    for (const patch of this.#patches) {
      if (region === null || overlaps(region, patch.region)) {
        this.#measurePatch(patch);
      }
    }
  }

  update(camera: PerspectiveCamera, frustum: Frustum, detail: number, sharedLevels?: Readonly<Int8Array>): void {
    let hasNewOrigins = this.#hasNewPieces;

    for (const counts of this.#counts) {
      counts.fill(0);
    }

    for (const [index, patch] of this.#patches.entries()) {
      const shared = sharedLevels === undefined ? NO_LEVEL : sharedLevels[index];
      const level = isPatchVisible(patch, frustum) ? levelFor(patch, camera, detail, shared) : NO_LEVEL;

      if (level !== this.#chosenLevels[index]) {
        this.#chosenLevels[index] = level;
        hasNewOrigins = true;
      }

      if (level === NO_LEVEL) {
        continue;
      }

      for (const piece of patch.pieces) {
        this.#place(piece, level);
      }
    }

    for (const [material, levels] of this.#levels.entries()) {
      for (const [index, level] of levels.entries()) {
        const count = this.#counts[material][index];

        level.geometry.instanceCount = count;
        level.mesh.visible = count > 0;

        if (hasNewOrigins && count > 0) {
          level.origins.clearUpdateRanges();
          level.origins.addUpdateRange(0, count * level.origins.itemSize);
          level.origins.needsUpdate = true;
        }
      }
    }

    this.#hasNewPieces = false;
  }

  dispose(): void {
    for (const levels of this.#levels) {
      for (const level of levels) {
        level.geometry.dispose();
      }
    }
  }

  #place(piece: PatchPiece, level: number): void {
    const counts = this.#counts[piece.material];
    const slot = counts[level];

    this.#levels[piece.material][level].origins.setXY(slot, piece.firstColumn, piece.firstRow);
    counts[level] = slot + 1;
  }

  #createLevel(step: PatchStep, material: Material, capacity: number, options: PatchGridOptions): PatchLevel {
    const geometry = toInstancedGeometry(createPatchGeometry(options.pieceCells, step, options.edges));
    const origins = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2);

    geometry.setAttribute("origin", origins);
    geometry.instanceCount = 0;

    const mesh = new Mesh(geometry, material);

    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = options.shouldCastShadow;
    mesh.renderOrder = options.renderOrder;
    this.group.add(mesh);

    return { geometry, mesh, origins };
  }

  #createPatch(column: number, row: number): Patch {
    const last = this.#grid.cellsPerSide - 1;
    const firstColumn = column * PATCH_CELLS;
    const firstRow = row * PATCH_CELLS;

    const region = {
      firstColumn,
      firstRow,
      lastColumn: Math.min(last, firstColumn + PATCH_CELLS),
      lastRow: Math.min(last, firstRow + PATCH_CELLS),
    };

    const patch: Patch = { bounds: new Box3(), pieces: [], region };

    this.#measurePatch(patch);

    return patch;
  }

  #measurePatch(patch: Patch): void {
    const content = this.#measure(patch.region);

    this.#hasNewPieces = true;

    if (content === null) {
      patch.pieces = [];

      return;
    }

    const grid = this.#grid;
    const { region } = patch;

    patch.pieces = content.pieces;
    patch.bounds.min.set(grid.centerX(region.firstColumn), content.lowest, grid.centerZ(region.firstRow));
    patch.bounds.max.set(grid.centerX(region.lastColumn), content.highest, grid.centerZ(region.lastRow));
  }
}
