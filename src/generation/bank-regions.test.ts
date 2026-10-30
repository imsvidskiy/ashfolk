import { describe, expect, it } from "vitest";
import { Passage } from "../world/brooks.ts";
import type { Ford } from "../world/crossings.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { BankRegions } from "./bank-regions.ts";

const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 16 });
const RIVER_COLUMN = 7;
const LEFT = grid.cellAt(-50, 0);
const RIGHT = grid.cellAt(50, 0);
const FORD: Ford = { endX: 15, endZ: 0, id: 0, kind: "ford", seed: 0.5, startX: -15, startZ: 0 };

function passagesWithRiver(river: Passage): Passage[] {
  return Array.from({ length: grid.cellCount }, (_, cell) => {
    return grid.columnOf(cell) === RIVER_COLUMN ? river : Passage.Ground;
  });
}

describe("bank regions", () => {
  it("part the land a river cuts in two", () => {
    const regions = new BankRegions(grid, passagesWithRiver(Passage.Blocked), []);

    expect(regions.isGround(LEFT)).toBe(true);
    expect(regions.isGround(grid.cellAt(-5, 0))).toBe(false);
    expect(regions.isGround(-1)).toBe(false);
    expect(regions.separates(LEFT, RIGHT)).toBe(true);
    expect(regions.wouldJoin(FORD)).toBe(true);
  });

  it("join the two banks across a crossing", () => {
    const regions = new BankRegions(grid, passagesWithRiver(Passage.Blocked), []);

    regions.join(FORD);

    expect(regions.separates(LEFT, RIGHT)).toBe(false);
    expect(new BankRegions(grid, passagesWithRiver(Passage.Blocked), [FORD]).wouldJoin(FORD)).toBe(false);
  });

  it("join the two banks of a brook that can be hopped", () => {
    const regions = new BankRegions(grid, passagesWithRiver(Passage.Brook), []);

    expect(regions.separates(LEFT, RIGHT)).toBe(false);
  });
});
