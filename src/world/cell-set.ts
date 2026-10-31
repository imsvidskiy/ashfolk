const LARGEST_SORTED_SHARE = 0.1;

export class CellSet {
  readonly #cells: Int32Array;
  readonly #isMember: Uint8Array;
  #size = 0;

  constructor(cellCount: number) {
    this.#cells = new Int32Array(cellCount);
    this.#isMember = new Uint8Array(cellCount);
  }

  get size(): number {
    return this.#size;
  }

  has(cell: number): boolean {
    return this.#isMember[cell] === 1;
  }

  add(cell: number): void {
    if (this.#isMember[cell] === 1) {
      return;
    }

    this.#isMember[cell] = 1;
    this.#cells[this.#size] = cell;
    this.#size += 1;
  }

  retain(keeps: (cell: number) => boolean): void {
    const initialSize = this.#size;
    let kept = 0;

    for (let position = 0; position < initialSize; position += 1) {
      const cell = this.#cells[position];

      if (keeps(cell)) {
        this.#cells[kept] = cell;
        kept += 1;
      } else {
        this.#isMember[cell] = 0;
      }
    }

    for (let position = initialSize; position < this.#size; position += 1) {
      this.#cells[kept] = this.#cells[position];
      kept += 1;
    }

    this.#size = kept;
  }

  sort(): void {
    if (this.#size < this.#isMember.length * LARGEST_SORTED_SHARE) {
      this.values().sort();

      return;
    }

    this.#size = 0;

    for (let cell = 0; cell < this.#isMember.length; cell += 1) {
      if (this.#isMember[cell] === 1) {
        this.#cells[this.#size] = cell;
        this.#size += 1;
      }
    }
  }

  values(): Int32Array {
    return this.#cells.subarray(0, this.#size);
  }

  snapshot(): Int32Array {
    return this.values().slice();
  }

  restore(cells: Int32Array): void {
    this.#isMember.fill(0);
    this.#size = 0;

    for (const cell of cells) {
      this.add(cell);
    }
  }
}
