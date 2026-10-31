import { describe, expect, it } from "vitest";
import { isFruitTreeSpecies } from "../../content/cultivated-plants.ts";
import { NO_PLANT } from "../../world/vegetation-store.ts";
import { MORNING, moveToSeason, SocietyHarness, settle, teach } from "../testing/test-society.ts";
import { NO_BUILDING, PLOT_GROUND } from "../world/world-state.ts";
import { addPlotIfNeeded, plantSpot, ripestFruitTree, updatePlots } from "./plots.ts";

describe("orchards", () => {
  it("are planted with fruit trees and berry bushes that grow and bear fruit in autumn", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = teach(settle(harness, 6), ["farming", "orchards"]);

    addPlotIfNeeded(tribe, harness.context);

    const [orchard] = tribe.plots;

    if (orchard === undefined) {
      throw new Error("Expected an orchard");
    }

    const tree = orchard.spots.find((spot) => {
      return isFruitTreeSpecies(spot.species);
    });

    if (tree === undefined) {
      throw new Error("Expected a fruit tree spot");
    }

    expect(orchard.kind).toBe("orchard");
    expect(
      orchard.spots.some((spot) => {
        return !isFruitTreeSpecies(spot.species);
      })
    ).toBe(true);

    plantSpot(tribe, tree, harness.context);

    const { vegetation } = harness.world;

    const sapling = vegetation.height[tree.plant];

    tree.plantedDay = harness.context.environment.day - 30;
    moveToSeason(harness, 2);
    updatePlots(tribe, harness.context, 0.5);

    expect(vegetation.isAlive(tree.plant)).toBe(true);
    expect(vegetation.height[tree.plant]).toBeGreaterThan(sapling * 2);
    expect(vegetation.fruit[tree.plant]).toBeGreaterThan(0.3);
    expect(ripestFruitTree(tribe, harness.world)).toBe(tree.plant);
  });

  it("count a planting only once the sapling has taken root", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = teach(settle(harness, 6), ["farming", "orchards"]);

    addPlotIfNeeded(tribe, harness.context);

    const [orchard] = tribe.plots;

    if (orchard === undefined) {
      throw new Error("Expected an orchard");
    }

    const [spot] = orchard.spots;

    for (const cell of harness.world.grid.cellsInRadius(spot.x, spot.z, 30)) {
      harness.world.terrain.coastDistance[cell] = 0;
    }

    expect(plantSpot(tribe, spot, harness.context)).toBe(false);
    expect(spot.plant).toBe(NO_PLANT);
    expect(spot.plantedDay).toBe(0);
  });

  it("are given back to the land when their tribe dies out", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = teach(settle(harness, 6), ["farming", "orchards"]);

    addPlotIfNeeded(tribe, harness.context);

    const [orchard] = tribe.plots;

    if (orchard === undefined) {
      throw new Error("Expected an orchard");
    }

    const { cells } = orchard;
    const { occupancy } = harness.world;

    expect(
      cells.every((cell) => {
        return occupancy[cell] === PLOT_GROUND;
      })
    ).toBe(true);

    harness.society.damageArea(tribe.campX, tribe.campZ, 200, 5, "blast");

    expect(harness.society.findTribe(tribe.id)).toBeNull();
    expect(
      cells.every((cell) => {
        return occupancy[cell] === NO_BUILDING;
      })
    ).toBe(true);
  });
});
