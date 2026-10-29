import { WOODED_BIOMES } from "../content/biomes.ts";
import {
  MONUMENT_KINDS,
  MONUMENT_SLOPE,
  MONUMENTS,
  type MonumentKind,
  type MonumentPiece,
  type PieceForm,
  pieceSeed,
} from "../content/monuments.ts";
import { PlantSpecies, plantSpeciesDefinition } from "../content/plants.ts";
import { clamp, FULL_TURN, lerp } from "../shared/math.ts";
import { createRandom, type RandomSource } from "../shared/random.ts";
import { hasRoomFromCoast } from "../world/coast.ts";
import { canStandOn, slopeAt } from "../world/footing.ts";
import { countForArea } from "../world/island-size.ts";
import type { Monument } from "../world/monuments.ts";
import type { TerrainData } from "../world/terrain-data.ts";
import { isWaterCell, sampleHeight } from "../world/terrain-sampling.ts";
import type { PlantPlacement } from "../world/vegetation-store.ts";
import type { WorldGrid } from "../world/world-grid.ts";
import { INITIAL_PLANT_DAY } from "./vegetation.ts";

const NORMAL_CANDIDATES = 160;
const EXTRA_KINDS: readonly MonumentKind[] = ["stoneCircle", "menhirRow", "cairn", "dolmen"];
const NORMAL_EXTRA_MONUMENTS = 2;
const RIM_MARGIN = 160;
const SPACING = 520;
const DRY_REACH = 40;
const COAST_CLEARANCE = 60;
const GROUND_MARGIN = 1.5;
const PROMINENCE_REACH = 170;
const PROMINENCE_SAMPLES = 10;

interface LaidPiece {
  readonly height: number;
  readonly offsetX: number;
  readonly offsetZ: number;
  readonly rotation: number;
  readonly seed: number;
  readonly species: MonumentPiece;
}

interface Layout {
  readonly court: number;
  readonly pieces: readonly LaidPiece[];
}

const LAYOUTS: Readonly<Record<MonumentKind, (random: RandomSource) => Layout>> = {
  cairn,
  colonnade,
  dolmen,
  idol,
  menhirRow,
  stoneCircle,
};

interface MonumentPlan {
  readonly monuments: readonly Monument[];
  readonly pieces: readonly PlantPlacement[];
}

interface Site {
  readonly angle: number;
  readonly x: number;
  readonly z: number;
}

interface PlacedPiece {
  readonly placement: PlantPlacement;
  readonly reach: number;
}

interface Planner {
  readonly grid: WorldGrid;
  readonly placed: Monument[];
  readonly terrain: TerrainData;
}

interface Choice {
  readonly cells: readonly number[];
  readonly pieces: readonly PlacedPiece[];
  readonly score: number;
  readonly site: Site;
}

function layPiece<Piece extends MonumentPiece>(
  random: RandomSource,
  species: Piece,
  form: PieceForm<Piece>,
  placement: Omit<LaidPiece, "seed" | "species">
): LaidPiece {
  return { ...placement, seed: pieceSeed(species, form, random.next()), species };
}

function menhirForm(
  roll: number,
  upright: number,
  leaning: number,
  broken: number
): PieceForm<typeof PlantSpecies.Menhir> {
  if (roll < upright) {
    return "upright";
  }

  if (roll < upright + leaning) {
    return "leaning";
  }

  return roll < upright + leaning + broken ? "broken" : "fallen";
}

function stoneCircle(random: RandomSource): Layout {
  const radius = random.between(10, 13);
  const count = random.integer(9, 13);
  const pieces: LaidPiece[] = [];

  for (let stone = 0; stone < count; stone += 1) {
    const angle = (stone / count) * FULL_TURN + random.signed() * 0.07;
    const form = menhirForm(random.next(), 0.6, 0.18, 0.1);

    const offsetX = Math.cos(angle) * radius;
    const offsetZ = Math.sin(angle) * radius;

    pieces.push(
      layPiece(random, PlantSpecies.Menhir, form, {
        height: random.between(3, 4.6),
        offsetX,
        offsetZ,
        rotation: Math.atan2(-offsetX, -offsetZ) + random.signed() * 0.15,
      })
    );
  }

  if (random.chance(0.5)) {
    pieces.push(
      layPiece(random, PlantSpecies.Menhir, "fallen", {
        height: random.between(3, 3.8),
        offsetX: random.signed() * 1.2,
        offsetZ: random.signed() * 1.2,
        rotation: random.next() * FULL_TURN,
      })
    );
  }

  return { court: radius, pieces };
}

function menhirRow(random: RandomSource): Layout {
  const count = random.integer(8, 13);
  const spacing = random.between(5, 6.2);
  const bow = random.signed() * 0.012;
  const pieces: LaidPiece[] = [];

  for (let stone = 0; stone < count; stone += 1) {
    const along = (stone - (count - 1) / 2) * spacing;
    const tallness = lerp(6, 2.8, stone / (count - 1));

    pieces.push(
      layPiece(random, PlantSpecies.Menhir, menhirForm(random.next(), 0.74, 0.12, 0.08), {
        height: tallness * random.between(0.88, 1.08),
        offsetX: along,
        offsetZ: bow * along * along + random.signed() * 0.35,
        rotation: random.signed() * 0.2,
      })
    );
  }

  return { court: 0, pieces };
}

function dolmen(random: RandomSource): Layout {
  const pieces: LaidPiece[] = [
    layPiece(random, PlantSpecies.Dolmen, random.chance(0.7) ? "intact" : "collapsed", {
      height: random.between(3.6, 4.4),
      offsetX: 0,
      offsetZ: 0,
      rotation: random.signed() * 0.3,
    }),
  ];

  if (random.chance(0.6)) {
    pieces.push(
      layPiece(random, PlantSpecies.Menhir, "upright", {
        height: random.between(2.8, 3.6),
        offsetX: random.between(6.5, 8),
        offsetZ: random.signed() * 2,
        rotation: random.next() * FULL_TURN,
      })
    );
  }

  if (random.chance(0.6)) {
    pieces.push(
      layPiece(random, PlantSpecies.Menhir, "fallen", {
        height: random.between(3.2, 4),
        offsetX: -random.between(6.5, 8),
        offsetZ: random.signed() * 2,
        rotation: random.next() * FULL_TURN,
      })
    );
  }

  return { court: 4, pieces };
}

function idol(random: RandomSource): Layout {
  const pieces: LaidPiece[] = [
    layPiece(random, PlantSpecies.Idol, random.chance(0.65) ? "buried" : "toppled", {
      height: random.between(7, 9),
      offsetX: 0,
      offsetZ: 0,
      rotation: random.signed() * 0.4,
    }),
  ];

  for (const side of [-1, 1]) {
    if (random.chance(0.55)) {
      pieces.push(
        layPiece(random, PlantSpecies.Menhir, random.chance(0.5) ? "broken" : "fallen", {
          height: random.between(2.6, 3.6),
          offsetX: side * random.between(9, 11),
          offsetZ: random.between(-6, -3),
          rotation: random.next() * FULL_TURN,
        })
      );
    }
  }

  return { court: 0, pieces };
}

function pillarForm(roll: number): PieceForm<typeof PlantSpecies.Pillar> {
  if (roll < 0.45) {
    return "standing";
  }

  return roll < 0.72 ? "stump" : "fallen";
}

function colonnade(random: RandomSource): Layout {
  const columns = random.integer(3, 5);
  const spacing = 6.4;
  const pieces: LaidPiece[] = [];

  for (const side of [-1, 1]) {
    for (let column = 0; column < columns; column += 1) {
      pieces.push(
        layPiece(random, PlantSpecies.Pillar, pillarForm(random.next()), {
          height: random.between(5.8, 6.8),
          offsetX: (column - (columns - 1) / 2) * spacing,
          offsetZ: side * 4.5,
          rotation: side > 0 ? random.signed() * 0.3 : Math.PI + random.signed() * 0.3,
        })
      );
    }
  }

  pieces.push(
    layPiece(random, PlantSpecies.Arch, random.chance(0.6) ? "standing" : "collapsed", {
      height: random.between(7.2, 8),
      offsetX: ((columns + 1) / 2) * spacing + 1.5,
      offsetZ: 0,
      rotation: Math.PI / 2 + random.signed() * 0.05,
    })
  );

  return { court: (columns / 2) * spacing, pieces };
}

function cairn(random: RandomSource): Layout {
  const pieces: LaidPiece[] = [
    layPiece(random, PlantSpecies.Cairn, random.chance(0.7) ? "tall" : "low", {
      height: random.between(3.2, 4.2),
      offsetX: 0,
      offsetZ: 0,
      rotation: random.next() * FULL_TURN,
    }),
  ];

  const small = random.integer(2, 5);

  for (let stone = 0; stone < small; stone += 1) {
    const angle = (stone / small) * FULL_TURN + random.signed() * 0.4;
    const reach = random.between(6.5, 9);

    pieces.push(
      layPiece(random, PlantSpecies.Cairn, random.chance(0.6) ? "tall" : "low", {
        height: random.between(1.4, 2.1),
        offsetX: Math.cos(angle) * reach,
        offsetZ: Math.sin(angle) * reach,
        rotation: random.next() * FULL_TURN,
      })
    );
  }

  return { court: 0, pieces };
}

function placePieces(layout: Layout, site: Site): PlacedPiece[] {
  const cosine = Math.cos(site.angle);
  const sine = Math.sin(site.angle);

  return layout.pieces.map((piece) => {
    return {
      placement: {
        bornDay: INITIAL_PLANT_DAY,
        height: piece.height,
        rotation: piece.rotation + site.angle,
        seed: piece.seed,
        species: piece.species,
        x: site.x + piece.offsetX * cosine + piece.offsetZ * sine,
        z: site.z - piece.offsetX * sine + piece.offsetZ * cosine,
      },
      reach: plantSpeciesDefinition(piece.species).radiusPerMeter * piece.height,
    };
  });
}

function footprint(grid: WorldGrid, layout: Layout, site: Site, pieces: readonly PlacedPiece[]): number[] {
  const cells = new Set<number>();
  const corner = grid.cellSize * Math.SQRT1_2;

  for (const { placement, reach } of pieces) {
    for (const cell of grid.cellsInRadius(placement.x, placement.z, reach + GROUND_MARGIN + corner)) {
      cells.add(cell);
    }
  }

  if (layout.court > 0) {
    for (const cell of grid.cellsInRadius(site.x, site.z, layout.court)) {
      cells.add(cell);
    }
  }

  return [...cells].sort((first, second) => {
    return first - second;
  });
}

function siteReach(site: Site, pieces: readonly PlacedPiece[]): number {
  return pieces.reduce((widest, { placement, reach }) => {
    return Math.max(widest, Math.hypot(placement.x - site.x, placement.z - site.z) + reach);
  }, 0);
}

function isDry(planner: Planner, site: Site, reach: number): boolean {
  const { grid, terrain } = planner;

  return grid.cellsInRadius(site.x, site.z, reach + DRY_REACH).every((cell) => {
    return !isWaterCell(terrain, cell);
  });
}

function isFootingSound(planner: Planner, cells: readonly number[], pieces: readonly PlacedPiece[]): boolean {
  const { grid, terrain } = planner;

  const isGroundLevel = cells.every((cell) => {
    return canStandOn(terrain, grid, cell, MONUMENT_SLOPE);
  });

  return (
    isGroundLevel &&
    pieces.every(({ placement }) => {
      return hasRoomFromCoast(terrain.coastDistance, grid, placement.x, placement.z, COAST_CLEARANCE);
    })
  );
}

function prominence(planner: Planner, site: Site): number {
  const { grid, terrain } = planner;

  let surroundings = 0;

  for (let sample = 0; sample < PROMINENCE_SAMPLES; sample += 1) {
    const angle = (sample / PROMINENCE_SAMPLES) * FULL_TURN;

    surroundings += sampleHeight(
      terrain.height,
      grid,
      site.x + Math.cos(angle) * PROMINENCE_REACH,
      site.z + Math.sin(angle) * PROMINENCE_REACH
    );
  }

  return sampleHeight(terrain.height, grid, site.x, site.z) - surroundings / PROMINENCE_SAMPLES;
}

function settingScore(planner: Planner, kind: MonumentKind, site: Site, cells: readonly number[]): number {
  const { grid, terrain } = planner;

  const cell = grid.cellAt(site.x, site.z);
  const meanSlope =
    cells.reduce((total, other) => {
      return total + slopeAt(terrain.height, grid, other);
    }, 0) / cells.length;
  const flatness = (MONUMENT_SLOPE - meanSlope) * 6;

  switch (MONUMENTS[kind].setting) {
    case "heights":
      return flatness + clamp(prominence(planner, site) / 12, -2, 4);
    case "clearing":
      return flatness + (WOODED_BIOMES.has(terrain.biome[cell]) ? 2 : 0) + (1 - terrain.woodland[cell]) * 2;
    default:
      return flatness * 2 + clamp(prominence(planner, site) / 30, -1, 1);
  }
}

function isSpaced(planner: Planner, site: Site): boolean {
  return planner.placed.every((other) => {
    return Math.hypot(other.x - site.x, other.z - site.z) > SPACING;
  });
}

function judge(planner: Planner, kind: MonumentKind, layout: Layout, site: Site): Choice | null {
  const { grid, terrain } = planner;

  const cell = grid.cellAt(site.x, site.z);
  const isFittingLand = MONUMENTS[kind].biomes.some((biome) => {
    return biome === terrain.biome[cell];
  });

  if (!(isFittingLand && canStandOn(terrain, grid, cell, MONUMENT_SLOPE))) {
    return null;
  }

  if (!isSpaced(planner, site)) {
    return null;
  }

  const pieces = placePieces(layout, site);
  const cells = footprint(grid, layout, site, pieces);

  if (!(isFootingSound(planner, cells, pieces) && isDry(planner, site, siteReach(site, pieces)))) {
    return null;
  }

  return { cells, pieces, score: settingScore(planner, kind, site, cells), site };
}

function bestSite(planner: Planner, kind: MonumentKind, layout: Layout, random: RandomSource): Choice | null {
  const limit = planner.grid.halfSize - RIM_MARGIN;
  const candidates = countForArea(planner.grid, NORMAL_CANDIDATES);

  let best: Choice | null = null;

  for (let candidate = 0; candidate < candidates; candidate += 1) {
    const site: Site = { angle: random.next() * FULL_TURN, x: random.signed() * limit, z: random.signed() * limit };
    const choice = judge(planner, kind, layout, site);

    if (choice !== null && (best === null || choice.score > best.score)) {
      best = choice;
    }
  }

  return best;
}

function unusedName(names: readonly string[], first: number, used: ReadonlySet<string>): string {
  for (let index = 0; index < names.length; index += 1) {
    const candidate = names[(first + index) % names.length];

    if (!used.has(candidate)) {
      return candidate;
    }
  }

  return `${names[first]} ${used.size + 1}`;
}

export function planMonuments(grid: WorldGrid, terrain: TerrainData, seed: number): MonumentPlan {
  const random = createRandom(seed * 17 + 9);
  const planner: Planner = { grid, placed: [], terrain };
  const pieces: PlantPlacement[] = [];

  const extras = Array.from({ length: countForArea(grid, NORMAL_EXTRA_MONUMENTS) }, () => {
    return random.pick(EXTRA_KINDS);
  });
  const namesUsed = new Set<string>();

  for (const kind of [...MONUMENT_KINDS, ...extras]) {
    const { names } = MONUMENTS[kind];

    const layout = LAYOUTS[kind](random);
    const firstName = random.integer(0, names.length);
    const choice = bestSite(planner, kind, layout, random);

    if (choice === null) {
      continue;
    }

    const name = unusedName(names, firstName, namesUsed);

    namesUsed.add(name);
    planner.placed.push({
      cells: choice.cells,
      id: planner.placed.length,
      kind,
      name,
      x: choice.site.x,
      z: choice.site.z,
    });
    pieces.push(
      ...choice.pieces.map((piece) => {
        return piece.placement;
      })
    );
  }

  return { monuments: planner.placed, pieces };
}
