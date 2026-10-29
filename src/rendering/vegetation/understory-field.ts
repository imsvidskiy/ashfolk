import { type DataTexture, RedFormat } from "three/webgpu";
import { isTreeSpecies } from "../../content/plants.ts";
import type { WorldMirror } from "../../game/world-mirror.ts";
import { grownIndexArray } from "../../shared/growth.ts";
import { smoothstep } from "../../shared/math.ts";
import { type CellRegion, grownRegion } from "../../world/change-tracking.ts";
import { slopeAt } from "../../world/footing.ts";
import { PlantState } from "../../world/vegetation-store.ts";
import { byteTexture } from "../data-textures.ts";

const BYTE = 255;
const NO_CELL = -1;
const STEEP_GRASS_START = 0.7;
const STEEP_GRASS_END = 0.95;
const SHADE_PER_TREE = 0.45;
const DEEPEST_SHADE = 0.85;

export class UnderstoryField {
  readonly texture: DataTexture;
  readonly #cover: Uint8Array;
  readonly #mirror: WorldMirror;
  readonly #trees: Uint8Array;
  #cellOfTree = new Int32Array(0);

  constructor(mirror: WorldMirror) {
    const { cellCount, cellsPerSide } = mirror.grid;

    this.#mirror = mirror;
    this.#cover = new Uint8Array(cellCount);
    this.#trees = new Uint8Array(cellCount);
    this.texture = byteTexture(this.#cover, cellsPerSide, RedFormat);

    for (let plant = 0; plant < mirror.vegetation.count; plant += 1) {
      this.#place(plant);
    }

    for (let cell = 0; cell < cellCount; cell += 1) {
      this.#paint(cell);
    }
  }

  plantsChanged(indices: readonly number[]): void {
    let hasChanged = false;

    for (const plant of indices) {
      if (this.#place(plant)) {
        hasChanged = true;
      }
    }

    if (hasChanged) {
      this.texture.needsUpdate = true;
    }
  }

  heightsChanged(region: CellRegion): void {
    const { grid } = this.#mirror;

    const { firstColumn, firstRow, lastColumn, lastRow } = grownRegion(region, 1, grid.cellsPerSide);

    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        this.#paint(grid.index(column, row));
      }
    }

    this.texture.needsUpdate = true;
  }

  coverAt(cell: number): number {
    return this.#cover[cell] / BYTE;
  }

  dispose(): void {
    this.texture.dispose();
  }

  #place(plant: number): boolean {
    this.#cellOfTree = grownIndexArray(this.#cellOfTree, plant + 1, NO_CELL);

    const previous = this.#cellOfTree[plant];
    const next = this.#treeCell(plant);

    if (previous === next) {
      return false;
    }

    this.#cellOfTree[plant] = next;
    this.#countTree(previous, -1);
    this.#countTree(next, 1);

    return true;
  }

  #treeCell(plant: number): number {
    const { grid, vegetation } = this.#mirror;

    if (vegetation.state[plant] !== PlantState.Alive || !isTreeSpecies(vegetation.species[plant])) {
      return NO_CELL;
    }

    return grid.cellAt(vegetation.x[plant], vegetation.z[plant]);
  }

  #countTree(cell: number, change: number): void {
    if (cell === NO_CELL) {
      return;
    }

    this.#trees[cell] += change;
    this.#paint(cell);
  }

  #paint(cell: number): void {
    const { grid, terrain } = this.#mirror;

    const footing = 1 - smoothstep(STEEP_GRASS_START, STEEP_GRASS_END, slopeAt(terrain.height, grid, cell));
    const shade = Math.min(DEEPEST_SHADE, this.#trees[cell] * SHADE_PER_TREE);

    this.#cover[cell] = Math.round(BYTE * footing * (1 - shade));
  }
}
