import { clamp, FULL_TURN } from "../../shared/math.ts";
import { isDryLand, type Waypoint } from "../agents/navigation.ts";
import { setAlight } from "../society/buildings.ts";
import { discover } from "../society/progress.ts";
import { cellsInArea } from "../world/terrain-editing.ts";
import type { WorldState } from "../world/world-state.ts";
import type { PowerServices } from "./power-handler.ts";

const STRIKE_RADIUS = 20;
const STRIKE_INTENSITY = 0.65;
const STRIKE_SCORCH = 0.5;
const STRIKE_KILL_RADIUS = 14;
const STRIKE_PEOPLE_DAMAGE = 3;
const STRIKE_ANIMAL_DAMAGE = 6;
const STRIKE_BUILDING_RADIUS = 18;
const STRIKE_SCARE_RADIUS = 200;
const TEACHING_DISTANCE = 300;
const SOAKED = 0.5;

const NATURAL_STRIKE_ATTEMPTS = 6;
const ANY_LAND_STRIKE_ATTEMPT = 4;
const NEAREST_NATURAL_STRIKE = 300;
const FARTHEST_NATURAL_STRIKE = 2500;
const HIGH_GROUND = 700;
const TALL_FOREST = 1;
const ISLAND_MARGIN = 60;

interface Strike {
  ignitionChance: number;
  isNatural: boolean;
  x: number;
  z: number;
}

function isRainedOn(services: PowerServices, cell: number, strike: Strike): boolean {
  if (!strike.isNatural || services.world.fields.wetness[cell] <= SOAKED) {
    return false;
  }

  return services.random.chance(services.environment.precipitation);
}

function catchesFire(services: PowerServices, cell: number, strike: Strike): boolean {
  if (isRainedOn(services, cell, strike)) {
    return false;
  }

  return services.random.chance(strike.ignitionChance);
}

function teachFire(services: PowerServices, strike: Strike): void {
  const tribe = services.people.nearestTribe(strike.x, strike.z, TEACHING_DISTANCE);

  if (tribe === null) {
    return;
  }

  discover(tribe, "fire", `${tribe.name} saw lightning strike and kept the flame`, services);
}

function isStrikeSite(world: WorldState, cell: number, shouldAcceptAnyLand: boolean): boolean {
  if (!isDryLand(world, cell)) {
    return false;
  }

  return shouldAcceptAnyLand || world.terrain.height[cell] > HIGH_GROUND || world.canopyFuel[cell] > TALL_FOREST;
}

export function naturalStrikeSite(focus: Waypoint, services: PowerServices): Waypoint | null {
  const { random, world } = services;

  const limit = world.grid.halfSize - ISLAND_MARGIN;

  for (let attempt = 0; attempt < NATURAL_STRIKE_ATTEMPTS; attempt += 1) {
    const angle = random.next() * FULL_TURN;
    const distance = random.between(NEAREST_NATURAL_STRIKE, FARTHEST_NATURAL_STRIKE);

    const x = clamp(focus.x + Math.cos(angle) * distance, -limit, limit);
    const z = clamp(focus.z + Math.sin(angle) * distance, -limit, limit);

    if (isStrikeSite(world, world.grid.cellAt(x, z), attempt >= ANY_LAND_STRIKE_ATTEMPT)) {
      return { x, z };
    }
  }

  return null;
}

export function strikeLightning(strike: Strike, services: PowerServices): void {
  const { buildings, fauna, fire, people, world } = services;

  services.effects.add({ isNatural: strike.isNatural, kind: "lightning", x: strike.x, z: strike.z });

  for (const { cell } of cellsInArea(world, { radius: STRIKE_RADIUS, x: strike.x, z: strike.z })) {
    if (catchesFire(services, cell, strike)) {
      fire.ignite(cell, STRIKE_INTENSITY);
    }

    world.fields.scorch[cell] = Math.max(world.fields.scorch[cell], STRIKE_SCORCH);
    world.markSurfaceCell(cell);
  }

  people.damageArea(strike.x, strike.z, STRIKE_KILL_RADIUS, STRIKE_PEOPLE_DAMAGE, "lightning");
  fauna.damageArea(strike.x, strike.z, STRIKE_KILL_RADIUS, STRIKE_ANIMAL_DAMAGE, "lightning");
  fauna.scare(strike.x, strike.z, STRIKE_SCARE_RADIUS);

  for (const building of buildings.all) {
    if (Math.hypot(building.x - strike.x, building.z - strike.z) < STRIKE_BUILDING_RADIUS) {
      setAlight(building);
    }
  }

  teachFire(services, strike);
}
