import {
  formIndexOf,
  isMonumentPiece,
  jitterOf,
  type MonumentPiece,
  PIECE_FORMS,
  type PieceForm,
  pieceFormIndex,
  pieceSeed,
  seedOfForm,
} from "../../content/monuments.ts";
import { PlantSpecies } from "../../content/plants.ts";
import { FULL_TURN, hashToUnit, lerp } from "../../shared/math.ts";
import { type Monument, MonumentDamage, type MonumentDamageLevel } from "../../world/monuments.ts";
import { NO_PLANT } from "../../world/vegetation-store.ts";
import { MONUMENT_GROUND, type WorldState } from "./world-state.ts";

const RUBBLE_INTENSITY = 0.75;
const FALLEN_INTENSITY = 0.45;
const LEANING_INTENSITY = 0.2;
const DROWNED_SHARE = 0.5;
const FRAGMENTS_PER_PIECE = 2;
const FALL_SWAY = 0.4;
const BROKEN_TOP_TURN = 0.9;
const FRAGMENT_SPREAD = 2.4;
const NEAREST_FRAGMENT = 2.2;
const FARTHEST_FRAGMENT = 5.5;
const PILE_SHARE = 0.5;
const ROLL_SALT = 41.3;
const FRAGMENT_SALT = 7.7;

export type Catastrophe = "earthquake" | "explosion" | "meteor";

const CATASTROPHE_NAMES: Readonly<Record<Catastrophe, string>> = {
  earthquake: "The earthquake",
  explosion: "The blast",
  meteor: "The meteor",
};

type DamageOdds = readonly [readonly number[], readonly number[], readonly number[]];

type HarmLevel = Exclude<MonumentDamageLevel, typeof MonumentDamage.Standing>;

const RUIN_VERBS: Readonly<Record<HarmLevel, string>> = {
  [MonumentDamage.Leaning]: "cracked",
  [MonumentDamage.Fallen]: "toppled",
  [MonumentDamage.Rubble]: "shattered",
};

interface Ruination {
  readonly odds: DamageOdds;
  readonly order: readonly number[];
}

const RUINATIONS: Readonly<Record<MonumentPiece, Ruination>> = {
  [PlantSpecies.Arch]: ruination(
    PlantSpecies.Arch,
    ["standing", "collapsed"],
    [
      [0.8, 0.2],
      [0, 1],
      [0, 1],
    ]
  ),
  [PlantSpecies.Cairn]: ruination(
    PlantSpecies.Cairn,
    ["tall", "low"],
    [
      [0.6, 0.4],
      [0, 1],
      [0, 1],
    ]
  ),
  [PlantSpecies.Dolmen]: ruination(
    PlantSpecies.Dolmen,
    ["intact", "collapsed"],
    [
      [1, 0],
      [0.2, 0.8],
      [0, 1],
    ]
  ),
  [PlantSpecies.Idol]: ruination(
    PlantSpecies.Idol,
    ["buried", "toppled"],
    [
      [1, 0],
      [0.3, 0.7],
      [0, 1],
    ]
  ),
  [PlantSpecies.Menhir]: ruination(
    PlantSpecies.Menhir,
    ["upright", "leaning", "fallen", "broken"],
    [
      [0.25, 0.75, 0, 0],
      [0, 0.15, 0.6, 0.25],
      [0, 0, 0.4, 0.6],
    ]
  ),
  [PlantSpecies.Pillar]: ruination(
    PlantSpecies.Pillar,
    ["standing", "fallen", "stump"],
    [
      [0.75, 0.25, 0],
      [0.2, 0.8, 0],
      [0, 0.5, 0.5],
    ]
  ),
};

export interface Shock {
  readonly catastrophe: Catastrophe;
  readonly reach: number;
  readonly strength: number;
  readonly x: number;
  readonly z: number;
}

interface MonumentHarm {
  readonly damage: HarmLevel;
  readonly monument: Monument;
}

function ruination<Piece extends MonumentPiece>(
  piece: Piece,
  order: readonly PieceForm<Piece>[],
  odds: DamageOdds
): Ruination {
  return {
    odds,
    order: order.map((form) => {
      return pieceFormIndex(piece, form);
    }),
  };
}

function damageFrom(shock: Shock, monument: Monument): HarmLevel | null {
  const distance = Math.hypot(monument.x - shock.x, monument.z - shock.z);

  const intensity = shock.strength * (1 - distance / shock.reach);

  if (intensity >= RUBBLE_INTENSITY) {
    return MonumentDamage.Rubble;
  }

  if (intensity >= FALLEN_INTENSITY) {
    return MonumentDamage.Fallen;
  }

  return intensity >= LEANING_INTENSITY ? MonumentDamage.Leaning : null;
}

export function shakeMonuments(world: WorldState, shock: Shock, day: number): MonumentHarm[] {
  const harms: MonumentHarm[] = [];

  for (const [position, monument] of world.monuments.entries()) {
    const condition = world.monumentConditions[position];

    const damage = damageFrom(shock, monument);

    if (damage === null || damage <= condition.damage) {
      continue;
    }

    condition.damage = damage;
    layRuins(world, monument, damage, shock, day);
    harms.push({ damage, monument });
  }

  return harms;
}

function layRuins(world: WorldState, monument: Monument, damage: HarmLevel, shock: Shock, day: number): void {
  const pieces = piecesOf(world, monument);

  for (const piece of pieces) {
    breakPiece(world, piece, damage, shock);
  }

  if (damage < MonumentDamage.Rubble) {
    return;
  }

  for (const piece of pieces) {
    scatterRubble(world, piece, shock, day);
  }
}

function piecesOf(world: WorldState, monument: Monument): number[] {
  const { vegetation } = world;

  const pieces: number[] = [];

  for (const cell of monument.cells) {
    for (let plant = vegetation.firstPlantInCell(cell); plant !== NO_PLANT; plant = vegetation.nextPlantInCell(plant)) {
      if (vegetation.isAlive(plant) && isMonumentPiece(vegetation.species[plant])) {
        pieces.push(plant);
      }
    }
  }

  return pieces.sort((first, second) => {
    return first - second;
  });
}

function chosenRank(odds: readonly number[], roll: number): number {
  let total = 0;

  for (const [rank, chance] of odds.entries()) {
    total += chance;

    if (roll < total) {
      return rank;
    }
  }

  return odds.length - 1;
}

function breakPiece(world: WorldState, plant: number, damage: HarmLevel, shock: Shock): void {
  const { vegetation } = world;

  const species = vegetation.species[plant];

  if (!isMonumentPiece(species)) {
    return;
  }

  const { odds, order } = RUINATIONS[species];

  const seed = vegetation.seed[plant];
  const currentRank = order.indexOf(formIndexOf(species, seed));
  const roll = hashToUnit(plant, damage, world.seed + ROLL_SALT);

  const rank = Math.max(currentRank, chosenRank(odds[damage - 1], roll));

  if (rank === currentRank) {
    return;
  }

  const formIndex = order[rank];

  vegetation.reshape(
    plant,
    seedOfForm(species, formIndex, jitterOf(species, seed)),
    fallRotation(world, plant, species, formIndex, shock)
  );
}

function fallRotation(
  world: WorldState,
  plant: number,
  species: MonumentPiece,
  formIndex: number,
  shock: Shock
): number {
  const { vegetation } = world;

  const outwardX = vegetation.x[plant] - shock.x;
  const outwardZ = vegetation.z[plant] - shock.z;
  const sway = (hashToUnit(plant, world.seed, ROLL_SALT) - 0.5) * FALL_SWAY;

  const form = PIECE_FORMS[species][formIndex];

  if (form === "fallen" && species === PlantSpecies.Menhir) {
    return Math.atan2(outwardX, outwardZ) + sway;
  }

  if (form === "broken") {
    return Math.atan2(outwardX, outwardZ) - BROKEN_TOP_TURN + sway;
  }

  if (form === "fallen") {
    return Math.atan2(-outwardZ, outwardX) + sway;
  }

  if (form === "toppled") {
    return Math.atan2(outwardZ, -outwardX) + sway;
  }

  return vegetation.rotation[plant];
}

function scatterRubble(world: WorldState, plant: number, shock: Shock, day: number): void {
  const { grid, vegetation } = world;

  const x = vegetation.x[plant];
  const z = vegetation.z[plant];

  const away = Math.atan2(z - shock.z, x - shock.x);

  for (let fragment = 0; fragment < FRAGMENTS_PER_PIECE; fragment += 1) {
    const salt = plant * FRAGMENTS_PER_PIECE + fragment;

    const angle = away + (hashToUnit(salt, 1, FRAGMENT_SALT) - 0.5) * FRAGMENT_SPREAD;
    const reach = lerp(NEAREST_FRAGMENT, FARTHEST_FRAGMENT, hashToUnit(salt, 2, FRAGMENT_SALT));

    const fragmentX = x + Math.cos(angle) * reach;
    const fragmentZ = z + Math.sin(angle) * reach;
    const cell = grid.cellAt(fragmentX, fragmentZ);

    if (cell < 0 || world.occupancy[cell] !== MONUMENT_GROUND || world.isWater(cell)) {
      continue;
    }

    const isPile = hashToUnit(salt, 3, FRAGMENT_SALT) < PILE_SHARE;
    const jitter = hashToUnit(salt, 4, FRAGMENT_SALT);

    world.plant({
      bornDay: day,
      height: isPile ? lerp(0.9, 1.4, jitter) : lerp(1.2, 1.9, jitter),
      rotation: hashToUnit(salt, 5, FRAGMENT_SALT) * FULL_TURN,
      seed: isPile ? pieceSeed(PlantSpecies.Cairn, "low", jitter) : pieceSeed(PlantSpecies.Menhir, "fallen", jitter),
      species: isPile ? PlantSpecies.Cairn : PlantSpecies.Menhir,
      x: fragmentX,
      z: fragmentZ,
    });
  }
}

export function drownMonuments(world: WorldState): Monument[] {
  const drowned: Monument[] = [];

  for (const [position, monument] of world.monuments.entries()) {
    const condition = world.monumentConditions[position];

    if (condition.isDrowned) {
      continue;
    }

    const wetCells = monument.cells.filter((cell) => {
      return world.isWater(cell);
    }).length;

    if (wetCells > monument.cells.length * DROWNED_SHARE) {
      condition.isDrowned = true;
      drowned.push(monument);
    }
  }

  return drowned;
}

function monumentReference(monument: Monument): string {
  const { name } = monument;

  return name.startsWith("The ") ? `the ${name.slice(4)}` : `the ${name}`;
}

export function ruinText(catastrophe: Catastrophe, harm: MonumentHarm): string {
  return `${CATASTROPHE_NAMES[catastrophe]} ${RUIN_VERBS[harm.damage]} ${monumentReference(harm.monument)}`;
}

export function drowningText(monument: Monument): string {
  return `Rising water drowned ${monumentReference(monument)}`;
}
