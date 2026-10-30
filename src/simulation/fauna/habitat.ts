import { ANIMAL_KINDS, ANIMALS, type AnimalKind, animalsAt } from "../../content/animals.ts";
import { FULL_TURN } from "../../shared/math.ts";
import type { RandomSource } from "../../shared/random.ts";
import { aroundPoint, type Waypoint } from "../agents/navigation.ts";
import type { WorldState } from "../world/world-state.ts";
import type { Animal } from "./fauna.ts";

const EDGE_REACH_CELLS = 3;
const PASTURE_ATTEMPTS = 8;
const ANY_BIOME_ATTEMPT = 6;
const DISPERSAL_RANGE: readonly [number, number] = [120, 420];
const FLEE_DISTANCE = 120;
const ESCAPE_TURNS: readonly number[] = [0, -0.6, 0.6, -1.1, 1.1];
const ESCAPE_JINK = 0.7;

function kindForBiome(biome: number, random: RandomSource): AnimalKind | null {
  const kinds = animalsAt(biome);

  const total = kinds.reduce((sum, kind) => {
    return sum + ANIMALS[kind].abundance;
  }, 0);

  let remaining = random.next() * total;

  for (const kind of kinds) {
    remaining -= ANIMALS[kind].abundance;

    if (remaining < 0) {
      return kind;
    }
  }

  return null;
}

function isFavoriteBiome(kind: AnimalKind, biome: number): boolean {
  return ANIMALS[kind].favoriteBiomes.some((favorite) => {
    return favorite === biome;
  });
}

function bordersFavorite(world: WorldState, kind: AnimalKind, cell: number): boolean {
  const { grid, terrain } = world;

  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);

  for (let rowStep = -EDGE_REACH_CELLS; rowStep <= EDGE_REACH_CELLS; rowStep += 1) {
    for (let columnStep = -EDGE_REACH_CELLS; columnStep <= EDGE_REACH_CELLS; columnStep += 1) {
      const isInside = grid.contains(column + columnStep, row + rowStep);

      if (isInside && isFavoriteBiome(kind, terrain.biome[grid.index(column + columnStep, row + rowStep)])) {
        return true;
      }
    }
  }

  return false;
}

function isHomeGround(world: WorldState, kind: AnimalKind, cell: number): boolean {
  const biome = world.terrain.biome[cell];

  if (isFavoriteBiome(kind, biome)) {
    return true;
  }

  return (
    ANIMALS[kind].edgeBiomes.some((edge) => {
      return edge === biome;
    }) && bordersFavorite(world, kind, cell)
  );
}

function isOpenPasture(world: WorldState, kind: AnimalKind, x: number, z: number, isAnyBiome: boolean): boolean {
  const cell = world.grid.cellAt(x, z);

  if (!canStand(world, kind, x, z) || world.isBurning(cell)) {
    return false;
  }

  return isAnyBiome || isHomeGround(world, kind, cell);
}

function groundHeight(world: WorldState, point: Waypoint): number {
  const cell = world.grid.cellAt(point.x, point.z);

  if (cell < 0) {
    return Number.NEGATIVE_INFINITY;
  }

  return world.terrain.height[cell];
}

export function canStand(world: WorldState, kind: AnimalKind, x: number, z: number): boolean {
  if (!world.isWalkableAt(x, z)) {
    return false;
  }

  return !(ANIMALS[kind].isSmallGame && world.touchesWater(world.grid.cellAt(x, z)));
}

export function herdKindAt(world: WorldState, x: number, z: number, random: RandomSource): AnimalKind | null {
  const cell = world.grid.cellAt(x, z);

  if (cell < 0 || !world.isWalkableAt(x, z)) {
    return null;
  }

  return kindForBiome(world.terrain.biome[cell], random);
}

export function smallGameAt(world: WorldState, x: number, z: number): AnimalKind | null {
  const cell = world.grid.cellAt(x, z);

  if (cell < 0) {
    return null;
  }

  const kind = ANIMAL_KINDS.find((candidate) => {
    return ANIMALS[candidate].isSmallGame && isHomeGround(world, candidate, cell);
  });

  if (kind === undefined || !canStand(world, kind, x, z)) {
    return null;
  }

  return kind;
}

export function findPasture(
  world: WorldState,
  kind: AnimalKind,
  from: Waypoint,
  random: RandomSource
): Waypoint | null {
  const { pastureRange, seeksHighGround } = ANIMALS[kind];

  let best: Waypoint | null = null;

  for (let attempt = 0; attempt < PASTURE_ATTEMPTS; attempt += 1) {
    const angle = random.next() * FULL_TURN;
    const distance = random.between(pastureRange[0], pastureRange[1]);

    const pasture = aroundPoint(from, distance, angle);

    if (!isOpenPasture(world, kind, pasture.x, pasture.z, attempt >= ANY_BIOME_ATTEMPT)) {
      continue;
    }

    if (!seeksHighGround) {
      return pasture;
    }

    if (best === null || groundHeight(world, pasture) > groundHeight(world, best)) {
      best = pasture;
    }
  }

  return best;
}

export function findNewHome(
  world: WorldState,
  kind: AnimalKind,
  from: Waypoint,
  random: RandomSource
): Waypoint | null {
  for (let attempt = 0; attempt < PASTURE_ATTEMPTS; attempt += 1) {
    const home = aroundPoint(from, random.between(DISPERSAL_RANGE[0], DISPERSAL_RANGE[1]), random.next() * FULL_TURN);

    if (isOpenPasture(world, kind, home.x, home.z, false)) {
      return home;
    }
  }

  return null;
}

export function escapeRoute(world: WorldState, animal: Animal, random: RandomSource): Waypoint {
  const { mover } = animal;

  const awayX = mover.x - animal.fleeFromX;
  const awayZ = mover.z - animal.fleeFromZ;

  const away = Math.atan2(awayZ, awayX);

  if (ANIMALS[animal.kind].isSmallGame) {
    return aroundPoint(mover, FLEE_DISTANCE, away + random.signed() * ESCAPE_JINK);
  }

  if (!ANIMALS[animal.kind].seeksHighGround) {
    return aroundPoint(mover, FLEE_DISTANCE, away);
  }

  let best = aroundPoint(mover, FLEE_DISTANCE, away);
  let bestHeight = Number.NEGATIVE_INFINITY;

  for (const turn of ESCAPE_TURNS) {
    const candidate = aroundPoint(mover, FLEE_DISTANCE, away + turn);

    const height = groundHeight(world, candidate);

    if (world.isWalkableAt(candidate.x, candidate.z) && height > bestHeight) {
      best = candidate;
      bestHeight = height;
    }
  }

  return best;
}
