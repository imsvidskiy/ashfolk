import { Ground } from "../../content/grounds.ts";
import { isShrubSpecies, isTreeSpecies } from "../../content/plants.ts";
import { FULL_TURN, hashToUnit, lerp, smoothstep } from "../../shared/math.ts";
import { NEIGHBOR_OFFSETS } from "../../world/world-grid.ts";
import { isDryLand } from "../agents/navigation.ts";
import { cellsInArea, swellCone } from "../world/terrain-editing.ts";
import type { PowerServices } from "./power-handler.ts";

export const SWELL_SECONDS = 6;
export const COOLING_SECONDS = 40;

const PEAK_SHARE = 0.55;
const CRATER_SHARE = 0.2;
const CRATER_LAVA_SHARE = 0.85;
const RIM_SHARE = 1.15;
const SHORTEST_ERUPTION_SECONDS = 20;
const ERUPTION_SECONDS_PER_STRENGTH = 50;
const FEWEST_TONGUES = 2;
const MOST_TONGUES = 6;
const TONGUE_JITTER = 0.35;
const SHORTEST_TONGUE_REACH = 1.4;
const LONGEST_TONGUE_REACH = 3.4;
const TONGUE_SHARE_OF_ERUPTION = 0.75;
const WIDENING_CHANCE = 0.6;
const POOLING_RISE = 1.5;
const LAVA_HEAT = 0.8;
const LAVA_DAMAGE = 6;
const BUILDING_DAMAGE = 400;
const HOT_LAVA = 0.3;
const ASH_REACH = 1.45;
const ASH_SCORCH = 0.85;
const TOPPLING_PER_SECOND = 0.12;
const SWELL_BUILDING_DAMAGE_PER_SECOND = 25;
const BOMBS_PER_SECOND = 1.6;
const NEAREST_BOMB = 0.5;
const FARTHEST_BOMB = 2.2;
const SCARE_REACH = 3;
const CRATER_DANGER = 1.2;
const HEAD_DANGER_CELLS = 4;
const TONGUE_DANGER_SPACING = 2;
const COOLING_SPREAD = 0.6;
const NO_CELL = -1;
const SPLIT_SALT = 71;
const COOLING_SALT = 29;
const ASH_SALT = 53;

interface Eruption {
  radius: number;
  strength: number;
  x: number;
  z: number;
}

interface LavaTongue {
  cells: number[];
  isStopped: boolean;
  progress: number;
  quenchedCell: number;
}

export interface Volcano {
  age: number;
  bombBudget: number;
  readonly eruptionSeconds: number;
  readonly lava: Map<number, number>;
  readonly radius: number;
  readonly strength: number;
  tongues: LavaTongue[];
  readonly x: number;
  readonly z: number;
}

export interface VolcanoView {
  activity: number;
  craterRadius: number;
  radius: number;
  steam: number[];
  x: number;
  z: number;
}

function headOf(tongue: LavaTongue): number {
  const head = tongue.cells.at(-1);

  return head === undefined ? NO_CELL : head;
}

function peakHeight(volcano: Volcano): number {
  return volcano.radius * PEAK_SHARE;
}

function craterRadius(volcano: Volcano): number {
  return volcano.radius * CRATER_SHARE;
}

function isErupting(volcano: Volcano): boolean {
  return volcano.age >= SWELL_SECONDS && volcano.age < SWELL_SECONDS + volcano.eruptionSeconds;
}

function isSpent(volcano: Volcano): boolean {
  return volcano.age >= SWELL_SECONDS + volcano.eruptionSeconds && volcano.lava.size === 0;
}

function activityOf(volcano: Volcano): number {
  if (volcano.age < SWELL_SECONDS) {
    return (volcano.age / SWELL_SECONDS) * 0.3;
  }

  const coolingAge = volcano.age - SWELL_SECONDS - volcano.eruptionSeconds;

  return 1 - smoothstep(0, COOLING_SECONDS, coolingAge);
}

function swell(volcano: Volcano, from: number, to: number, services: PowerServices): void {
  const { buildings, world } = services;

  const lift = peakHeight(volcano) * (smoothstep(0, SWELL_SECONDS, to) - smoothstep(0, SWELL_SECONDS, from));
  const seconds = to - from;

  swellCone(world, { craterShare: CRATER_SHARE, radius: volcano.radius, x: volcano.x, z: volcano.z }, lift);
  toppleTrees(volcano, seconds, services);
  buildings.damageArea(volcano.x, volcano.z, volcano.radius, SWELL_BUILDING_DAMAGE_PER_SECOND * seconds, false);
}

function toppleTrees(volcano: Volcano, seconds: number, services: PowerServices): void {
  const { environment, random, world } = services;
  const { vegetation } = world;

  for (const { cell, distance } of cellsInArea(world, volcano)) {
    if (!vegetation.hasPlantsInCell(cell)) {
      continue;
    }

    if (!random.chance(TOPPLING_PER_SECOND * seconds * (1 - distance / volcano.radius))) {
      continue;
    }

    for (const plant of vegetation.plantsInCell(cell).filter((index) => {
      return vegetation.isAlive(index) && isTreeSpecies(vegetation.species[index]);
    })) {
      const outward = Math.atan2(vegetation.x[plant] - volcano.x, vegetation.z[plant] - volcano.z);

      world.fellPlant(plant, environment.day, outward);
    }

    world.markDisturbed(cell, environment.day);
  }
}

function beginEruption(volcano: Volcano, services: PowerServices): void {
  const { chronicle, world } = services;

  for (const { cell } of cellsInArea(world, { ...volcano, radius: craterRadius(volcano) * CRATER_LAVA_SHARE })) {
    if (isDryLand(world, cell)) {
      cover(volcano, cell, services);
    }
  }

  fallAsh(volcano, services);
  volcano.tongues = planTongues(volcano, services);

  for (const tongue of volcano.tongues) {
    const [start] = tongue.cells;

    if (start !== undefined) {
      cover(volcano, start, services);
    }
  }

  chronicle.record({ category: "warning", text: "A volcano erupted", tribeId: null, x: volcano.x, z: volcano.z });
}

function fallAsh(volcano: Volcano, services: PowerServices): void {
  const { environment, world } = services;
  const { fields, vegetation } = world;

  const reach = volcano.radius * ASH_REACH;

  for (const { cell, column, distance, row } of cellsInArea(world, { ...volcano, radius: reach })) {
    const depth = 1 - smoothstep(volcano.radius * 0.8, reach, distance);

    if (!isDryLand(world, cell) || volcano.lava.has(cell) || hashToUnit(column, row, ASH_SALT) >= depth) {
      continue;
    }

    for (const plant of vegetation.plantsInCell(cell)) {
      if (vegetation.isAlive(plant) && isShrubSpecies(vegetation.species[plant])) {
        world.removePlant(plant);
      }
    }

    world.setGround(cell, Ground.Ash);
    fields.fuel[cell] = 0;
    fields.scorch[cell] = Math.max(fields.scorch[cell], ASH_SCORCH * depth);
    fields.snow[cell] = 0;
    world.markSurfaceCell(cell);
    world.markDisturbed(cell, environment.day);
  }
}

function tongueReach(volcano: Volcano, services: PowerServices): number {
  const reach = volcano.radius * lerp(SHORTEST_TONGUE_REACH, LONGEST_TONGUE_REACH, volcano.strength);

  return Math.round(reach / services.world.grid.cellSize);
}

function planTongues(volcano: Volcano, services: PowerServices): LavaTongue[] {
  const { random, world } = services;
  const { grid } = world;

  const count = Math.round(lerp(FEWEST_TONGUES, MOST_TONGUES, volcano.strength));
  const firstAngle = random.next() * FULL_TURN;
  const rim = craterRadius(volcano) * RIM_SHARE;

  const tongues: LavaTongue[] = [];

  for (let tongue = 0; tongue < count; tongue += 1) {
    const angle = firstAngle + (tongue / count) * FULL_TURN + random.signed() * TONGUE_JITTER;
    const start = grid.cellAt(volcano.x + Math.cos(angle) * rim, volcano.z + Math.sin(angle) * rim);

    if (!isDryLand(world, start)) {
      continue;
    }

    tongues.push({ cells: [start], isStopped: false, progress: 0, quenchedCell: NO_CELL });
  }

  return tongues;
}

function nextLavaCell(services: PowerServices, lava: ReadonlyMap<number, number>, cell: number): number {
  const { grid, terrain } = services.world;

  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);

  let best = NO_CELL;
  let bestSlope = Number.POSITIVE_INFINITY;

  for (const offset of NEIGHBOR_OFFSETS) {
    if (!grid.contains(column + offset.column, row + offset.row)) {
      continue;
    }

    const neighbor = grid.index(column + offset.column, row + offset.row);

    if (lava.has(neighbor)) {
      continue;
    }

    const slope = (terrain.height[neighbor] - terrain.height[cell]) / offset.distance;

    if (slope < bestSlope) {
      best = neighbor;
      bestSlope = slope;
    }
  }

  if (bestSlope > POOLING_RISE) {
    return NO_CELL;
  }

  return best;
}

function erupt(volcano: Volcano, seconds: number, services: PowerServices): void {
  const pace = tongueReach(volcano, services) / (volcano.eruptionSeconds * TONGUE_SHARE_OF_ERUPTION);

  for (const tongue of volcano.tongues) {
    tongue.progress += pace * seconds;

    while (tongue.progress >= 1 && !tongue.isStopped) {
      tongue.progress -= 1;
      advance(volcano, tongue, services);
    }
  }

  hurlBombs(volcano, seconds, services);
  services.world.recovering.retain((cell) => {
    return !volcano.lava.has(cell);
  });
}

function advance(volcano: Volcano, tongue: LavaTongue, services: PowerServices): void {
  const { world } = services;

  const head = headOf(tongue);
  const next = nextLavaCell(services, volcano.lava, head);

  if (next === NO_CELL || tongue.cells.length >= tongueReach(volcano, services) || !world.isOnIsland(next)) {
    tongue.isStopped = true;

    return;
  }

  if (world.isWater(next)) {
    tongue.isStopped = true;
    tongue.quenchedCell = next;
    services.fire.douse(head, 1);

    return;
  }

  cover(volcano, next, services);
  tongue.cells.push(next);
  widen(volcano, head, next, services);
}

function widen(volcano: Volcano, from: number, cell: number, services: PowerServices): void {
  const { world } = services;
  const { grid, terrain } = world;

  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);
  const alongColumn = column - grid.columnOf(from);
  const alongRow = row - grid.rowOf(from);

  for (const side of [-1, 1]) {
    const sideColumn = column - alongRow * side;
    const sideRow = row + alongColumn * side;

    if (!grid.contains(sideColumn, sideRow)) {
      continue;
    }

    const neighbor = grid.index(sideColumn, sideRow);

    const isSpreading = hashToUnit(neighbor, SPLIT_SALT) < WIDENING_CHANCE * (0.5 + volcano.strength * 0.5);
    const isLevel = terrain.height[neighbor] <= terrain.height[cell] + POOLING_RISE;

    if (isSpreading && isLevel && !volcano.lava.has(neighbor) && isDryLand(world, neighbor)) {
      cover(volcano, neighbor, services);
    }
  }
}

function cover(volcano: Volcano, cell: number, services: PowerServices): void {
  const { buildings, fauna, fire, people, world } = services;
  const { fields, grid } = world;

  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);
  const x = grid.cellCenterX(cell);
  const z = grid.cellCenterZ(cell);

  world.clearPlants(cell, false);
  world.setGround(cell, Ground.Basalt);
  fields.scorch[cell] = 0;
  fields.snow[cell] = 0;
  fields.wetness[cell] = 0;
  world.markSurfaceCell(cell);
  volcano.lava.set(cell, 1);

  for (const offset of NEIGHBOR_OFFSETS) {
    if (grid.contains(column + offset.column, row + offset.row)) {
      fire.addHeat(grid.index(column + offset.column, row + offset.row), LAVA_HEAT);
    }
  }

  buildings.damageArea(x, z, grid.cellSize * 1.5, BUILDING_DAMAGE, true);
  people.damageArea(x, z, grid.cellSize, LAVA_DAMAGE, "lava");
  fauna.damageArea(x, z, grid.cellSize, LAVA_DAMAGE, "fire");
}

function hurlBombs(volcano: Volcano, seconds: number, services: PowerServices): void {
  const { embers, random } = services;

  volcano.bombBudget += BOMBS_PER_SECOND * (0.5 + volcano.strength) * seconds;

  while (volcano.bombBudget >= 1) {
    volcano.bombBudget -= 1;

    const angle = random.next() * FULL_TURN;
    const distance = volcano.radius * random.between(NEAREST_BOMB, FARTHEST_BOMB);

    embers.hurl({
      durationSeconds: random.between(1.5, 3.5),
      fromX: volcano.x,
      fromZ: volcano.z,
      toX: volcano.x + Math.cos(angle) * distance,
      toZ: volcano.z + Math.sin(angle) * distance,
    });
  }
}

function cool(volcano: Volcano, seconds: number): void {
  for (const [cell, heat] of volcano.lava) {
    const rate = (1 - COOLING_SPREAD / 2 + COOLING_SPREAD * hashToUnit(cell, COOLING_SALT)) / COOLING_SECONDS;
    const cooled = heat - rate * seconds;

    if (cooled <= 0) {
      volcano.lava.delete(cell);
    } else {
      volcano.lava.set(cell, cooled);
    }
  }
}

function endanger(volcano: Volcano, seconds: number, services: PowerServices): void {
  const { fauna, hazards, people, world } = services;
  const { grid } = world;

  const extent = volcano.radius * (1 + LONGEST_TONGUE_REACH);

  for (const person of people.livingWithin(volcano.x, volcano.z, extent)) {
    if (isHot(volcano, grid.cellAt(person.mover.x, person.mover.z))) {
      people.kill(person, "lava");
    }
  }

  for (const animal of fauna.livingWithin(volcano.x, volcano.z, extent)) {
    if (isHot(volcano, grid.cellAt(animal.mover.x, animal.mover.z))) {
      fauna.kill(animal, "fire");
    }
  }

  for (const tongue of volcano.tongues) {
    let lastZone = Number.POSITIVE_INFINITY;

    for (let index = tongue.cells.length - 1; index >= 0; index -= 1) {
      const cell = tongue.cells[index];

      if (lastZone - index < TONGUE_DANGER_SPACING || !isHot(volcano, cell)) {
        continue;
      }

      lastZone = index;
      hazards.addZone({
        radius: grid.cellSize * HEAD_DANGER_CELLS,
        remainingSeconds: seconds,
        x: grid.cellCenterX(cell),
        z: grid.cellCenterZ(cell),
      });
    }
  }

  if (activityOf(volcano) <= 0) {
    return;
  }

  fauna.scare(volcano.x, volcano.z, volcano.radius * SCARE_REACH);
  hazards.addZone({ radius: volcano.radius * CRATER_DANGER, remainingSeconds: seconds, x: volcano.x, z: volcano.z });
}

function settleLava(volcano: Volcano, services: PowerServices): void {
  const { world } = services;

  for (const cell of volcano.lava.keys()) {
    if (world.isWater(cell)) {
      volcano.lava.delete(cell);
    } else if (isHot(volcano, cell)) {
      world.clearPlants(cell, false);
    }
  }
}

function isHot(volcano: Volcano, cell: number): boolean {
  const heat = volcano.lava.get(cell);

  return heat !== undefined && heat > HOT_LAVA;
}

function steamOf(volcano: Volcano, services: PowerServices): number[] {
  const { grid } = services.world;

  const steam: number[] = [];

  for (const tongue of volcano.tongues) {
    const head = headOf(tongue);

    if (tongue.quenchedCell !== NO_CELL && isHot(volcano, head)) {
      steam.push(grid.cellCenterX(tongue.quenchedCell), grid.cellCenterZ(tongue.quenchedCell));
    }
  }

  return steam;
}

function createVolcano(eruption: Eruption): Volcano {
  return {
    age: 0,
    bombBudget: 0,
    eruptionSeconds: SHORTEST_ERUPTION_SECONDS + ERUPTION_SECONDS_PER_STRENGTH * eruption.strength,
    lava: new Map(),
    radius: eruption.radius,
    strength: eruption.strength,
    tongues: [],
    x: eruption.x,
    z: eruption.z,
  };
}

export class VolcanoSystem {
  #lavaUpdate: ReadonlyMap<number, number> | null = null;
  #volcanoes: Volcano[] = [];

  get all(): readonly Volcano[] {
    return this.#volcanoes;
  }

  snapshot(): Volcano[] {
    return structuredClone(this.#volcanoes);
  }

  restore(volcanoes: readonly Volcano[]): void {
    this.#volcanoes = structuredClone([...volcanoes]);
    this.#lavaUpdate = this.#lava();
  }

  isCrowding(x: number, z: number, radius: number): boolean {
    return this.#volcanoes.some((volcano) => {
      return Math.hypot(volcano.x - x, volcano.z - z) < volcano.radius + radius;
    });
  }

  rumble(eruption: Eruption, services: PowerServices): void {
    this.#volcanoes.push(createVolcano(eruption));
    services.effects.add({
      kind: "earthquake",
      magnitude: 0.4 + eruption.strength * 0.4,
      radius: eruption.radius,
      x: eruption.x,
      z: eruption.z,
    });
  }

  update(seconds: number, services: PowerServices): void {
    if (this.#volcanoes.length === 0) {
      return;
    }

    for (const volcano of this.#volcanoes) {
      const before = volcano.age;

      volcano.age += seconds;

      if (before < SWELL_SECONDS) {
        swell(volcano, before, Math.min(volcano.age, SWELL_SECONDS), services);
      }

      if (before < SWELL_SECONDS && volcano.age >= SWELL_SECONDS) {
        beginEruption(volcano, services);
      }

      if (isErupting(volcano)) {
        erupt(volcano, seconds, services);
      } else if (volcano.age >= SWELL_SECONDS) {
        cool(volcano, seconds);
      }

      settleLava(volcano, services);
      endanger(volcano, seconds, services);
    }

    this.#volcanoes = this.#volcanoes.filter((volcano) => {
      return !isSpent(volcano);
    });
    this.#lavaUpdate = this.#lava();
  }

  views(services: PowerServices): VolcanoView[] {
    return this.#volcanoes.map((volcano) => {
      return {
        activity: activityOf(volcano),
        craterRadius: craterRadius(volcano),
        radius: volcano.radius,
        steam: steamOf(volcano, services),
        x: volcano.x,
        z: volcano.z,
      };
    });
  }

  takeLava(): ReadonlyMap<number, number> | null {
    const update = this.#lavaUpdate;

    this.#lavaUpdate = null;

    return update;
  }

  #lava(): ReadonlyMap<number, number> {
    const heats = new Map<number, number>();

    for (const volcano of this.#volcanoes) {
      for (const [cell, heat] of volcano.lava) {
        const previous = heats.get(cell);

        heats.set(cell, previous === undefined ? heat : Math.max(heat, previous));
      }
    }

    return heats;
  }
}
