import { isBiomeIndex } from "../../content/biomes.ts";
import { FRUIT_TREE_SPECIES, GARDEN_BERRY_SPECIES, isFruitTreeSpecies } from "../../content/cultivated-plants.ts";
import {
  PlantSpecies,
  type PlantSpeciesIndex,
  plantSpeciesDefinition,
  regrowingSpecies,
} from "../../content/plants.ts";
import { FULL_TURN, hashToUnit, lerp, saturate } from "../../shared/math.ts";
import { NO_PLANT } from "../../world/vegetation-store.ts";
import { aroundPoint } from "../agents/navigation.ts";
import { NO_BUILDING, PLOT_GROUND, type WorldState } from "../world/world-state.ts";
import type { SocietyContext } from "./society-context.ts";
import { knows, type Plot, type PlotKind, type PlotSpot, type Tribe } from "./tribe.ts";
import { campPoint } from "./tribe-places.ts";

const BERRY_MATURE_DAYS = 3;
const BERRY_SAPLING_HEIGHT = 0.5;
const PLOT_SLOPE = 0.35;
const PLOT_ATTEMPTS = 30;
const NEAREST_PLOT = 40;
const FARTHEST_PLOT = 95;
const GROWTH_UPDATE_DAYS = 0.2;
const HEIGHT_STEP = 0.15;
const FRUITING_AGE = 0.6;
const FRUIT_START = 1.45;
const FRUIT_END = 2.75;
const FRUIT_GROWTH_PER_DAY = 0.75;
const FRUIT_FALL_PER_DAY = 1.5;
const SPECIES_SALT = 7.7;
const HEIGHT_SALT = 3.3;
const FALLBACK_TIMBER: readonly PlantSpeciesIndex[] = [PlantSpecies.Oak, PlantSpecies.Birch, PlantSpecies.Pine];

interface PlotLayout {
  columns: number;
  matureDays: number;
  rows: number;
  saplingHeight: number;
  spacing: number;
}

const LAYOUTS: Readonly<Record<PlotKind, PlotLayout>> = {
  orchard: { columns: 3, matureDays: 10, rows: 2, saplingHeight: 1.4, spacing: 6.5 },
  woodlot: { columns: 3, matureDays: 14, rows: 2, saplingHeight: 2.2, spacing: 5 },
};

function plotWanted(tribe: Tribe): PlotKind | null {
  const kinds = tribe.plots.map((plot) => {
    return plot.kind;
  });

  if (knows(tribe, "orchards") && !kinds.includes("orchard")) {
    return "orchard";
  }

  if (knows(tribe, "forestry") && !kinds.includes("woodlot")) {
    return "woodlot";
  }

  return null;
}

function plotCells(world: WorldState, column: number, row: number, layout: PlotLayout): number[] | null {
  const { grid } = world;

  const cells: number[] = [];

  for (let rowOffset = 0; rowOffset < layout.rows; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < layout.columns; columnOffset += 1) {
      if (!grid.contains(column + columnOffset, row + rowOffset)) {
        return null;
      }

      const cell = grid.index(column + columnOffset, row + rowOffset);

      if (!(world.isWalkable(cell) && world.canPlace(cell, PLOT_SLOPE)) || world.isTrodden(cell)) {
        return null;
      }

      cells.push(cell);
    }
  }

  return cells;
}

function timberSpecies(world: WorldState, cell: number): readonly PlantSpeciesIndex[] {
  const biome = world.terrain.biome[cell];

  if (!isBiomeIndex(biome)) {
    return FALLBACK_TIMBER;
  }

  const local = regrowingSpecies(biome, world.terrain.baseTemperature[cell]);

  return local.length > 0 ? local : FALLBACK_TIMBER;
}

function spotSpecies(kind: PlotKind, row: number, column: number, timber: readonly PlantSpeciesIndex[]): number {
  if (kind === "woodlot") {
    return timber[Math.floor(hashToUnit(row, column, SPECIES_SALT) * timber.length)];
  }

  if (row === 0) {
    return GARDEN_BERRY_SPECIES[column % GARDEN_BERRY_SPECIES.length];
  }

  return FRUIT_TREE_SPECIES[(row + column) % FRUIT_TREE_SPECIES.length];
}

function layOutSpots(world: WorldState, kind: PlotKind, cells: readonly number[], layout: PlotLayout): PlotSpot[] {
  const { grid } = world;
  const [first] = cells;

  const timber = timberSpecies(world, first);
  const originX = grid.cellCenterX(first) - grid.cellSize / 2;
  const originZ = grid.cellCenterZ(first) - grid.cellSize / 2;
  const across = Math.floor((layout.columns * grid.cellSize) / layout.spacing);
  const along = Math.floor((layout.rows * grid.cellSize) / layout.spacing);

  const spots: PlotSpot[] = [];

  for (let row = 0; row < along; row += 1) {
    for (let column = 0; column < across; column += 1) {
      spots.push({
        plant: NO_PLANT,
        plantedDay: 0,
        species: spotSpecies(kind, row, column, timber),
        x: originX + (column + 0.5) * layout.spacing,
        z: originZ + (row + 0.5) * layout.spacing,
      });
    }
  }

  return spots;
}

export function addPlotIfNeeded(tribe: Tribe, context: SocietyContext): void {
  const kind = plotWanted(tribe);

  if (kind === null) {
    return;
  }

  const { random, world } = context;

  const layout = LAYOUTS[kind];

  for (let attempt = 0; attempt < PLOT_ATTEMPTS; attempt += 1) {
    const corner = aroundPoint(
      campPoint(tribe),
      random.between(NEAREST_PLOT, FARTHEST_PLOT),
      random.next() * FULL_TURN
    );

    const cells = plotCells(world, world.grid.columnAt(corner.x), world.grid.rowAt(corner.z), layout);

    if (cells !== null) {
      openPlot(tribe, kind, cells, world);

      return;
    }
  }
}

function openPlot(tribe: Tribe, kind: PlotKind, cells: readonly number[], world: WorldState): void {
  for (const cell of cells) {
    world.clearPlants(cell, false);
    world.occupancy[cell] = PLOT_GROUND;
  }

  tribe.plots.push({ cells: [...cells], kind, spots: layOutSpots(world, kind, cells, LAYOUTS[kind]) });
}

export function abandonPlots(tribe: Tribe, world: WorldState): void {
  for (const plot of tribe.plots) {
    for (const cell of plot.cells) {
      if (world.occupancy[cell] === PLOT_GROUND) {
        world.occupancy[cell] = NO_BUILDING;
      }
    }
  }

  tribe.plots = [];
}

function isSpotEmpty(spot: PlotSpot, world: WorldState): boolean {
  return spot.plant === NO_PLANT || !world.vegetation.isAlive(spot.plant);
}

export function emptySpot(tribe: Tribe, world: WorldState, taken: ReadonlySet<PlotSpot>): PlotSpot | null {
  for (const plot of tribe.plots) {
    const spot = plot.spots.find((candidate) => {
      return isSpotEmpty(candidate, world) && !taken.has(candidate);
    });

    if (spot !== undefined) {
      return spot;
    }
  }

  return null;
}

function matureDays(spot: PlotSpot, plotKind: PlotKind): number {
  if (plantSpeciesDefinition(spot.species).form === "shrub") {
    return BERRY_MATURE_DAYS;
  }

  return LAYOUTS[plotKind].matureDays;
}

function saplingHeight(spot: PlotSpot, plotKind: PlotKind): number {
  if (plantSpeciesDefinition(spot.species).form === "shrub") {
    return BERRY_SAPLING_HEIGHT;
  }

  return LAYOUTS[plotKind].saplingHeight;
}

function matureHeight(spot: PlotSpot): number {
  const [shortest, tallest] = plantSpeciesDefinition(spot.species).heightRange;

  return lerp(shortest, tallest, hashToUnit(spot.x, spot.z, HEIGHT_SALT));
}

function plotOfSpot(tribe: Tribe, spot: PlotSpot): Plot | null {
  const plot = tribe.plots.find((candidate) => {
    return candidate.spots.includes(spot);
  });

  if (plot === undefined) {
    return null;
  }

  return plot;
}

export function plantSpot(tribe: Tribe, spot: PlotSpot, context: SocietyContext): boolean {
  const { environment, random, world } = context;

  const plot = plotOfSpot(tribe, spot);

  if (plot === null || !isSpotEmpty(spot, world)) {
    return false;
  }

  const plant = world.plant({
    bornDay: environment.day,
    height: saplingHeight(spot, plot.kind),
    rotation: random.next() * FULL_TURN,
    seed: random.next(),
    species: spot.species,
    x: spot.x,
    z: spot.z,
  });

  if (plant === NO_PLANT) {
    return false;
  }

  spot.plant = plant;
  spot.plantedDay = environment.day;

  return true;
}

function plotAge(spot: PlotSpot, plotKind: PlotKind, day: number): number {
  return saturate((day - spot.plantedDay) / matureDays(spot, plotKind));
}

export function isProtectedPlant(tribe: Tribe, plant: number, species: number, day: number): boolean {
  if (isFruitTreeSpecies(species)) {
    return true;
  }

  for (const plot of tribe.plots) {
    const spot = plot.spots.find((candidate) => {
      return candidate.plant === plant;
    });

    if (spot !== undefined) {
      return plot.kind === "orchard" || plotAge(spot, plot.kind, day) < 1;
    }
  }

  return false;
}

function fruitChangePerDay(season: number): number {
  if (season >= FRUIT_START && season < FRUIT_END) {
    return FRUIT_GROWTH_PER_DAY;
  }

  if (season >= FRUIT_END) {
    return -FRUIT_FALL_PER_DAY;
  }

  return 0;
}

function tendSpot(spot: PlotSpot, plotKind: PlotKind, context: SocietyContext, days: number): void {
  const { world } = context;
  const { day, season } = context.environment;

  if (isSpotEmpty(spot, world)) {
    return;
  }

  const age = plotAge(spot, plotKind, day);
  const height = lerp(saplingHeight(spot, plotKind), matureHeight(spot), age);

  if (Math.abs(world.vegetation.height[spot.plant] - height) > HEIGHT_STEP) {
    world.vegetation.setHeight(spot.plant, height);
  }

  if (!isFruitTreeSpecies(spot.species) || age < FRUITING_AGE) {
    return;
  }

  const fruit = world.vegetation.fruit[spot.plant] + fruitChangePerDay(season) * days;

  world.vegetation.setFruit(spot.plant, saturate(fruit));
}

export function updatePlots(tribe: Tribe, context: SocietyContext, days: number): void {
  tribe.timers.plotDays += days;

  if (tribe.timers.plotDays < GROWTH_UPDATE_DAYS) {
    return;
  }

  const elapsed = tribe.timers.plotDays;

  tribe.timers.plotDays = 0;

  for (const plot of tribe.plots) {
    for (const spot of plot.spots) {
      tendSpot(spot, plot.kind, context, elapsed);
    }
  }
}

export function ripestFruitTree(tribe: Tribe, world: WorldState): number | null {
  let ripest: number | null = null;
  let ripestFruit = 0.25;

  for (const plot of tribe.plots) {
    for (const spot of plot.spots) {
      const isPickable =
        isFruitTreeSpecies(spot.species) &&
        !isSpotEmpty(spot, world) &&
        !tribe.claimedPlants.has(spot.plant) &&
        !world.isWater(world.vegetation.cell[spot.plant]);

      if (isPickable && world.vegetation.fruit[spot.plant] > ripestFruit) {
        ripest = spot.plant;
        ripestFruit = world.vegetation.fruit[spot.plant];
      }
    }
  }

  return ripest;
}

export function plantedCount(tribe: Tribe, world: WorldState, kind: PlotKind): number {
  return tribe.plots
    .filter((plot) => {
      return plot.kind === kind;
    })
    .reduce((count, plot) => {
      return (
        count +
        plot.spots.filter((spot) => {
          return !isSpotEmpty(spot, world);
        }).length
      );
    }, 0);
}
