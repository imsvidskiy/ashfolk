import { isRockSpecies, isShrubSpecies, isTreeSpecies, PlantSpecies } from "../../content/plants.ts";
import { clamp, FULL_TURN, hashToUnit, lerp, smoothstep } from "../../shared/math.ts";
import { carveCrater, cellsInArea } from "../world/terrain-editing.ts";
import type { WorldState } from "../world/world-state.ts";
import { ruinMonuments } from "./monument-shock.ts";
import type { PowerServices } from "./power-handler.ts";

const CRATER_CORE = 0.85;
const CRATER_DEPTH_SHARE = 0.3;
const DEEP_BLAST_POWER = 1.5;
const DEEP_CRATER_SCALE = 1.25;
const WATERY_CORE = 0.5;

const FELLING_REACH = 1.45;
const FELLING_FRINGE = 0.3;
const FALLING_SWAY = 0.5;
const FALL_SALT = 97;

const SHATTERING_REACH = 0.6;
const SHATTERING_HEIGHT = 1.4;
const SHARDS = 3;
const SHARD_SALT = 53;

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

type Blast = ({ catastrophe: "meteor" | "explosion" } | { catastrophe: "nuclear"; dropId: number }) & {
  hasBurningDebris: boolean;
  power: number;
  radius: number;
  x: number;
  z: number;
};

function reachScale(blast: Blast): number {
  return 0.85 + 0.15 * blast.power;
}

function craterDepth(blast: Blast): number {
  const deepening = blast.power > DEEP_BLAST_POWER ? DEEP_CRATER_SCALE : 1;

  return blast.radius * CRATER_DEPTH_SHARE * deepening;
}

function isMostlyWater(world: WorldState, blast: Blast): boolean {
  const core = cellsInArea(world, { ...blast, radius: blast.radius * CRATER_CORE });

  const wet = core.filter(({ cell }) => {
    return world.isWater(cell);
  }).length;

  return wet > core.length * WATERY_CORE;
}

function vaporize(services: PowerServices, cell: number): void {
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

function fallingAway(world: WorldState, plant: number, blast: Blast): number {
  const { vegetation } = world;

  const outwardX = vegetation.x[plant] - blast.x;
  const outwardZ = vegetation.z[plant] - blast.z;
  const sway = (hashToUnit(vegetation.seed[plant] * FALL_SALT, plant) - 0.5) * FALLING_SWAY;

  return Math.atan2(outwardX, outwardZ) + sway;
}

function shatter(services: PowerServices, plant: number, blast: Blast): void {
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

function flatten(services: PowerServices, cell: number, blast: Blast, remoteness: number): void {
  const { environment, world } = services;
  const { vegetation } = world;

  for (const plant of vegetation.plantsInCell(cell).filter((index) => {
    return vegetation.isAlive(index);
  })) {
    const species = vegetation.species[plant];

    if (isTreeSpecies(species)) {
      world.fellPlant(plant, environment.day, fallingAway(world, plant, blast));
    } else if (isShrubSpecies(species)) {
      world.removePlant(plant);
    } else if (isRockSpecies(species) && remoteness < SHATTERING_REACH) {
      shatter(services, plant, blast);
    }
  }

  world.fields.scorch[cell] = Math.max(world.fields.scorch[cell], lerp(0.85, 0.35, remoteness));
  world.fields.snow[cell] = 0;
  world.markDisturbed(cell, environment.day);
}

function igniteDebris(services: PowerServices, cell: number, remoteness: number): void {
  const { fire, random, world } = services;

  if (random.chance(lerp(NEAR_IGNITION, FAR_IGNITION, remoteness))) {
    fire.ignite(cell, lerp(0.8, 0.45, remoteness));
  }

  fire.addHeat(cell, 0.35 * (1 - remoteness));
  world.fields.snow[cell] *= 0.3;
}

function scatterDebris(services: PowerServices, blast: Blast, hasBurningDebris: boolean): void {
  const { random, world } = services;

  const scale = reachScale(blast);
  const felling = FELLING_REACH * scale;
  const ignition = IGNITION_REACH * scale;

  for (const { cell, distance } of cellsInArea(world, { ...blast, radius: blast.radius * ignition })) {
    const relativeDistance = distance / blast.radius;

    world.markSurfaceCell(cell);

    if (relativeDistance < CRATER_CORE) {
      vaporize(services, cell);

      continue;
    }

    const flattening = 1 - smoothstep(felling - FELLING_FRINGE, felling, relativeDistance);

    if (random.chance(flattening)) {
      flatten(services, cell, blast, (relativeDistance - CRATER_CORE) / (felling - CRATER_CORE));
    }

    if (hasBurningDebris) {
      igniteDebris(services, cell, smoothstep(felling, ignition, relativeDistance));
    }
  }
}

function hurlBurningDebris(services: PowerServices, blast: Blast): void {
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

export function explode(blast: Blast, services: PowerServices): void {
  const { buildings, fauna, hazards, people, world } = services;

  const reach = blast.radius * BLAST_REACH;
  const surfaceY = world.surfaceAt(blast.x, blast.z);

  const isInWater = isMostlyWater(world, blast);
  const hasBurningDebris = blast.hasBurningDebris && !isInWater;

  carveCrater(world, blast, craterDepth(blast));
  scatterDebris(services, blast, hasBurningDebris);

  if (hasBurningDebris) {
    hurlBurningDebris(services, blast);
  }

  ruinMonuments(services, {
    catastrophe: blast.catastrophe,
    reach: blast.radius * MONUMENT_REACH * reachScale(blast),
    strength: 1 + 0.1 * blast.power,
    x: blast.x,
    z: blast.z,
  });
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

  if (blast.catastrophe === "nuclear") {
    services.effects.add({
      dropId: blast.dropId,
      isInWater,
      kind: "nuclear-cloud",
      radius: blast.radius,
      surfaceY,
      x: blast.x,
      z: blast.z,
    });

    return;
  }

  services.effects.add({
    isInWater,
    kind: "explosion",
    power: blast.power,
    radius: blast.radius,
    surfaceY,
    x: blast.x,
    z: blast.z,
  });
}
