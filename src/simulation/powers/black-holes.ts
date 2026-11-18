import { Ground } from "../../content/grounds.ts";
import { isTreeSpecies } from "../../content/plants.ts";
import { lerp } from "../../shared/math.ts";
import { NO_PLANT } from "../../world/vegetation-store.ts";
import type { Mover } from "../agents/movement.ts";
import type { BlackHoleEffect, BlackHoleInflowEffect } from "../effects.ts";
import { cellsInArea, raiseTerrain } from "../world/terrain-editing.ts";
import { BlackHoleInflow } from "./black-hole-inflow.ts";
import type { PowerServices } from "./power-handler.ts";

export const BLACK_HOLE_CORE_SHARE = 0.25;

const BASIN_SHARE = 0.55;
const FELLING_FRINGE = 0.15;
const OPENING_SHARE = 0.2;
const COLLAPSE_DEPTH = 0.65;
const EROSION_STAGES = 4;
const EDGE_PULL_PER_SECOND = 0.22;
const CORE_PULL_PER_SECOND = 0.84;

export interface BlackHole {
  capturedPeople?: number;
  effect: BlackHoleEffect;
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

function clearedRadius(services: PowerServices, effect: BlackHoleEffect, stage: number): number {
  return Math.max(
    services.world.grid.cellSize * Math.SQRT1_2,
    effect.radius * lerp(OPENING_SHARE, BASIN_SHARE, stage / EROSION_STAGES)
  );
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
  const cleared = clearedRadius(services, effect, stage);
  const previous = previousStage < 0 ? -1 : clearedRadius(services, effect, previousStage);
  const reach = cleared + effect.radius * FELLING_FRINGE;

  for (const { cell, column, distance, row } of cellsInArea(world, { ...effect, radius: reach })) {
    if (!world.isOnIsland(cell)) {
      continue;
    }

    if (distance <= cleared) {
      if (distance > previous) {
        samples.ground(cell, world.grid.centerX(column), world.grid.centerZ(row));
      }

      consumeCell(services, samples, cell);

      continue;
    }

    for (const plant of vegetation.plantsInCell(cell)) {
      if (vegetation.isAlive(plant) && isTreeSpecies(vegetation.species[plant])) {
        world.fellPlant(
          plant,
          environment.day,
          Math.atan2(effect.x - vegetation.x[plant], effect.z - vegetation.z[plant])
        );
        world.markDisturbed(cell, environment.day);
      }
    }
  }

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
  const radius = Math.max(services.world.grid.cellSize, effect.radius * BASIN_SHARE);

  services.effects.add({ kind: "black-hole-collapse", wellId: hole.wellId });
  raiseTerrain(services.world, { radius, x, z }, -radius * COLLAPSE_DEPTH);

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
    const hole = { capturedPeople: 0, effect, remaining: effect.durationSeconds, wellId };

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

      if (stage > previousStage) {
        stripGround(hole, previousStage, stage, services);
      }

      if (hole.remaining <= 0) {
        collapse(hole, services);
        this.#holes.splice(index, 1);
      }
    }
  }
}
