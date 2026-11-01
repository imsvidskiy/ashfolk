import {
  type Frustum,
  Group,
  type Material,
  type MeshStandardNodeMaterial,
  type PerspectiveCamera,
  type WebGPURenderer,
} from "three/webgpu";
import type { WorldMirror } from "../../game/world-mirror.ts";
import type { CellRegion } from "../../world/change-tracking.ts";
import type { FireGlow } from "../effects/fire-glow.ts";
import { GroundWarp } from "./ground-warp.ts";
import type { GroundArea, IslandOutline } from "./island-outline.ts";
import { LavaPlates } from "./lava-plates.ts";
import { type HeightRange, type PatchContent, PatchGrid, type PatchPiece } from "./patch-grid.ts";
import { createTerrainMaterial } from "./terrain-material.ts";
import { PATCH_CELLS } from "./terrain-patches.ts";
import type { TerrainTextures } from "./terrain-textures.ts";

const TerrainMaterial = {
  Coastal: 1,
  Inland: 0,
} as const;

const SKIRT_ALLOWANCE = 220;
const COAST_PIECE_CELLS = 16;

export class TerrainView {
  readonly group = new Group();
  readonly #coast: PatchGrid | null;
  readonly #inland: PatchGrid;
  readonly #levels: Int8Array;
  readonly #materials: readonly MeshStandardNodeMaterial[];
  readonly #mirror: WorldMirror;
  readonly #outline: IslandOutline;
  readonly #plates: LavaPlates;
  readonly #warp: GroundWarp;

  constructor(
    mirror: WorldMirror,
    textures: TerrainTextures,
    plinth: number,
    glow: FireGlow,
    renderer: WebGPURenderer
  ) {
    const { grid } = mirror;

    this.#mirror = mirror;
    this.#outline = textures.outline;
    this.#plates = new LavaPlates(renderer);
    this.#warp = new GroundWarp(grid, renderer);

    const options = {
      glow,
      grid,
      plates: this.#plates,
      plinth,
      textures,
      warp: this.#warp,
    };

    const inland = createTerrainMaterial({ ...options, shouldCutAtCoast: false });

    this.#levels = new Int8Array(textures.patchesPerSide ** 2);
    this.#inland = this.#createGrid(
      (region) => {
        return this.#measureInland(region);
      },
      [inland],
      PATCH_CELLS
    );

    if (textures.outline.coast === null) {
      this.#materials = [inland];
      this.#coast = null;

      return;
    }

    this.#materials = [inland, createTerrainMaterial({ ...options, shouldCutAtCoast: true })];
    this.#coast = this.#createGrid(
      (region) => {
        return this.#measureCoast(region);
      },
      this.#materials,
      COAST_PIECE_CELLS
    );
  }

  get patchLevels(): Readonly<Int8Array> {
    return this.#levels;
  }

  heightsChanged(region: CellRegion): void {
    this.#inland.remeasure(region);

    if (this.#coast !== null) {
      this.#coast.remeasure(region);
    }
  }

  update(camera: PerspectiveCamera, frustum: Frustum, detail: number): void {
    this.#inland.update(camera, frustum, detail);
    this.#levels.set(this.#inland.chosenLevels);

    if (this.#coast === null) {
      return;
    }

    this.#coast.update(camera, frustum, detail);

    for (const [patch, level] of this.#coast.chosenLevels.entries()) {
      if (level >= 0) {
        this.#levels[patch] = level;
      }
    }
  }

  dispose(): void {
    this.#inland.dispose();
    this.#plates.dispose();
    this.#warp.dispose();

    if (this.#coast !== null) {
      this.#coast.dispose();
    }

    for (const material of this.#materials) {
      material.dispose();
    }
  }

  #createGrid(
    measure: (region: CellRegion) => PatchContent | null,
    materials: readonly Material[],
    pieceCells: number
  ): PatchGrid {
    const patches = new PatchGrid(this.#mirror.grid, measure, {
      edges: "skirted",
      materials,
      pieceCells,
      renderOrder: 0,
      shouldCastShadow: true,
    });

    this.group.add(patches.group);

    return patches;
  }

  #measureInland(region: CellRegion): PatchContent | null {
    if (this.#outline.sideOf(this.#areaOf(region), this.#mirror.grid.cellSize) !== "inside") {
      return null;
    }

    const piece = { firstColumn: region.firstColumn, firstRow: region.firstRow, material: TerrainMaterial.Inland };

    return { ...this.#heightsOf(region), pieces: [piece] };
  }

  #measureCoast(region: CellRegion): PatchContent | null {
    const { cellSize } = this.#mirror.grid;

    if (this.#outline.sideOf(this.#areaOf(region), cellSize) !== "across") {
      return null;
    }

    const pieces: PatchPiece[] = [];

    for (let row = region.firstRow; row < region.lastRow; row += COAST_PIECE_CELLS) {
      for (let column = region.firstColumn; column < region.lastColumn; column += COAST_PIECE_CELLS) {
        const piece = {
          firstColumn: column,
          firstRow: row,
          lastColumn: column + COAST_PIECE_CELLS,
          lastRow: row + COAST_PIECE_CELLS,
        };

        const side = this.#outline.sideOf(this.#areaOf(piece), cellSize);

        if (side !== "outside") {
          const material = side === "inside" ? TerrainMaterial.Inland : TerrainMaterial.Coastal;

          pieces.push({ firstColumn: column, firstRow: row, material });
        }
      }
    }

    if (pieces.length === 0) {
      return null;
    }

    return { ...this.#heightsOf(region), pieces };
  }

  #areaOf(region: CellRegion): GroundArea {
    const { grid } = this.#mirror;

    const last = grid.cellsPerSide - 1;

    return {
      maximumX: grid.centerX(Math.min(last, region.lastColumn)),
      maximumZ: grid.centerZ(Math.min(last, region.lastRow)),
      minimumX: grid.centerX(region.firstColumn),
      minimumZ: grid.centerZ(region.firstRow),
    };
  }

  #heightsOf(region: CellRegion): HeightRange {
    const { grid, terrain } = this.#mirror;

    let lowest = Number.POSITIVE_INFINITY;
    let highest = Number.NEGATIVE_INFINITY;

    for (let row = region.firstRow; row <= region.lastRow; row += 1) {
      for (let column = region.firstColumn; column <= region.lastColumn; column += 1) {
        const height = terrain.height[grid.index(column, row)];

        lowest = Math.min(lowest, height);
        highest = Math.max(highest, height);
      }
    }

    return { highest, lowest: lowest - SKIRT_ALLOWANCE };
  }
}
