import { Ground } from "../../content/grounds.ts";
import { isTreeSpecies } from "../../content/plants.ts";
import { lerp } from "../../shared/math.ts";
import { NO_PLANT } from "../../world/vegetation-store.ts";
import type { Mover } from "../agents/movement.ts";
import { BLACK_HOLE_CORE_SHARE, type BlackHoleEffect, type BlackHoleInflowEffect } from "../effects.ts";
import { shiftBlackHoleTerrain, visitBlackHoleFaults } from "./black-hole-faults.ts";
import { BlackHoleInflow } from "./black-hole-inflow.ts";
import type { PowerServices } from "./power-handler.ts";

const FELLING_FRINGE = 0.16;
const OPENING_SHARE = 0.32;
const FRACTURE_LEAD_SECONDS = 0.55;
const EROSION_STAGES = 4;

const EDGE_PULL_PER_SECOND = 0.48;
const CORE_PULL_PER_SECOND = 1.15;

export interface BlackHole {
  capturedPeople?: number;
  effect: BlackHoleEffect;
  hasFractured?: boolean;
  inflow?: BlackHoleInflowEffect;
  remaining: number;
  wellId?: number;
}

type ActiveHole = BlackHole & { wellId: number };

function pull(mover: Mover, hole: BlackHoleEffect, seconds: number): boolean {
  const deltaX = hole.x - mover.x;
  const deltaZ = hole.z - mover.z;
  const distance = Math.hypot(deltaX, deltaZ);
  const speed = hole.radius * lerp(CORE_PULL_PER_SECOND, EDGE_PULL_PER_SECOND, distance / hole.radius);
  const travel = Math.min(distance, speed * seconds);
  const share = travel / Math.max(0.001, distance);

  mover.hop = null;
  mover.x += deltaX * share;
  mover.z += deltaZ * share;

  return distance - travel <= hole.radius * BLACK_HOLE_CORE_SHARE;
}

function attract(hole: BlackHoleEffect, seconds: number, services: PowerServices): number {
  const { fauna, people } = services;
  const { radius, x, z } = hole;
  let captured = 0;

  for (const person of people.livingWithin(x, z, radius)) {
    if (pull(person.mover, hole, seconds)) {
      people.kill(person, "gravity", "collective");
      captured += 1;
    }
  }

  for (const animal of fauna.livingWithin(x, z, radius)) {
    if (pull(animal.mover, hole, seconds)) {
      fauna.kill(animal, "gravity");
    }
  }

  return captured;
}

function consumeCell(services: PowerServices, samples: BlackHoleInflow, cell: number): void {
  const { buildings, environment, fire, world } = services;
  const { vegetation } = world;
  const building = buildings.find(world.occupancy[cell]);

  if (building !== null) {
    samples.building(building);
    buildings.remove(building, "swallowed");
  }

  for (let plant = vegetation.firstPlantInCell(cell); plant !== NO_PLANT; plant = vegetation.nextPlantInCell(plant)) {
    samples.plant(plant);
  }

  world.clearPlants(cell, true);
  fire.douse(cell, 1);

  if (!(world.isWater(cell) || world.isPool(cell))) {
    world.setGround(cell, Ground.Rock);
  }

  world.fields.fuel[cell] = 0;
  world.fields.snow[cell] = 0;
  world.markSurfaceCell(cell);
  world.markDisturbed(cell, environment.day);
}

function stripGround(hole: ActiveHole, previousStage: number, stage: number, services: PowerServices): void {
  const { environment, world } = services;
  const { vegetation } = world;
  const { effect } = hole;
  const samples = new BlackHoleInflow(world);
  const progress = lerp(OPENING_SHARE, 1, stage / EROSION_STAGES);
  const lastProgress = lerp(OPENING_SHARE, 1, previousStage / EROSION_STAGES);
  const minimum = world.grid.cellSize * Math.SQRT1_2;

  const reach = Math.max(minimum, effect.radius * Math.min(1, progress + FELLING_FRINGE));

  visitBlackHoleFaults(world, effect, reach, (cell, x, z, distance, frontRadius) => {
    const cleared = Math.max(minimum, frontRadius * progress);

    if (distance <= cleared) {
      if (previousStage < 0 || distance > Math.max(minimum, frontRadius * lastProgress)) {
        samples.ground(cell, x, z);
      } else if (
        world.occupancy[cell] < 0 &&
        !vegetation.hasPlantsInCell(cell) &&
        !world.isBurning(cell) &&
        world.fields.fuel[cell] === 0 &&
        world.fields.snow[cell] === 0 &&
        (world.terrain.ground[cell] === Ground.Rock || world.isWater(cell) || world.isPool(cell))
      ) {
        return;
      }

      consumeCell(services, samples, cell);

      return;
    }

    if (distance > cleared + effect.radius * FELLING_FRINGE) {
      return;
    }

    for (let plant = vegetation.firstPlantInCell(cell); plant !== NO_PLANT; plant = vegetation.nextPlantInCell(plant)) {
      if (vegetation.isAlive(plant) && isTreeSpecies(vegetation.species[plant])) {
        world.fellPlant(
          plant,
          environment.day,
          Math.atan2(effect.x - vegetation.x[plant], effect.z - vegetation.z[plant])
        );
        world.markDisturbed(cell, environment.day);
      }
    }
  });

  const interval = effect.durationSeconds / (EROSION_STAGES + 1);
  const inflow = samples.effect(
    effect,
    hole.wellId,
    effect.durationSeconds - hole.remaining,
    Math.min(hole.remaining, interval)
  );

  if (inflow !== null) {
    hole.inflow = inflow;
    services.effects.add(inflow);
  }
}

function erosionStage(remaining: number, duration: number): number {
  return Math.min(EROSION_STAGES, Math.floor((1 - Math.max(0, remaining) / duration) * (EROSION_STAGES + 1)));
}

function collapse(hole: ActiveHole, services: PowerServices): void {
  const { effect, capturedPeople = 0 } = hole;
  const { x, z } = effect;

  services.effects.add({ kind: "black-hole-collapse", wellId: hole.wellId });
  shiftBlackHoleTerrain(services.world, effect, "collapse");

  const losses = capturedPeople === 1 ? "1 person" : `${capturedPeople} people`;
  const text =
    capturedPeople > 0
      ? `The black hole swallowed ${losses} and left a hollow in the island`
      : "The black hole collapsed, leaving a hollow in the island";

  services.chronicle.record({ category: "warning", text, tribeId: null, x, z });
}

export class BlackHoleSystem {
  readonly #holes: ActiveHole[] = [];

  get isActive(): boolean {
    return this.#holes.length > 0;
  }

  snapshot(): BlackHole[] {
    return structuredClone(this.#holes);
  }

  restore(holes: readonly BlackHole[], { effects, identifiers }: PowerServices): void {
    this.#holes.length = 0;

    for (const { wellId = 0 } of holes) {
      if (wellId >= identifiers.upcoming) {
        identifiers.restore(wellId + 1);
      }
    }

    for (const hole of holes) {
      const { wellId = identifiers.next() } = hole;

      const elapsedSeconds = hole.effect.durationSeconds - hole.remaining;

      this.#holes.push({ ...structuredClone(hole), wellId });
      effects.add({ ...hole.effect, elapsedSeconds, wellId });

      if (hole.inflow !== undefined) {
        const age = elapsedSeconds - hole.inflow.startedAt;

        if (age < hole.inflow.durationSeconds) {
          effects.add({ ...hole.inflow, elapsedSeconds: age, wellId });
        }
      }
    }
  }

  open(effect: BlackHoleEffect, services: PowerServices): void {
    const wellId = services.identifiers.next();
    const hole = { capturedPeople: 0, effect, hasFractured: false, remaining: effect.durationSeconds, wellId };

    this.#holes.push(hole);
    services.effects.add({ ...effect, wellId });
    stripGround(hole, -1, 0, services);
  }

  update(seconds: number, services: PowerServices): void {
    for (let index = this.#holes.length - 1; index >= 0; index -= 1) {
      const hole = this.#holes[index];
      const { capturedPeople = 0, effect, remaining } = hole;
      const previousStage = erosionStage(remaining, effect.durationSeconds);

      hole.capturedPeople = capturedPeople + attract(effect, Math.min(seconds, remaining), services);
      hole.remaining -= seconds;

      const stage = erosionStage(hole.remaining, effect.durationSeconds);

      if (hole.hasFractured === undefined) {
        // Older saves cleared a smaller circle. Catch up its fault front when the game clock resumes.
        stripGround(hole, -1, stage, services);
        hole.hasFractured = false;
      } else if (stage > previousStage) {
        stripGround(hole, previousStage, stage, services);
      }

      if (!hole.hasFractured && hole.remaining <= FRACTURE_LEAD_SECONDS) {
        shiftBlackHoleTerrain(services.world, effect, "fracture");
        hole.hasFractured = true;
      }

      if (hole.remaining <= 0) {
        collapse(hole, services);
        this.#holes.splice(index, 1);
      }
    }
  }
}
