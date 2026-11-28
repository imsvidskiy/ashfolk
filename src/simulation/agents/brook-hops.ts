import { brookBankMask, hopTargets, type Passage } from "../../world/brooks.ts";
import type { WorldGrid } from "../../world/world-grid.ts";

const NO_TARGETS: readonly number[] = [];

export class BrookHops {
  readonly #targets = new Map<number, number[]>();

  rebuild(grid: WorldGrid, passageOf: (cell: number) => Passage): void {
    const banks = brookBankMask(grid, passageOf);

    this.#targets.clear();

    for (let cell = 0; cell < banks.length; cell += 1) {
      if (banks[cell] === 0) {
        continue;
      }

      for (const target of hopTargets(grid, cell, passageOf)) {
        this.#connect(cell, target);
        this.#connect(target, cell);
      }
    }
  }

  from(cell: number): readonly number[] {
    const targets = this.#targets.get(cell);

    return targets === undefined ? NO_TARGETS : targets;
  }

  #connect(from: number, to: number): void {
    const targets = this.#targets.get(from);

    if (targets === undefined) {
      this.#targets.set(from, [to]);
    } else if (!targets.includes(to)) {
      targets.push(to);
    }
  }
}
