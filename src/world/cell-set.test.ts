import { describe, expect, it } from "vitest";
import { CellSet } from "./cell-set.ts";

describe("cell set", () => {
  it("adds each cell once", () => {
    const set = new CellSet(10);

    set.add(3);
    set.add(3);
    set.add(7);

    expect(set.size).toBe(2);
    expect(set.has(3)).toBe(true);
    expect(set.has(4)).toBe(false);
  });

  it("keeps only the cells the callback keeps", () => {
    const set = new CellSet(10);

    for (const cell of [1, 2, 3, 4]) {
      set.add(cell);
    }

    set.retain((cell) => {
      return cell % 2 === 0;
    });

    expect([...set.values()]).toEqual([2, 4]);
    expect(set.has(1)).toBe(false);
  });

  it("keeps cells added while it is being filtered", () => {
    const set = new CellSet(10);

    set.add(1);
    set.retain((cell) => {
      set.add(cell + 5);

      return false;
    });

    expect([...set.values()]).toEqual([6]);
  });

  it("sorts its cells whether it holds few or most of them", () => {
    const few = new CellSet(100);
    const most = new CellSet(10);

    for (const cell of [42, 7, 19]) {
      few.add(cell);
    }

    for (const cell of [9, 2, 5, 0]) {
      most.add(cell);
    }

    few.sort();
    most.sort();

    expect([...few.values()]).toEqual([7, 19, 42]);
    expect([...most.values()]).toEqual([0, 2, 5, 9]);
  });
});
