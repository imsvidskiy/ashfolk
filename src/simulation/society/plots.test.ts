import { describe, expect, it } from "vitest";
import { isFruitTreeSpecies } from "../../content/cultivated-plants.ts";
import { PlantSpecies } from "../../content/plants.ts";
import type { TechnologyId } from "../../content/technologies.ts";
import { NO_PLANT } from "../../world/vegetation-store.ts";
import { MORNING, moveToSeason, SocietyHarness, settle, teach } from "../testing/test-society.ts";
import { NO_BUILDING, PLOT_GROUND } from "../world/world-state.ts";
import {
  addPlotIfNeeded,
  emptySpot,
  isProtectedPlant,
  plantedCount,
  plantSpot,
  ripestFruitTree,
  updatePlots,
} from "./plots.ts";
import type { Plot, PlotSpot, Tribe } from "./tribe.ts";

const LONG_AFTER_DAYS = 100;

interface OpenedPlot {
  harness: SocietyHarness;
  plot: Plot;
  tribe: Tribe;
}

function openPlot(technology: TechnologyId): OpenedPlot {
  const harness = new SocietyHarness({ day: MORNING });

  const tribe = teach(settle(harness, 6), ["farming", technology]);

  addPlotIfNeeded(tribe, harness.context);

  const [plot] = tribe.plots;

  if (plot === undefined) {
    throw new Error("Expected a plot");
  }

  return { harness, plot, tribe };
}

function fruitTreeSpot(plot: Plot): PlotSpot {
  const tree = plot.spots.find((spot) => {
    return isFruitTreeSpecies(spot.species);
  });

  if (tree === undefined) {
    throw new Error("Expected a fruit tree spot");
  }

  return tree;
}

function vacateSpot(harness: SocietyHarness, tribe: Tribe, spot: PlotSpot): number {
  plantSpot(tribe, spot, harness.context);

  const slot = spot.plant;

  harness.world.removePlant(slot);

  return slot;
}

function plantStranger(harness: SocietyHarness, tribe: Tribe): number {
  return harness.world.plant({
    bornDay: harness.context.environment.day,
    height: 8,
    rotation: 0,
    seed: 0.5,
    species: PlantSpecies.Oak,
    x: tribe.campX - 150,
    z: tribe.campZ,
  });
}

describe("orchards", () => {
  it("are planted with fruit trees and berry bushes that grow and bear fruit in autumn", () => {
    const { harness, plot: orchard, tribe } = openPlot("orchards");

    const tree = fruitTreeSpot(orchard);

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
    const { harness, plot: orchard, tribe } = openPlot("orchards");

    const [spot] = orchard.spots;

    for (const cell of harness.world.grid.cellsInRadius(spot.x, spot.z, 30)) {
      harness.world.terrain.coastDistance[cell] = 0;
    }

    expect(plantSpot(tribe, spot, harness.context)).toBe(false);
    expect(spot.plant).toBe(NO_PLANT);
    expect(spot.plantedDay).toBe(0);
  });

  it("are given back to the land when their tribe dies out", () => {
    const { harness, plot: orchard, tribe } = openPlot("orchards");

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

describe("plot spots", () => {
  it("are replanted once their plant is gone, even after another plant takes over its slot", () => {
    const { harness, plot: orchard, tribe } = openPlot("orchards");

    const [first, second] = orchard.spots;

    const vacatedSlot = vacateSpot(harness, tribe, first);

    plantSpot(tribe, second, harness.context);

    expect(second.plant).toBe(vacatedSlot);
    expect(emptySpot(tribe, harness.world, new Set())).toBe(first);
    expect(plantedCount(tribe, harness.world, "orchard")).toBe(1);
  });

  it("protect a woodlot sapling until it has grown", () => {
    const { harness, plot: woodlot, tribe } = openPlot("forestry");

    const [spot] = woodlot.spots;

    const { day } = harness.context.environment;

    expect(woodlot.kind).toBe("woodlot");
    expect(plantSpot(tribe, spot, harness.context)).toBe(true);
    expect(isProtectedPlant(tribe, harness.world, spot.plant, day)).toBe(true);
    expect(isProtectedPlant(tribe, harness.world, spot.plant, day + LONG_AFTER_DAYS)).toBe(false);
  });

  it("protect only the plants that still stand on them", () => {
    const { harness, plot: orchard, tribe } = openPlot("orchards");

    const [first] = orchard.spots;

    const vacatedSlot = vacateSpot(harness, tribe, first);
    const stranger = plantStranger(harness, tribe);

    expect(stranger).toBe(vacatedSlot);
    expect(isProtectedPlant(tribe, harness.world, stranger, harness.context.environment.day)).toBe(false);
  });

  it("neither tend nor offer for picking a plant that took over their slot elsewhere", () => {
    const { harness, plot: orchard, tribe } = openPlot("orchards");

    const tree = fruitTreeSpot(orchard);

    const { vegetation } = harness.world;

    const vacatedSlot = vacateSpot(harness, tribe, tree);
    const stranger = plantStranger(harness, tribe);

    vegetation.setFruit(stranger, 0.5);
    tree.plantedDay = harness.context.environment.day - 30;
    moveToSeason(harness, 2);
    updatePlots(tribe, harness.context, 0.5);

    expect(stranger).toBe(vacatedSlot);
    expect(vegetation.height[stranger]).toBe(8);
    expect(vegetation.fruit[stranger]).toBe(0.5);
    expect(ripestFruitTree(tribe, harness.world)).toBeNull();
  });
});
