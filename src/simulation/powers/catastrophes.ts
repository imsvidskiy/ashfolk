import { isRockSpecies, isShrubSpecies, isTreeSpecies, PlantSpecies } from "../../content/plants.ts";
import { clamp, FULL_TURN, hashToUnit, lerp, smoothstep } from "../../shared/math.ts";
import { isDryLand, type Waypoint } from "../agents/navigation.ts";
import { setAlight } from "../society/buildings.ts";
import { discover } from "../society/progress.ts";
import { type Catastrophe, ruinText, type Shock, shakeMonuments } from "../world/monument-damage.ts";
import { carveCrater, cellsInArea, shakeTerrain } from "../world/terrain-editing.ts";
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
const CRATER_CORE = 0.85;
const CRATER_DEPTH_SHARE = 0.3;
const DEEP_BLAST_POWER = 1.5;
const DEEP_CRATER_SCALE = 1.25;
const WATERY_CORE = 0.5;
const FELLING_REACH = 1.45;
const FELLING_FRINGE = 0.3;
const FALLING_SWAY = 0.5;
const SHATTERING_REACH = 0.6;
const SHATTERING_HEIGHT = 1.4;
const SHARDS = 3;
const IGNITION_REACH = 2;
const NEAR_IGNITION = 0.9;
const FAR_IGNITION = 0.12;
const DEBRIS_REACH = 3.2;
const DEBRIS_PER_METER = 0.35;
const FEWEST_DEBRIS = 6;
const MOST_DEBRIS = 120;
const BLAST_REACH = 1.8;
const MONUMENT_REACH = 3.2;
const BLAST_BUILDING_DAMAGE = 120;
const BLAST_PEOPLE_DAMAGE = 1.6;
const BLAST_ANIMAL_DAMAGE = 3;
const BLAST_SCARE_REACH = 8;
const BLAST_DANGER_REACH = 4;
const BLAST_DANGER_SECONDS = 6;
const QUAKE_TOPPLING = 0.08;
const QUAKE_MONUMENT_STRENGTH = 0.6;
const QUAKE_BUILDING_DAMAGE = 45;
const QUAKE_PEOPLE_REACH = 0.6;
const QUAKE_PEOPLE_DAMAGE = 0.35;
const QUAKE_SCARE_REACH = 1.5;
const QUAKE_DANGER_SECONDS = 5;
const FALL_SALT = 97;
const SHARD_SALT = 53;
const TOPPLE_SALT = 31;

interface Strike {
  ignitionChance: number;
  isNatural: boolean;
  x: number;
  z: number;
}

interface Blast {
  catastrophe: Catastrophe;
  hasBurningDebris: boolean;
  power: number;
  radius: number;
  x: number;
  z: number;
}

interface Quake {
  magnitude: number;
  radius: number;
  x: number;
  z: number;
}

export function strikeLightning(strike: Strike, services: PowerServices): void {
  const { buildings, fauna, fire, people, world } = services;

  services.effects.add({ isNatural: strike.isNatural, kind: "lightning", x: strike.x, z: strike.z });

  for (const { cell } of cellsInArea(world, { radius: STRIKE_RADIUS, x: strike.x, z: strike.z })) {
    if (catchesFire(cell, strike, services)) {
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

  teachFire(strike, services);
}

function catchesFire(cell: number, strike: Strike, services: PowerServices): boolean {
  if (isRainedOn(cell, strike, services)) {
    return false;
  }

  return services.random.chance(strike.ignitionChance);
}

function isRainedOn(cell: number, strike: Strike, services: PowerServices): boolean {
  if (!strike.isNatural || services.world.fields.wetness[cell] <= SOAKED) {
    return false;
  }

  return services.random.chance(services.environment.precipitation);
}

function teachFire(strike: Strike, services: PowerServices): void {
  const tribe = services.people.nearestTribe(strike.x, strike.z, TEACHING_DISTANCE);

  if (tribe === null) {
    return;
  }

  discover(tribe, "fire", `${tribe.name} saw lightning strike and kept the flame`, services);
}

export function naturalStrikeSite(focus: Waypoint, services: PowerServices): Waypoint | null {
  const { random, world } = services;

  const limit = world.grid.halfSize - ISLAND_MARGIN;

  for (let attempt = 0; attempt < NATURAL_STRIKE_ATTEMPTS; attempt += 1) {
    const angle = random.next() * FULL_TURN;
    const distance = random.between(NEAREST_NATURAL_STRIKE, FARTHEST_NATURAL_STRIKE);

    const x = clamp(focus.x + Math.cos(angle) * distance, -limit, limit);
    const z = clamp(focus.z + Math.sin(angle) * distance, -limit, limit);

    if (isStrikeSite(world.grid.cellAt(x, z), attempt >= ANY_LAND_STRIKE_ATTEMPT, services)) {
      return { x, z };
    }
  }

  return null;
}

function isStrikeSite(cell: number, shouldAcceptAnyLand: boolean, services: PowerServices): boolean {
  const { world } = services;

  if (!isDryLand(world, cell)) {
    return false;
  }

  return shouldAcceptAnyLand || world.terrain.height[cell] > HIGH_GROUND || world.canopyFuel[cell] > TALL_FOREST;
}

function reachScale(blast: Blast): number {
  return 0.85 + 0.15 * blast.power;
}

function craterDepth(blast: Blast): number {
  const deepening = blast.power > DEEP_BLAST_POWER ? DEEP_CRATER_SCALE : 1;

  return blast.radius * CRATER_DEPTH_SHARE * deepening;
}

export function explode(blast: Blast, services: PowerServices): void {
  const { buildings, fauna, hazards, people, world } = services;

  const reach = blast.radius * BLAST_REACH;

  const isInWater = isMostlyWater(blast, services);
  const hasBurningDebris = blast.hasBurningDebris && !isInWater;

  carveCrater(world, blast, craterDepth(blast));
  scatterDebris(blast, hasBurningDebris, services);

  if (hasBurningDebris) {
    hurlBurningDebris(blast, services);
  }

  ruinMonuments(
    {
      catastrophe: blast.catastrophe,
      reach: blast.radius * MONUMENT_REACH * reachScale(blast),
      strength: 1 + 0.1 * blast.power,
      x: blast.x,
      z: blast.z,
    },
    services
  );
  buildings.damageArea(blast.x, blast.z, reach, BLAST_BUILDING_DAMAGE * blast.power, hasBurningDebris);
  people.damageArea(blast.x, blast.z, reach, BLAST_PEOPLE_DAMAGE * blast.power, "blast");
  fauna.damageArea(blast.x, blast.z, reach, BLAST_ANIMAL_DAMAGE * blast.power, "blast");
  fauna.scare(blast.x, blast.z, blast.radius * BLAST_SCARE_REACH);
  hazards.addZone({
    radius: blast.radius * BLAST_DANGER_REACH,
    remainingSeconds: BLAST_DANGER_SECONDS,
    x: blast.x,
    z: blast.z,
  });
  services.effects.add({
    isInWater,
    kind: "explosion",
    power: blast.power,
    radius: blast.radius,
    x: blast.x,
    z: blast.z,
  });
}

function isMostlyWater(blast: Blast, services: PowerServices): boolean {
  const { world } = services;

  const core = cellsInArea(world, { ...blast, radius: blast.radius * CRATER_CORE });

  const wet = core.filter(({ cell }) => {
    return world.isWater(cell);
  }).length;

  return wet > core.length * WATERY_CORE;
}

function scatterDebris(blast: Blast, hasBurningDebris: boolean, services: PowerServices): void {
  const { random, world } = services;

  const scale = reachScale(blast);
  const felling = FELLING_REACH * scale;
  const ignition = IGNITION_REACH * scale;

  for (const { cell, distance } of cellsInArea(world, { ...blast, radius: blast.radius * ignition })) {
    const relativeDistance = distance / blast.radius;

    world.markSurfaceCell(cell);

    if (relativeDistance < CRATER_CORE) {
      vaporize(cell, services);

      continue;
    }

    const flattening = 1 - smoothstep(felling - FELLING_FRINGE, felling, relativeDistance);

    if (random.chance(flattening)) {
      flatten(cell, blast, (relativeDistance - CRATER_CORE) / (felling - CRATER_CORE), services);
    }

    if (hasBurningDebris) {
      igniteDebris(cell, smoothstep(felling, ignition, relativeDistance), services);
    }
  }
}

function igniteDebris(cell: number, remoteness: number, services: PowerServices): void {
  const { fire, random, world } = services;

  if (random.chance(lerp(NEAR_IGNITION, FAR_IGNITION, remoteness))) {
    fire.ignite(cell, lerp(0.8, 0.45, remoteness));
  }

  fire.addHeat(cell, 0.35 * (1 - remoteness));
  world.fields.snow[cell] *= 0.3;
}

function flatten(cell: number, blast: Blast, remoteness: number, services: PowerServices): void {
  const { environment, world } = services;
  const { vegetation } = world;

  for (const plant of vegetation.plantsInCell(cell).filter((index) => {
    return vegetation.isAlive(index);
  })) {
    const species = vegetation.species[plant];

    if (isTreeSpecies(species)) {
      world.fellPlant(plant, environment.day, fallingAway(plant, blast, world));
    } else if (isShrubSpecies(species)) {
      world.removePlant(plant);
    } else if (isRockSpecies(species) && remoteness < SHATTERING_REACH) {
      shatter(plant, blast, services);
    }
  }

  world.fields.scorch[cell] = Math.max(world.fields.scorch[cell], lerp(0.85, 0.35, remoteness));
  world.fields.snow[cell] = 0;
  world.markDisturbed(cell, environment.day);
}

function fallingAway(plant: number, blast: Blast, world: WorldState): number {
  const { vegetation } = world;

  const outwardX = vegetation.x[plant] - blast.x;
  const outwardZ = vegetation.z[plant] - blast.z;
  const sway = (hashToUnit(vegetation.seed[plant] * FALL_SALT, plant) - 0.5) * FALLING_SWAY;

  return Math.atan2(outwardX, outwardZ) + sway;
}

function shatter(plant: number, blast: Blast, services: PowerServices): void {
  const { environment, world } = services;
  const { vegetation } = world;

  const height = vegetation.height[plant];

  if (height < SHATTERING_HEIGHT) {
    return;
  }

  const shardSeed = vegetation.seed[plant] * SHARD_SALT;
  const x = vegetation.x[plant];
  const z = vegetation.z[plant];
  const away = Math.atan2(z - blast.z, x - blast.x);

  world.removePlant(plant);

  for (let shard = 0; shard < SHARDS; shard += 1) {
    const angle = away + (hashToUnit(shardSeed, shard, 1) - 0.5) * 1.8;
    const throwDistance = 1.5 + hashToUnit(shardSeed, shard, 2) * height * 1.5;

    const shardX = x + Math.cos(angle) * throwDistance;
    const shardZ = z + Math.sin(angle) * throwDistance;

    if (!world.canPlace(world.grid.cellAt(shardX, shardZ), Number.POSITIVE_INFINITY)) {
      continue;
    }

    world.plant({
      bornDay: environment.day,
      height: height * lerp(0.22, 0.42, hashToUnit(shardSeed, shard, 3)),
      rotation: hashToUnit(shardSeed, shard, 4) * FULL_TURN,
      seed: hashToUnit(shardSeed, shard, 5),
      species: PlantSpecies.Boulder,
      x: shardX,
      z: shardZ,
    });
  }
}

function hurlBurningDebris(blast: Blast, services: PowerServices): void {
  const { embers, random } = services;

  const scale = reachScale(blast);
  const count = Math.round(clamp(blast.radius * blast.power * DEBRIS_PER_METER, FEWEST_DEBRIS, MOST_DEBRIS));

  for (let piece = 0; piece < count; piece += 1) {
    const angle = random.next() * FULL_TURN;
    const distance = blast.radius * random.between(FELLING_REACH * scale, DEBRIS_REACH * scale);
    const durationSeconds = random.between(1.2, 3.2);

    embers.hurl({
      durationSeconds,
      fromX: blast.x,
      fromZ: blast.z,
      toX: blast.x + Math.cos(angle) * distance,
      toZ: blast.z + Math.sin(angle) * distance,
    });
  }
}

function ruinMonuments(shock: Shock, services: PowerServices): void {
  const { chronicle, environment, world } = services;

  for (const harm of shakeMonuments(world, shock, environment.day)) {
    chronicle.record({
      category: "warning",
      text: ruinText(shock.catastrophe, harm),
      tribeId: null,
      x: harm.monument.x,
      z: harm.monument.z,
    });
  }
}

function vaporize(cell: number, services: PowerServices): void {
  const { environment, world } = services;
  const { fields } = world;

  fields.fire[cell] = 0;
  fields.heat[cell] = 0;
  fields.fuel[cell] = 0;
  fields.scorch[cell] = 1;
  fields.wetness[cell] = 0;
  fields.snow[cell] = 0;
  world.clearPlants(cell, true);
  world.markDisturbed(cell, environment.day);
}

export function shakeLand(quake: Quake, services: PowerServices): void {
  const { buildings, fauna, hazards, random, people, world } = services;

  shakeTerrain(world, quake, quake.magnitude, random);

  for (const { cell, distance } of cellsInArea(world, quake)) {
    if (random.chance(QUAKE_TOPPLING * (1 - distance / quake.radius) * quake.magnitude)) {
      toppleTrees(cell, services);
    }
  }

  ruinMonuments(
    {
      catastrophe: "earthquake",
      reach: quake.radius,
      strength: QUAKE_MONUMENT_STRENGTH * quake.magnitude,
      x: quake.x,
      z: quake.z,
    },
    services
  );
  buildings.damageArea(quake.x, quake.z, quake.radius, QUAKE_BUILDING_DAMAGE * quake.magnitude, false);
  people.damageArea(
    quake.x,
    quake.z,
    quake.radius * QUAKE_PEOPLE_REACH,
    QUAKE_PEOPLE_DAMAGE * quake.magnitude,
    "earthquake"
  );
  fauna.scare(quake.x, quake.z, quake.radius * QUAKE_SCARE_REACH);
  hazards.addZone({ radius: quake.radius, remainingSeconds: QUAKE_DANGER_SECONDS, x: quake.x, z: quake.z });
  services.effects.add({
    kind: "earthquake",
    magnitude: quake.magnitude,
    radius: quake.radius,
    x: quake.x,
    z: quake.z,
  });
}

function toppleTrees(cell: number, services: PowerServices): void {
  const { environment, world } = services;
  const { vegetation } = world;

  for (const tree of vegetation.plantsInCell(cell).filter((plant) => {
    return vegetation.isAlive(plant) && isTreeSpecies(vegetation.species[plant]);
  })) {
    world.fellPlant(tree, environment.day, hashToUnit(vegetation.seed[tree] * TOPPLE_SALT, cell) * FULL_TURN);
    world.markDisturbed(cell, environment.day);
  }
}
