import { isShrubSpecies, isTreeSpecies } from "../../content/plants.ts";
import { FULL_TURN, hashToUnit, lerp } from "../../shared/math.ts";
import type { Mover } from "../agents/movement.ts";
import type { Waypoint } from "../agents/navigation.ts";
import { cellsInArea } from "../world/terrain-editing.ts";
import type { WorldState } from "../world/world-state.ts";
import type { PowerServices } from "./power-handler.ts";

const STEP_SECONDS = 0.5;
const CALM_WIND = 2;
const BASE_SPEED = 9;
const SPEED_PER_WIND = 0.45;
const WANDER = 0.35;
const WIND_PULL = 0.25;
const CORE_SHARE = 0.55;
const FELLING_PER_SECOND = 2.4;
const BLOWING_OUT_PER_SECOND = 20;
const SWIRL_SPEED = 14;
const INWARD_SPEED = 4;
const FLUNG_SPEED = 26;
const PEOPLE_DAMAGE_PER_SECOND = 0.45;
const ANIMAL_DAMAGE_PER_SECOND = 0.9;
const BUILDING_DAMAGE_PER_SECOND = 60;
const SCARE_REACH = 4;
const DANGER_REACH = 2.5;

interface Twister {
  lifetime: number;
  radius: number;
  strength: number;
  x: number;
  z: number;
}

interface Tornado {
  age: number;
  readonly path: readonly number[];
  readonly radius: number;
  readonly strength: number;
}

export function tornadoDuration(path: readonly number[]): number {
  return (path.length / 2 - 1) * STEP_SECONDS;
}

export function tornadoPositionAt(path: readonly number[], age: number): Waypoint {
  const steps = path.length / 2 - 1;
  const progress = Math.min(age / STEP_SECONDS, steps);
  const step = Math.min(Math.floor(progress), steps - 1);
  const share = progress - step;

  return {
    x: lerp(path[step * 2], path[step * 2 + 2], share),
    z: lerp(path[step * 2 + 1], path[step * 2 + 3], share),
  };
}

function chartPath(twister: Twister, services: PowerServices): number[] {
  const { environment, random } = services;

  const steps = Math.max(1, Math.round(twister.lifetime / STEP_SECONDS));
  const wind = windHeading(services);
  const stride = (BASE_SPEED + environment.windSpeed * SPEED_PER_WIND) * STEP_SECONDS;

  const path = [twister.x, twister.z];

  let heading = wind;
  let position: Waypoint = { x: twister.x, z: twister.z };

  for (let step = 0; step < steps; step += 1) {
    heading = turnToward(heading + random.signed() * WANDER, wind, WIND_PULL);

    const next = { x: position.x + Math.sin(heading) * stride, z: position.z + Math.cos(heading) * stride };

    if (!isOnLand(next, services)) {
      break;
    }

    position = next;
    path.push(position.x, position.z);
  }

  if (path.length === 2) {
    path.push(position.x, position.z);
  }

  return path;
}

function windHeading(services: PowerServices): number {
  const { environment, random } = services;

  if (environment.windSpeed < CALM_WIND) {
    return random.next() * FULL_TURN;
  }

  return Math.atan2(environment.windX, environment.windZ);
}

function turnToward(heading: number, goal: number, share: number): number {
  const difference = Math.atan2(Math.sin(goal - heading), Math.cos(goal - heading));

  return heading + difference * share;
}

function isOnLand(point: Waypoint, services: PowerServices): boolean {
  const { world } = services;

  return world.isOnIsland(world.grid.cellAt(point.x, point.z));
}

function rage(tornado: Tornado, center: Waypoint, seconds: number, services: PowerServices): void {
  const { buildings, fauna, hazards, people } = services;

  const { radius, strength } = tornado;
  const core = radius * CORE_SHARE;
  const force = strength * seconds;

  uproot(center, core, force, services);
  blowOut(center, radius, force, services);

  for (const person of people.livingWithin(center.x, center.z, radius)) {
    whirl(person.mover, center, radius, force, services);
  }

  for (const animal of fauna.livingWithin(center.x, center.z, radius)) {
    whirl(animal.mover, center, radius, force, services);
  }

  people.damageArea(center.x, center.z, core, PEOPLE_DAMAGE_PER_SECOND * force, "tornado");
  fauna.damageArea(center.x, center.z, core, ANIMAL_DAMAGE_PER_SECOND * force, "tornado");
  fauna.scare(center.x, center.z, radius * SCARE_REACH);
  buildings.damageArea(center.x, center.z, radius, BUILDING_DAMAGE_PER_SECOND * force, false);
  hazards.addZone({ radius: radius * DANGER_REACH, remainingSeconds: seconds, x: center.x, z: center.z });
}

function uproot(center: Waypoint, core: number, force: number, services: PowerServices): void {
  const { environment, random, world } = services;
  const { vegetation } = world;

  for (const { cell, distance } of cellsInArea(world, { radius: core, x: center.x, z: center.z })) {
    if (!random.chance(FELLING_PER_SECOND * force * (1 - distance / core))) {
      continue;
    }

    for (const plant of vegetation.plantsInCell(cell).filter((index) => {
      return vegetation.isAlive(index);
    })) {
      if (isTreeSpecies(vegetation.species[plant])) {
        world.fellPlant(plant, environment.day, swirlAngle(plant, center, world));
      } else if (isShrubSpecies(vegetation.species[plant])) {
        world.removePlant(plant);
      }
    }

    world.markDisturbed(cell, environment.day);
  }
}

function blowOut(center: Waypoint, radius: number, force: number, services: PowerServices): void {
  const { buildings, fire, world } = services;

  for (const { cell, distance } of cellsInArea(world, { radius, x: center.x, z: center.z })) {
    fire.douse(cell, BLOWING_OUT_PER_SECOND * force * (1 - distance / radius));
  }

  buildings.blowOut(center.x, center.z, radius * CORE_SHARE);
}

function swirlAngle(plant: number, center: Waypoint, world: WorldState): number {
  const { vegetation } = world;

  const outward = Math.atan2(vegetation.x[plant] - center.x, vegetation.z[plant] - center.z);

  return outward + Math.PI / 2 + (hashToUnit(vegetation.seed[plant] * 41, plant) - 0.5) * 0.6;
}

function whirl(mover: Mover, center: Waypoint, radius: number, force: number, services: PowerServices): void {
  const offsetX = mover.x - center.x;
  const offsetZ = mover.z - center.z;
  const distance = Math.max(1, Math.hypot(offsetX, offsetZ));
  const grip = 1 - distance / radius;

  const outwardX = offsetX / distance;
  const outwardZ = offsetZ / distance;
  const swirl = SWIRL_SPEED * grip;
  const pull = grip > CORE_SHARE ? FLUNG_SPEED * grip : -INWARD_SPEED * grip;

  const x = mover.x + (-outwardZ * swirl + outwardX * pull) * force;
  const z = mover.z + (outwardX * swirl + outwardZ * pull) * force;

  if (services.world.isWalkableAt(x, z)) {
    mover.x = x;
    mover.z = z;
  }
}

export class TornadoSystem {
  readonly #tornadoes: Tornado[] = [];

  get isActive(): boolean {
    return this.#tornadoes.length > 0;
  }

  clear(): void {
    this.#tornadoes.length = 0;
  }

  touchDown(twister: Twister, services: PowerServices): void {
    const path = chartPath(twister, services);

    this.#tornadoes.push({ age: 0, path, radius: twister.radius, strength: twister.strength });
    services.effects.add({ kind: "tornado", path, radius: twister.radius });
  }

  update(seconds: number, services: PowerServices): void {
    let kept = 0;

    for (const tornado of this.#tornadoes) {
      tornado.age += seconds;

      if (tornado.age >= tornadoDuration(tornado.path)) {
        continue;
      }

      rage(tornado, tornadoPositionAt(tornado.path, tornado.age), seconds, services);
      this.#tornadoes[kept] = tornado;
      kept += 1;
    }

    this.#tornadoes.length = kept;
  }
}
