import { describe, expect, it } from "vitest";
import { Ground } from "../../content/grounds.ts";
import type { WorldMirror } from "../../game/world-mirror.ts";
import { GROUND_CHANNELS, GroundChannel } from "../../world/agent-buffers.ts";
import { createVegetatedMirror } from "../testing/vegetated-mirror.ts";
import { FieldPlan, FurrowAxis } from "./field-plan.ts";

const FIRST_COLUMN = 20;
const FIRST_ROW = 24;
const RISE = 60;

type CellStep = readonly [column: number, row: number];

function cellsOf(mirror: WorldMirror, steps: readonly CellStep[]): number[] {
  return steps.map(([column, row]) => {
    return mirror.grid.index(FIRST_COLUMN + column, FIRST_ROW + row);
  });
}

function setGround(mirror: WorldMirror, cells: readonly number[], ground: number): void {
  for (const cell of cells) {
    mirror.ground[cell * GROUND_CHANNELS + GroundChannel.Ground] = ground;
  }
}

function plow(mirror: WorldMirror, plan: FieldPlan, cells: readonly number[], ground: number): void {
  setGround(mirror, cells, ground);
  plan.groundChanged([{ firstRow: 0, rowCount: mirror.grid.cellsPerSide }]);
}

describe("field plan", () => {
  it("gives every cell of a field the same furrow direction", () => {
    const mirror = createVegetatedMirror();
    const plan = new FieldPlan(mirror);

    const field = cellsOf(mirror, [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [0, 2],
      [1, 3],
    ]);

    plow(mirror, plan, field, Ground.Farm);

    const axes = new Set(
      field.map((cell) => {
        return plan.axisAt(cell);
      })
    );

    expect(axes.size).toBe(1);
    expect(axes.has(FurrowAxis.None)).toBe(false);
    expect(plan.axisAt(mirror.grid.index(FIRST_COLUMN + 1, FIRST_ROW + 1))).toBe(FurrowAxis.None);
  });

  it("runs furrows along the longer side of a field on flat ground", () => {
    const mirror = createVegetatedMirror();
    const plan = new FieldPlan(mirror);

    const wide = cellsOf(mirror, [
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    const long = cellsOf(mirror, [
      [6, 0],
      [6, 1],
      [6, 2],
    ]);

    plow(mirror, plan, [...wide, ...long], Ground.Farm);

    expect(
      wide.every((cell) => {
        return plan.axisAt(cell) === FurrowAxis.AlongX;
      })
    ).toBe(true);
    expect(
      long.every((cell) => {
        return plan.axisAt(cell) === FurrowAxis.AlongZ;
      })
    ).toBe(true);
  });

  it("runs furrows across the slope of a hillside field", () => {
    const mirror = createVegetatedMirror({
      heightAt: (x) => {
        return 100 + x * 0.2;
      },
    });
    const plan = new FieldPlan(mirror);

    const field = cellsOf(mirror, [
      [0, 0],
      [1, 0],
      [2, 0],
    ]);

    plow(mirror, plan, field, Ground.Farm);

    expect(
      field.every((cell) => {
        return plan.axisAt(cell) === FurrowAxis.AlongZ;
      })
    ).toBe(true);
  });

  it("turns the furrows of a field when the ground just beside it rises", () => {
    const mirror = createVegetatedMirror();
    const plan = new FieldPlan(mirror);

    const field = cellsOf(mirror, [
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    const [beside] = cellsOf(mirror, [[3, 0]]);

    plow(mirror, plan, field, Ground.Farm);
    mirror.terrain.height[beside] += RISE;
    plan.heightsChanged({
      firstColumn: mirror.grid.columnOf(beside),
      firstRow: FIRST_ROW,
      lastColumn: mirror.grid.columnOf(beside),
      lastRow: FIRST_ROW,
    });

    expect(
      field.every((cell) => {
        return plan.axisAt(cell) === FurrowAxis.AlongZ;
      })
    ).toBe(true);
  });

  it("forgets cells that are no longer farmed", () => {
    const mirror = createVegetatedMirror();
    const plan = new FieldPlan(mirror);

    const field = cellsOf(mirror, [
      [0, 0],
      [1, 0],
    ]);

    plow(mirror, plan, field, Ground.Farm);

    const { revision } = plan;

    plow(mirror, plan, field, Ground.Meadow);

    expect(
      field.every((cell) => {
        return plan.axisAt(cell) === FurrowAxis.None;
      })
    ).toBe(true);
    expect(plan.revision).toBeGreaterThan(revision);
  });
});
