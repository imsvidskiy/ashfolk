import { bordersBrook, hopTargets, Passage } from "../world/brooks.ts";
import type { Crossing } from "../world/crossings.ts";
import type { WorldGrid } from "../world/world-grid.ts";

const SMALLEST_LINKED_REGION = 30;

export class BankRegions {
  readonly #grid: WorldGrid;
  readonly #isGround: Uint8Array;
  readonly #parent: Int32Array;
  readonly #size: Int32Array;

  constructor(grid: WorldGrid, passages: readonly Passage[], crossings: readonly Crossing[]) {
    function passageOf(cell: number): Passage {
      return passages[cell];
    }

    this.#grid = grid;
    this.#isGround = new Uint8Array(grid.cellCount);
    this.#parent = new Int32Array(grid.cellCount);
    this.#size = new Int32Array(grid.cellCount).fill(1);

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      this.#parent[cell] = cell;
      this.#isGround[cell] = passages[cell] === Passage.Ground ? 1 : 0;
    }

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      if (this.#isGround[cell] === 0) {
        continue;
      }

      this.#joinNeighbors(cell);

      if (!bordersBrook(grid, cell, passageOf)) {
        continue;
      }

      for (const target of hopTargets(grid, cell, passageOf)) {
        this.#union(cell, target);
      }
    }

    for (const crossing of crossings) {
      this.join(crossing);
    }
  }

  isGround(cell: number): boolean {
    return cell >= 0 && this.#isGround[cell] === 1;
  }

  separates(first: number, second: number): boolean {
    const firstRoot = this.#find(first);
    const secondRoot = this.#find(second);

    if (firstRoot === secondRoot) {
      return false;
    }

    return Math.min(this.#size[firstRoot], this.#size[secondRoot]) >= SMALLEST_LINKED_REGION;
  }

  wouldJoin(crossing: Crossing): boolean {
    const start = this.#grid.cellAt(crossing.startX, crossing.startZ);
    const end = this.#grid.cellAt(crossing.endX, crossing.endZ);

    return this.isGround(start) && this.isGround(end) && this.separates(start, end);
  }

  join(crossing: Crossing): void {
    const start = this.#grid.cellAt(crossing.startX, crossing.startZ);
    const end = this.#grid.cellAt(crossing.endX, crossing.endZ);

    if (this.isGround(start) && this.isGround(end)) {
      this.#union(start, end);
    }
  }

  #joinNeighbors(cell: number): void {
    const grid = this.#grid;

    const column = grid.columnOf(cell);
    const row = grid.rowOf(cell);

    if (column + 1 < grid.cellsPerSide && this.#isGround[cell + 1] === 1) {
      this.#union(cell, cell + 1);
    }

    if (row + 1 >= grid.cellsPerSide) {
      return;
    }

    const below = cell + grid.cellsPerSide;
    const isBelowGround = this.#isGround[below] === 1;

    if (isBelowGround) {
      this.#union(cell, below);
    }

    for (const side of [-1, 1]) {
      const sideColumn = column + side;

      if (sideColumn < 0 || sideColumn >= grid.cellsPerSide) {
        continue;
      }

      const isOpen = this.#isGround[cell + side] === 1 && isBelowGround;

      if (isOpen && this.#isGround[below + side] === 1) {
        this.#union(cell, below + side);
      }
    }
  }

  #find(cell: number): number {
    let root = cell;

    while (this.#parent[root] !== root) {
      this.#parent[root] = this.#parent[this.#parent[root]];
      root = this.#parent[root];
    }

    return root;
  }

  #union(first: number, second: number): void {
    const firstRoot = this.#find(first);
    const secondRoot = this.#find(second);

    if (firstRoot === secondRoot) {
      return;
    }

    const [larger, smaller] =
      this.#size[firstRoot] >= this.#size[secondRoot] ? [firstRoot, secondRoot] : [secondRoot, firstRoot];

    this.#parent[smaller] = larger;
    this.#size[larger] += this.#size[smaller];
  }
}
