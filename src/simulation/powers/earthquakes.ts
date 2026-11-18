import { isTreeSpecies } from "../../content/plants.ts";
import { FULL_TURN, hashToUnit } from "../../shared/math.ts";
import { cellsInArea, shakeTerrain } from "../world/terrain-editing.ts";
import { ruinMonuments } from "./monument-shock.ts";
import type { PowerServices } from "./power-handler.ts";

const QUAKE_TOPPLING = 0.08;
const TOPPLE_SALT = 31;

const QUAKE_MONUMENT_STRENGTH = 0.6;
const QUAKE_BUILDING_DAMAGE = 45;
const QUAKE_PEOPLE_REACH = 0.6;
const QUAKE_PEOPLE_DAMAGE = 0.35;
const QUAKE_SCARE_REACH = 1.5;
const QUAKE_DANGER_SECONDS = 5;

interface Quake {
  magnitude: number;
  radius: number;
  x: number;
  z: number;
}

function toppleTrees(services: PowerServices, cell: number): void {
  const { environment, world } = services;
  const { vegetation } = world;

  for (const tree of vegetation.plantsInCell(cell).filter((plant) => {
    return vegetation.isAlive(plant) && isTreeSpecies(vegetation.species[plant]);
  })) {
    world.fellPlant(tree, environment.day, hashToUnit(vegetation.seed[tree] * TOPPLE_SALT, cell) * FULL_TURN);
    world.markDisturbed(cell, environment.day);
  }
}

export function shakeLand(quake: Quake, services: PowerServices): void {
  const { buildings, fauna, hazards, random, people, world } = services;

  shakeTerrain(world, quake, quake.magnitude, random);

  for (const { cell, distance } of cellsInArea(world, quake)) {
    if (random.chance(QUAKE_TOPPLING * (1 - distance / quake.radius) * quake.magnitude)) {
      toppleTrees(services, cell);
    }
  }

  ruinMonuments(services, {
    catastrophe: "earthquake",
    reach: quake.radius,
    strength: QUAKE_MONUMENT_STRENGTH * quake.magnitude,
    x: quake.x,
    z: quake.z,
  });
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
