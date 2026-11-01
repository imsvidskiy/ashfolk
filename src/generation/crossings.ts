import { Biome } from "../content/biomes.ts";
import { Ground } from "../content/grounds.ts";
import { clamp, hashToUnit, lerp } from "../shared/math.ts";
import { isBrookCell, Passage } from "../world/brooks.ts";
import { isOnIsland } from "../world/coast.ts";
import {
  type Crossing,
  type CrossingKind,
  crossingDirection,
  crossingLength,
  crossingMiddle,
  LOG_ROOT_BEHIND,
  type LogBridge,
  logDeckAt,
  logRadiusAt,
  type Point,
  pointOnCrossing,
} from "../world/crossings.ts";
import { isWalkableGround, slopeAt } from "../world/footing.ts";
import { isWaterCell, sampleHeight } from "../world/terrain-sampling.ts";
import type { River, WaterFeatures } from "../world/water.ts";
import type { WorldGrid } from "../world/world-grid.ts";
import { BankRegions } from "./bank-regions.ts";
import { isNearLake, NO_CELL } from "./drainage.ts";

const SHORTEST_RIVER = 220;
const SOURCE_MARGIN = 30;
const MOUTH_MARGIN = 60;
const FIRST_OFFSET = 90;
const CANDIDATE_SPACING = 8;
const AXIS_TURNS: readonly number[] = [0, 0.3, -0.3];
const WINDOW = 300;
const SPACING_ALONG = 500;
const SPACING_ELSEWHERE = 300;
const WIDENING_STEP = 10;
const LINK_STEP = 40;
const LINK_WINDOW = 200;
const LINK_SPACING = 120;
const BANK_SEARCH = 60;
const BANK_SEARCH_STEP = 2.5;
const ON_RIVER = 18;
const TANGENT_REACH = 10;
const MARCH_STEP = 0.5;
const WIDEST_HALF_SPAN = 30;
const LANDING = 3;
const APPROACH = 7;
const WATERFALL_CLEARANCE = 120;
const LAKE_CLEARANCE = 30;
const COAST_CLEARANCE = 45;
const LOG_LONGEST_WATER = 22;
const LOG_PREFERRED_WATER = 16;
const LOG_STEEPEST_PITCH = 0.25;
const LOG_SINK = 0.25;
const LOG_CLEARANCE = -0.45;
const LOG_DEEP_FORD = 2.6;
const FORD_DEEPEST = 4;
const FORD_LONGEST_WATER = 42;
const FORD_HIGHEST_BANK = 1.4;
const FORD_LEVEL_SPREAD = 1;
const FORD_STEEPEST_FALL = 0.06;
const FALL_REACH = 15;
const FALL_PENALTY = 8;
const FALL_TOLERANCE = 1.25;
const SITE_SALT = 63.1;
const SEED_SALT = 17.9;

const HOMELINESS: Readonly<Record<number, number>> = {
  [Biome.Alpine]: 0,
  [Biome.Beach]: 0.5,
  [Biome.Desert]: 0.1,
  [Biome.Forest]: 0.7,
  [Biome.Glacier]: -0.5,
  [Biome.Meadow]: 1,
  [Biome.Mesa]: 0.1,
  [Biome.Scrub]: 0.6,
  [Biome.Steppe]: 0.8,
  [Biome.Swamp]: -0.3,
  [Biome.Taiga]: 0.5,
  [Biome.Tundra]: 0.2,
  [Biome.Water]: 0,
};

interface CrossingTerrain {
  readonly biome: Uint8Array;
  readonly coastDistance: Float32Array;
  readonly ground: Uint8Array;
  readonly height: Float32Array;
  readonly riverStrength: Uint8Array;
  readonly waterSurface: Float32Array;
}

interface CrossingSurvey {
  readonly grid: WorldGrid;
  readonly isBlocked: (cell: number) => boolean;
  readonly lakeIds: Int32Array;
  readonly terrain: CrossingTerrain;
  readonly water: WaterFeatures;
}

interface BankLimits {
  readonly approach: number;
  readonly landing: number;
}

const STRICT_BANKS: BankLimits = { approach: 0.95, landing: 0.6 };
const LENIENT_BANKS: BankLimits = { approach: 1.05, landing: 0.8 };

interface Bank {
  readonly cell: number;
  readonly edge: number;
  readonly rise: number;
  readonly slope: number;
  readonly support: number;
}

interface WaterSpan {
  readonly deepest: number;
  readonly edge: number;
  readonly highest: number;
  readonly lowest: number;
}

interface Site {
  readonly center: Point;
  readonly deepest: number;
  readonly directionX: number;
  readonly directionZ: number;
  readonly end: Bank;
  readonly highest: number;
  readonly lowest: number;
  readonly start: Bank;
}

interface Candidate {
  readonly along: number;
  readonly crossing: Crossing;
  readonly score: number;
}

interface RiverCourse {
  readonly length: number;
  readonly lengths: readonly number[];
  readonly river: River;
}

interface Stretch {
  readonly connects: (crossing: Crossing) => boolean;
  readonly from: number;
  readonly limits: BankLimits;
  readonly spacing: number;
  readonly to: number;
}

interface Axis {
  readonly center: Point;
  readonly directionX: number;
  readonly directionZ: number;
  readonly limits: BankLimits;
}

interface Wading {
  readonly deepest: number;
  readonly highest: number;
  readonly lowest: number;
  readonly span: number;
}

function passageIn(survey: CrossingSurvey, cell: number): Passage {
  const { grid, isBlocked, terrain } = survey;

  if (isBrookCell(terrain, cell)) {
    return Passage.Brook;
  }

  return isWalkableGround(terrain, grid, cell) && !isBlocked(cell) ? Passage.Ground : Passage.Blocked;
}

function segmentAt(course: RiverCourse, along: number): number {
  const { lengths } = course;

  let low = 0;
  let high = lengths.length - 1;

  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);

    if (lengths[middle] <= along) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return low;
}

function interpolationAt(course: RiverCourse, along: number): { amount: number; index: number } {
  const { lengths } = course;

  const clamped = clamp(along, 0, course.length);
  const index = segmentAt(course, clamped);
  const span = lengths[index + 1] - lengths[index];

  return { amount: span > 0 ? (clamped - lengths[index]) / span : 0, index };
}

function pointAlong(course: RiverCourse, along: number): Point {
  const { amount, index } = interpolationAt(course, along);

  const start = course.river.points[index];
  const end = course.river.points[index + 1];

  return { x: lerp(start.x, end.x, amount), z: lerp(start.z, end.z, amount) };
}

function surfaceAlong(course: RiverCourse, along: number): number {
  const { amount, index } = interpolationAt(course, along);

  return lerp(course.river.points[index].surface, course.river.points[index + 1].surface, amount);
}

function fallAlong(course: RiverCourse, along: number): number {
  const before = clamp(along - FALL_REACH, 0, course.length);
  const after = clamp(along + FALL_REACH, 0, course.length);

  if (after <= before) {
    return 0;
  }

  return Math.abs(surfaceAlong(course, before) - surfaceAlong(course, after)) / (after - before);
}

function isRiverWater(survey: CrossingSurvey, cell: number): boolean {
  const { lakeIds, terrain } = survey;

  return isWaterCell(terrain, cell) && terrain.riverStrength[cell] > 0 && lakeIds[cell] === NO_CELL;
}

function wideningAlong(survey: CrossingSurvey, course: RiverCourse): number {
  const { grid, terrain } = survey;

  for (let along = 0; along <= course.length; along += WIDENING_STEP) {
    const point = pointAlong(course, along);
    const cell = grid.cellAt(point.x, point.z);

    if (isRiverWater(survey, cell) && !isBrookCell(terrain, cell)) {
      return along;
    }
  }

  return course.length;
}

function bankFrom(
  survey: CrossingSurvey,
  center: Point,
  directionX: number,
  directionZ: number,
  regions: BankRegions
): number | null {
  for (let distance = 0; distance <= BANK_SEARCH; distance += BANK_SEARCH_STEP) {
    const cell = survey.grid.cellAt(center.x + directionX * distance, center.z + directionZ * distance);

    if (regions.isGround(cell)) {
      return cell;
    }
  }

  return null;
}

function banksAcross(
  survey: CrossingSurvey,
  course: RiverCourse,
  along: number,
  regions: BankRegions
): { end: number; start: number } | null {
  const center = pointAlong(course, along);
  const behind = pointAlong(course, along - TANGENT_REACH);
  const ahead = pointAlong(course, along + TANGENT_REACH);

  const length = Math.max(1e-6, Math.hypot(ahead.x - behind.x, ahead.z - behind.z));
  const directionX = -(ahead.z - behind.z) / length;
  const directionZ = (ahead.x - behind.x) / length;

  const start = bankFrom(survey, center, -directionX, -directionZ, regions);
  const end = bankFrom(survey, center, directionX, directionZ, regions);

  if (start === null || end === null) {
    return null;
  }

  return { end, start };
}

function riverCourses(water: WaterFeatures): RiverCourse[] {
  return water.rivers.map((river) => {
    return riverCourse(river);
  });
}

function riverCourse(river: River): RiverCourse {
  const lengths = [0];

  let length = 0;

  for (let index = 1; index < river.points.length; index += 1) {
    const previous = river.points[index - 1];
    const current = river.points[index];

    length += Math.hypot(current.x - previous.x, current.z - previous.z);
    lengths.push(length);
  }

  return { length, lengths, river };
}

function nearestAlong(course: RiverCourse, point: Point): { along: number; distance: number } {
  const { lengths, river } = course;

  let best = { along: 0, distance: Number.POSITIVE_INFINITY };

  for (let index = 1; index < river.points.length; index += 1) {
    const start = river.points[index - 1];
    const end = river.points[index];

    const segmentX = end.x - start.x;
    const segmentZ = end.z - start.z;
    const lengthSquared = Math.max(1e-6, segmentX * segmentX + segmentZ * segmentZ);

    const amount = clamp(((point.x - start.x) * segmentX + (point.z - start.z) * segmentZ) / lengthSquared, 0, 1);
    const distance = Math.hypot(start.x + segmentX * amount - point.x, start.z + segmentZ * amount - point.z);

    if (distance < best.distance) {
      best = { along: lerp(lengths[index - 1], lengths[index], amount), distance };
    }
  }

  return best;
}

function fallUnder(courses: readonly RiverCourse[], crossing: Crossing): number {
  const middle = crossingMiddle(crossing);

  let fall = 0;
  let nearestDistance = ON_RIVER;

  for (const course of courses) {
    const nearest = nearestAlong(course, middle);

    if (nearest.distance < nearestDistance) {
      fall = fallAlong(course, nearest.along);
      nearestDistance = nearest.distance;
    }
  }

  return fall;
}

function crossWater(survey: CrossingSurvey, center: Point, directionX: number, directionZ: number): WaterSpan | null {
  const { grid, terrain } = survey;

  let deepest = 0;
  let highest = Number.NEGATIVE_INFINITY;
  let lowest = Number.POSITIVE_INFINITY;

  for (let distance = 0; distance <= WIDEST_HALF_SPAN; distance += MARCH_STEP) {
    const cell = grid.cellAt(center.x + directionX * distance, center.z + directionZ * distance);

    if (!isOnIsland(terrain.coastDistance, cell)) {
      return null;
    }

    if (!isWaterCell(terrain, cell)) {
      return { deepest, edge: distance, highest, lowest };
    }

    if (!isRiverWater(survey, cell)) {
      return null;
    }

    deepest = Math.max(deepest, terrain.waterSurface[cell] - terrain.height[cell]);
    highest = Math.max(highest, terrain.waterSurface[cell]);
    lowest = Math.min(lowest, terrain.waterSurface[cell]);
  }

  return null;
}

function surveyBank(survey: CrossingSurvey, axis: Axis, side: number, edge: number, level: number): Bank | null {
  const { grid, isBlocked, terrain } = survey;
  const { center, limits } = axis;

  const directionX = axis.directionX * side;
  const directionZ = axis.directionZ * side;

  let landingSlope = 0;
  let approachSlope = 0;
  let support = Number.NEGATIVE_INFINITY;

  for (let distance = edge; distance <= edge + LANDING + APPROACH; distance += MARCH_STEP) {
    const x = center.x + directionX * distance;
    const z = center.z + directionZ * distance;
    const cell = grid.cellAt(x, z);

    if (cell < 0 || isWaterCell(terrain, cell) || isBlocked(cell) || grid.isOnEdge(cell)) {
      return null;
    }

    if (terrain.coastDistance[cell] < COAST_CLEARANCE) {
      return null;
    }

    const slope = slopeAt(terrain.height, grid, cell);

    if (distance <= edge + LANDING + LOG_ROOT_BEHIND) {
      landingSlope = Math.max(landingSlope, slope);
      support = Math.max(support, sampleHeight(terrain.height, grid, x, z));
    }

    approachSlope = Math.max(approachSlope, slope);
  }

  if (landingSlope > limits.landing || approachSlope > limits.approach) {
    return null;
  }

  return {
    cell: grid.cellAt(center.x + directionX * (edge + LANDING), center.z + directionZ * (edge + LANDING)),
    edge,
    rise: sampleHeight(terrain.height, grid, center.x + directionX * edge, center.z + directionZ * edge) - level,
    slope: approachSlope,
    support,
  };
}

function measureSite(survey: CrossingSurvey, axis: Axis): Site | null {
  const { center, directionX, directionZ } = axis;

  const centerCell = survey.grid.cellAt(center.x, center.z);

  if (centerCell < 0 || !isRiverWater(survey, centerCell)) {
    return null;
  }

  const forward = crossWater(survey, center, directionX, directionZ);
  const backward = crossWater(survey, center, -directionX, -directionZ);

  if (forward === null || backward === null) {
    return null;
  }

  const highest = Math.max(forward.highest, backward.highest);

  const end = surveyBank(survey, axis, 1, forward.edge, highest);
  const start = surveyBank(survey, axis, -1, backward.edge, highest);

  if (end === null || start === null) {
    return null;
  }

  return {
    center,
    deepest: Math.max(forward.deepest, backward.deepest),
    directionX,
    directionZ,
    end,
    highest,
    lowest: Math.min(forward.lowest, backward.lowest),
    start,
  };
}

function waterSpanOf(site: Site): number {
  return site.start.edge + site.end.edge;
}

function walkwayLength(site: Site): number {
  return waterSpanOf(site) + 2 * LANDING;
}

function logPitch(site: Site): number {
  return (site.end.support - site.start.support) / walkwayLength(site);
}

function lowestLogBottomOverWater(site: Site): number {
  const startBottom = site.start.support - LOG_SINK;
  const endBottom = site.end.support - LOG_SINK;

  const share = LANDING / walkwayLength(site);

  return Math.min(lerp(startBottom, endBottom, share), lerp(endBottom, startBottom, share));
}

function fitsLog(site: Site): boolean {
  const isShort = waterSpanOf(site) <= LOG_LONGEST_WATER && Math.abs(logPitch(site)) <= LOG_STEEPEST_PITCH;

  return isShort && lowestLogBottomOverWater(site) >= site.highest + LOG_CLEARANCE;
}

function isFordableWater(deepest: number, spread: number, span: number): boolean {
  return deepest <= FORD_DEEPEST && span <= FORD_LONGEST_WATER && spread <= FORD_LEVEL_SPREAD;
}

function fitsFord(site: Site): boolean {
  const isFordable = isFordableWater(site.deepest, site.highest - site.lowest, waterSpanOf(site));

  return isFordable && Math.max(site.start.rise, site.end.rise) <= FORD_HIGHEST_BANK;
}

function chooseKind(site: Site, fall: number): CrossingKind | null {
  const isNarrow = waterSpanOf(site) <= LOG_PREFERRED_WATER || site.deepest > LOG_DEEP_FORD;
  const isFordable = fall <= FORD_STEEPEST_FALL && fitsFord(site);

  if (fitsLog(site) && (isNarrow || !isFordable)) {
    return "log";
  }

  return isFordable ? "ford" : null;
}

function fitsKind(site: Site, kind: CrossingKind): boolean {
  return kind === "log" ? fitsLog(site) : fitsFord(site);
}

function siteSeed(grid: WorldGrid, center: Point): number {
  return hashToUnit(grid.columnAt(center.x), grid.rowAt(center.z), SEED_SALT);
}

function buildCrossing(site: Site, kind: CrossingKind, id: number, seed: number): Crossing {
  const { center, directionX, directionZ } = site;

  const startReach = site.start.edge + LANDING;
  const endReach = site.end.edge + LANDING;

  const span = {
    endX: center.x + directionX * endReach,
    endZ: center.z + directionZ * endReach,
    id,
    seed,
    startX: center.x - directionX * startReach,
    startZ: center.z - directionZ * startReach,
  };

  if (kind === "ford") {
    return { ...span, kind };
  }

  const draft: LogBridge = { ...span, endDeck: 0, kind, startDeck: 0 };

  return {
    ...draft,
    endDeck: site.end.support - LOG_SINK + 2 * logRadiusAt(draft, crossingLength(draft)),
    startDeck: site.start.support - LOG_SINK + 2 * logRadiusAt(draft, 0),
  };
}

function homeliness(survey: CrossingSurvey, cell: number): number {
  const { terrain } = survey;

  const swampy = terrain.ground[cell] === Ground.Swamp ? -0.4 : 0;

  return HOMELINESS[terrain.biome[cell]] + swampy;
}

function siteScore(survey: CrossingSurvey, site: Site, kind: CrossingKind): number {
  const { grid } = survey;
  const { center } = site;

  const flatness = -(site.start.slope + site.end.slope) * 3;
  const home = homeliness(survey, site.start.cell) + homeliness(survey, site.end.cell);
  const fit = kind === "ford" ? -site.deepest * 0.35 : -waterSpanOf(site) * 0.04;
  const jitter = hashToUnit(grid.columnAt(center.x), grid.rowAt(center.z), SITE_SALT) * 0.5;

  return flatness + home + fit + jitter;
}

function wadingAlong(survey: CrossingSurvey, crossing: Crossing): Wading | null {
  const { grid, isBlocked, terrain } = survey;

  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  let deepest = 0;
  let highest = Number.NEGATIVE_INFINITY;
  let lowest = Number.POSITIVE_INFINITY;

  for (let along = 0; along <= crossingLength(crossing); along += MARCH_STEP) {
    const point = pointOnCrossing(crossing, along, 0);
    const cell = grid.cellAt(point.x, point.z);

    if (!isOnIsland(terrain.coastDistance, cell) || isBlocked(cell)) {
      return null;
    }

    if (!isWaterCell(terrain, cell)) {
      continue;
    }

    if (!isRiverWater(survey, cell)) {
      return null;
    }

    first = Math.min(first, along);
    last = Math.max(last, along);
    deepest = Math.max(deepest, terrain.waterSurface[cell] - terrain.height[cell]);
    highest = Math.max(highest, terrain.waterSurface[cell]);
    lowest = Math.min(lowest, terrain.waterSurface[cell]);
  }

  return last < first ? null : { deepest, highest, lowest, span: last - first };
}

function hasSteadyBanks(survey: CrossingSurvey, crossing: Crossing): boolean {
  const { grid, terrain } = survey;

  return [grid.cellAt(crossing.startX, crossing.startZ), grid.cellAt(crossing.endX, crossing.endZ)].every((cell) => {
    return cell >= 0 && !isWaterCell(terrain, cell) && slopeAt(terrain.height, grid, cell) <= LENIENT_BANKS.approach;
  });
}

function logClearsWater(survey: CrossingSurvey, log: LogBridge): boolean {
  const { grid, terrain } = survey;

  for (let along = 0; along <= crossingLength(log); along += MARCH_STEP) {
    const point = pointOnCrossing(log, along, 0);
    const cell = grid.cellAt(point.x, point.z);
    const bottom = logDeckAt(log, along) - 2 * logRadiusAt(log, along);

    if (isWaterCell(terrain, cell) && bottom < terrain.waterSurface[cell] + LOG_CLEARANCE) {
      return false;
    }
  }

  return true;
}

function isCalmEnough(courses: readonly RiverCourse[], crossing: Crossing): boolean {
  return crossing.kind === "log" || fallUnder(courses, crossing) <= FORD_STEEPEST_FALL * FALL_TOLERANCE;
}

function stillStands(survey: CrossingSurvey, crossing: Crossing): boolean {
  const wading = wadingAlong(survey, crossing);

  if (wading === null || !hasSteadyBanks(survey, crossing)) {
    return false;
  }

  if (crossing.kind === "log") {
    return wading.span <= LOG_LONGEST_WATER && logClearsWater(survey, crossing);
  }

  return isFordableWater(wading.deepest, wading.highest - wading.lowest, wading.span);
}

function remeasure(survey: CrossingSurvey, crossing: Crossing): Crossing | null {
  const direction = crossingDirection(crossing);

  const site = measureSite(survey, {
    center: crossingMiddle(crossing),
    directionX: direction.x,
    directionZ: direction.z,
    limits: LENIENT_BANKS,
  });

  if (site === null || !fitsKind(site, crossing.kind)) {
    return null;
  }

  return buildCrossing(site, crossing.kind, crossing.id, crossing.seed);
}

class CrossingPlanner {
  readonly placed: Crossing[];
  readonly survey: CrossingSurvey;
  #nextId: number;

  constructor(survey: CrossingSurvey, kept: readonly Crossing[]) {
    this.survey = survey;
    this.placed = [...kept];
    this.#nextId = kept.reduce((highest, crossing) => {
      return Math.max(highest, crossing.id + 1);
    }, 0);
  }

  planRiver(course: RiverCourse, limits: BankLimits): void {
    if (course.length < SHORTEST_RIVER) {
      return;
    }

    const usableEnd = course.length - MOUTH_MARGIN;
    const anchors = this.#anchorsOn(course);
    const widening = wideningAlong(this.survey, course);

    let cursor =
      widening > SOURCE_MARGIN
        ? widening + SPACING_ALONG
        : SOURCE_MARGIN + Math.min(FIRST_OFFSET, (usableEnd - SOURCE_MARGIN) * 0.3);
    let anchorIndex = 0;

    while (cursor <= usableEnd) {
      const nextAnchor = anchorIndex < anchors.length ? anchors[anchorIndex] : Number.POSITIVE_INFINITY;

      if (nextAnchor <= cursor + WINDOW) {
        cursor = Math.max(cursor, nextAnchor + SPACING_ALONG);
        anchorIndex += 1;

        continue;
      }

      const last = Math.min(cursor + WINDOW, usableEnd, nextAnchor - SPACING_ALONG);
      const best = this.#bestIn(course, {
        connects: () => {
          return true;
        },
        from: cursor,
        limits,
        spacing: SPACING_ELSEWHERE,
        to: last,
      });

      if (best === null) {
        cursor += WINDOW;

        continue;
      }

      this.#place(best.crossing);
      cursor = best.along + SPACING_ALONG;
    }
  }

  linkBanks(courses: readonly RiverCourse[]): void {
    const { grid } = this.survey;

    const passages = Array.from({ length: grid.cellCount }, (_, cell) => {
      return passageIn(this.survey, cell);
    });
    const regions = new BankRegions(grid, passages, this.placed);

    for (const course of courses) {
      for (let along = SOURCE_MARGIN; along <= course.length - MOUTH_MARGIN; along += LINK_STEP) {
        const banks = banksAcross(this.survey, course, along, regions);

        if (banks === null || !regions.separates(banks.start, banks.end)) {
          continue;
        }

        const best = this.#bestIn(course, {
          connects: (crossing) => {
            return regions.wouldJoin(crossing);
          },
          from: Math.max(SOURCE_MARGIN, along - LINK_WINDOW),
          limits: LENIENT_BANKS,
          spacing: LINK_SPACING,
          to: Math.min(course.length - MOUTH_MARGIN, along + LINK_WINDOW),
        });

        if (best === null) {
          continue;
        }

        this.#place(best.crossing);
        regions.join(best.crossing);
      }
    }
  }

  #place(crossing: Crossing): void {
    this.placed.push(crossing);
    this.#nextId += 1;
  }

  #anchorsOn(course: RiverCourse): number[] {
    const anchors: number[] = [];

    for (const crossing of this.placed) {
      const nearest = nearestAlong(course, crossingMiddle(crossing));

      if (nearest.distance < ON_RIVER) {
        anchors.push(nearest.along);
      }
    }

    return anchors.sort((first, second) => {
      return first - second;
    });
  }

  #bestIn(course: RiverCourse, stretch: Stretch): Candidate | null {
    let best: Candidate | null = null;

    for (let along = stretch.from; along <= stretch.to; along += CANDIDATE_SPACING) {
      for (const turn of AXIS_TURNS) {
        const candidate = this.#candidateAt(course, along, turn, stretch);

        if (candidate !== null && (best === null || candidate.score > best.score)) {
          best = candidate;
        }
      }
    }

    return best;
  }

  #candidateAt(course: RiverCourse, along: number, turn: number, stretch: Stretch): Candidate | null {
    const center = pointAlong(course, along);

    if (!(this.#isClearOfFalls(center) && this.#isSpaced(center, stretch.spacing))) {
      return null;
    }

    const centerCell = this.survey.grid.cellAt(center.x, center.z);

    if (isBrookCell(this.survey.terrain, centerCell)) {
      return null;
    }

    const behind = pointAlong(course, along - TANGENT_REACH);
    const ahead = pointAlong(course, along + TANGENT_REACH);
    const across = Math.atan2(ahead.x - behind.x, -(ahead.z - behind.z)) + turn;

    const site = measureSite(this.survey, {
      center,
      directionX: Math.cos(across),
      directionZ: Math.sin(across),
      limits: stretch.limits,
    });

    if (site === null) {
      return null;
    }

    const fall = fallAlong(course, along);
    const kind = chooseKind(site, fall);

    if (kind === null) {
      return null;
    }

    const crossing = buildCrossing(site, kind, this.#nextId, siteSeed(this.survey.grid, center));

    if (!stretch.connects(crossing)) {
      return null;
    }

    return { along, crossing, score: siteScore(this.survey, site, kind) - Math.abs(turn) - fall * FALL_PENALTY };
  }

  #isClearOfFalls(point: Point): boolean {
    const { grid, lakeIds, water } = this.survey;

    const isNearFall = water.waterfalls.some((waterfall) => {
      return Math.hypot(waterfall.x - point.x, waterfall.z - point.z) < WATERFALL_CLEARANCE;
    });

    if (isNearFall) {
      return false;
    }

    return !isNearLake(grid, lakeIds, point.x, point.z, LAKE_CLEARANCE);
  }

  #isSpaced(point: Point, spacing: number): boolean {
    return this.placed.every((crossing) => {
      const middle = crossingMiddle(crossing);

      return Math.hypot(middle.x - point.x, middle.z - point.z) >= spacing;
    });
  }
}

export function planCrossings(survey: CrossingSurvey, kept: readonly Crossing[] = []): Crossing[] {
  const planner = new CrossingPlanner(survey, kept);
  const courses = riverCourses(survey.water);

  for (const limits of [STRICT_BANKS, LENIENT_BANKS]) {
    for (const course of courses) {
      planner.planRiver(course, limits);
    }
  }

  planner.linkBanks(courses);

  return planner.placed;
}

export function refreshCrossings(survey: CrossingSurvey, existing: readonly Crossing[]): Crossing[] {
  const courses = riverCourses(survey.water);

  const kept = existing.flatMap((crossing) => {
    if (!isCalmEnough(courses, crossing)) {
      return [];
    }

    if (stillStands(survey, crossing)) {
      return [crossing];
    }

    const refreshed = remeasure(survey, crossing);

    return refreshed === null ? [] : [refreshed];
  });

  return planCrossings(survey, kept);
}
