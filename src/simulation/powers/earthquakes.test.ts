import { describe, expect, it } from "vitest";
import { PlantState } from "../../world/vegetation-store.ts";
import { createForest, treesWithin } from "../testing/test-powers.ts";

describe("earthquakes", () => {
  it("throw trees down instead of making them vanish", () => {
    const simulation = createForest();

    simulation.usePower("earthquake", 0, 0, { magnitude: 100, radius: 300 });

    expect(treesWithin(simulation, 300, PlantState.Fallen)).toBeGreaterThan(20);
  });

  it("name the thrown trees as fallen when the ground is inspected", () => {
    const simulation = createForest();
    const { vegetation } = simulation.world;

    simulation.usePower("earthquake", 0, 0, { magnitude: 100, radius: 300 });

    const fallen = vegetation.state.subarray(0, vegetation.count).indexOf(PlantState.Fallen);

    expect(fallen).toBeGreaterThanOrEqual(0);

    simulation.setSelection({ kind: "cell", x: vegetation.x[fallen], z: vegetation.z[fallen] });

    expect(simulation.advance(0).inspection).toMatchObject({
      plants: expect.arrayContaining([expect.objectContaining({ name: expect.stringContaining("(fallen)") })]),
    });
  });

  it("leave the cells they throw trees in to regrow and no bare ones", () => {
    const simulation = createForest();
    const { world } = simulation;
    const { vegetation } = world;

    const clearing = world.grid.cellsInRadius(0, 0, 150);

    for (const cell of clearing) {
      world.clearPlants(cell, true);
    }

    simulation.usePower("earthquake", 0, 0, { magnitude: 100, radius: 300 });

    const day = Math.fround(simulation.environment.day);
    const thrownCells = Array.from({ length: vegetation.count }, (_, plant) => {
      return plant;
    })
      .filter((plant) => {
        return vegetation.state[plant] === PlantState.Fallen;
      })
      .map((plant) => {
        return vegetation.cell[plant];
      });

    expect(thrownCells.length).toBeGreaterThan(20);
    expect(
      thrownCells.filter((cell) => {
        return !world.recovering.has(cell) || world.disturbedDay[cell] !== day;
      })
    ).toEqual([]);
    expect(
      clearing.filter((cell) => {
        return world.recovering.has(cell);
      })
    ).toEqual([]);
  });
});
