export class DisjointSets {
  readonly #parents: Int32Array;

  constructor(size: number) {
    this.#parents = Int32Array.from({ length: size }, (_, index) => {
      return index;
    });
  }

  find(element: number): number {
    let root = element;

    while (this.#parents[root] !== root) {
      root = this.#parents[root];
    }

    let current = element;

    while (this.#parents[current] !== root) {
      const next = this.#parents[current];

      this.#parents[current] = root;
      current = next;
    }

    return root;
  }

  join(first: number, second: number): void {
    const firstRoot = this.find(first);
    const secondRoot = this.find(second);

    this.#parents[secondRoot] = firstRoot;
  }
}
