import { clamp, hashToUnit, lerp, smoothstep } from "../shared/math.ts";
import { sampleHeight } from "../world/terrain-sampling.ts";
import {
  pondEdgeReach,
  pondOutlineExtent,
  pondOutlineRadius,
  type River,
  type RiverPoint,
  type Spring,
} from "../world/water.ts";
import type { WorldGrid } from "../world/world-grid.ts";
import { isNearLake } from "./drainage.ts";
import { pondCut, pondFits, pondShoreReach } from "./ponds.ts";
import { SOURCE_REACH } from "./river-spacing.ts";

const CAVE_SLOPE = 0.35;
const SLOPE_REACHES = [10, 20, 30] as const;
const DIRECTION_REACH = 25;
const LAKE_REACH_CELLS = 2;
const SMALLEST_POND = 12.5;
const SMALLEST_DRAWN_POND = 16;
const POND_SIZE_SPAN = 72;
const POND_SIZE_SKEW = 1.3;
const LARGEST_POND = 95;
const POND_FLOW_DOUBLINGS = 4;
const POND_FLOW_SCALE = { least: 0.8, most: 1.3 } as const;
const POND_FLAT_BONUS = 1.2;
const POND_FLAT_SLOPE = { flat: 0.03, steep: 0.12 } as const;
const POND_OUTLET_SHARE = 0.85;
const SEAT_STEP = 40;
const SEAT_REACH = 200;
const SEAT_RIVER_SHARE = 0.4;
const JOIN_REACH_CELLS = 2;
const POND_SHRINK = 0.86;
const POND_SHAPES = 10;
const POND_RIM = 5;
const POND_COAST_CLEARANCE = 30;
const POND_LAKE_CLEARANCE = 30;
const RIVER_CLEARANCE = 12;
const HEAD_CLEARANCE = 30;
const SPRING_CLEARANCE = 15;
const NARROWEST_CAVE = 6.5;
const WIDEST_CAVE = 10;
const CAVE_SETBACK = 3;
const CAVE_DEPTH = 3;
const CAVE_FLOOR_DEPTH = 1.2;
const CAVE_MASS_SETBACK = 3;
const CAVE_MASS_MARGIN = 6;
const SPRING_SALT = 83.1;
const SIZE_SALT = 17.3;
const SHAPE_SALT = 29.9;

interface SpringSiting {
  readonly coastDistance: Float32Array;
  readonly grid: WorldGrid;
  readonly heights: Float32Array;
  readonly lakeIds: Int32Array;
  readonly riverThreshold: number;
}

interface SpringPlan {
  readonly channels: (readonly RiverPoint[])[];
  readonly rivers: River[];
  readonly springs: Spring[];
}

interface Direction {
  readonly x: number;
  readonly z: number;
}

interface SpringNeighbors {
  readonly rivers: readonly River[];
  readonly springs: readonly Spring[];
}

interface SpringPlanEntry {
  readonly channel: readonly RiverPoint[] | null;
  readonly river: River;
  readonly spring: Spring;
}

interface SpringSite {
  readonly direction: Direction;
  readonly head: RiverPoint;
  readonly river: River;
  readonly seed: number;
  readonly sizing: number;
  readonly slope: number;
}

interface SeatedPond {
  readonly pond: Spring;
  readonly site: SpringSite;
}

function downstreamDirection(river: River): Direction | null {
  const [head] = river.points;

  const ahead = river.points.find((point) => {
    return Math.hypot(point.x - head.x, point.z - head.z) >= DIRECTION_REACH;
  });
  const target = ahead === undefined ? river.points.at(-1) : ahead;

  if (target === undefined) {
    return null;
  }

  const length = Math.hypot(target.x - head.x, target.z - head.z);

  if (length < 1e-3) {
    return null;
  }

  return { x: (target.x - head.x) / length, z: (target.z - head.z) / length };
}

function slopeBehind(siting: SpringSiting, head: RiverPoint, direction: Direction): number {
  const { grid, heights } = siting;

  const ground = sampleHeight(heights, grid, head.x, head.z);

  let steepest = 0;

  for (const reach of SLOPE_REACHES) {
    const behind = sampleHeight(heights, grid, head.x - direction.x * reach, head.z - direction.z * reach);

    steepest = Math.max(steepest, (behind - ground) / reach);
  }

  return steepest;
}

function isFedByLake(siting: SpringSiting, head: RiverPoint): boolean {
  const { grid, lakeIds } = siting;

  return isNearLake(grid, lakeIds, head.x, head.z, grid.cellSize * LAKE_REACH_CELLS);
}

function pondRadius(site: SpringSite, threshold: number): number {
  const mouth = site.river.points.at(-1);
  const flow = mouth === undefined ? site.head.flow : mouth.flow;

  const drawn = SMALLEST_DRAWN_POND + POND_SIZE_SPAN * site.sizing ** POND_SIZE_SKEW;
  const flowShare = clamp(Math.log2(Math.max(1, flow / threshold)) / POND_FLOW_DOUBLINGS, 0, 1);
  const flatness = 1 - smoothstep(POND_FLAT_SLOPE.flat, POND_FLAT_SLOPE.steep, site.slope);
  const scale = lerp(POND_FLOW_SCALE.least, POND_FLOW_SCALE.most, flowShare) * lerp(1, POND_FLAT_BONUS, flatness);

  return Math.min(LARGEST_POND, drawn * scale);
}

function caveWidth(site: SpringSite): number {
  return clamp(site.head.width * 1.4 + 2.5 + 2 * site.sizing, NARROWEST_CAVE, WIDEST_CAVE);
}

function channelPoint(head: RiverPoint, x: number, z: number, width: number, depth: number): RiverPoint {
  return { depth, flow: head.flow, surface: head.surface, width, x, z };
}

function pondAround(site: SpringSite, radius: number, seed: number): Spring {
  const { direction, head } = site;

  const shape: Spring = {
    cells: [],
    directionX: direction.x,
    directionZ: direction.z,
    kind: "pond",
    level: head.surface,
    radius,
    river: site.river.id,
    seed,
    x: head.x,
    z: head.z,
  };
  const outlet = pondOutlineRadius(shape, Math.atan2(direction.z, direction.x)) * POND_OUTLET_SHARE;

  return { ...shape, x: head.x - direction.x * outlet, z: head.z - direction.z * outlet };
}

function shapeSeed(site: SpringSite, shape: number): number {
  return hashToUnit(site.seed, shape, SHAPE_SALT);
}

function isInland(siting: SpringSiting, pond: Spring): boolean {
  const { coastDistance, grid, lakeIds } = siting;

  if (sampleHeight(coastDistance, grid, pond.x, pond.z) < pondShoreReach(pond) + POND_COAST_CLEARANCE) {
    return false;
  }

  return !isNearLake(grid, lakeIds, pond.x, pond.z, pondOutlineExtent(pond) + POND_LAKE_CLEARANCE);
}

function crowdsOtherRiver(pond: Spring, river: River): boolean {
  const extent = pondOutlineExtent(pond);

  return river.points.some((point, index) => {
    const clearance = index === 0 ? HEAD_CLEARANCE : point.width / 2 + RIVER_CLEARANCE;

    if (Math.hypot(point.x - pond.x, point.z - pond.z) > extent + clearance) {
      return false;
    }

    return pondEdgeReach(pond, point.x, point.z) > -clearance;
  });
}

function turnsBackIntoPond(pond: Spring, river: River): boolean {
  const leaving = river.points.findIndex((point) => {
    return pondEdgeReach(pond, point.x, point.z) < -(point.width / 2 + RIVER_CLEARANCE);
  });

  if (leaving < 0) {
    return false;
  }

  return river.points.slice(leaving).some((point) => {
    return pondEdgeReach(pond, point.x, point.z) > -point.width / 2;
  });
}

function crowdsSpring(pond: Spring, spring: Spring): boolean {
  if (spring.kind === "pond") {
    return Math.hypot(spring.x - pond.x, spring.z - pond.z) < pondShoreReach(pond) + pondShoreReach(spring);
  }

  return pondEdgeReach(pond, spring.x, spring.z) > -(spring.radius + SPRING_CLEARANCE + POND_RIM);
}

function isClearOfNeighbors(neighbors: SpringNeighbors, own: River, pond: Spring): boolean {
  const isRiverCrowded = neighbors.rivers.some((river) => {
    return river.id === own.id ? turnsBackIntoPond(pond, own) : crowdsOtherRiver(pond, river);
  });

  if (isRiverCrowded) {
    return false;
  }

  return !neighbors.springs.some((spring) => {
    return crowdsSpring(pond, spring);
  });
}

function bestShapeAt(
  siting: SpringSiting,
  neighbors: SpringNeighbors,
  site: SpringSite,
  radius: number
): Spring | null {
  let best: Spring | null = null;
  let leastCut = Number.POSITIVE_INFINITY;

  for (let shape = 0; shape < POND_SHAPES; shape += 1) {
    const pond = pondAround(site, radius, shapeSeed(site, shape));

    if (!(isInland(siting, pond) && pondFits(siting.grid, siting.heights, pond))) {
      continue;
    }

    if (!isClearOfNeighbors(neighbors, site.river, pond)) {
      continue;
    }

    const cut = pondCut(siting.grid, siting.heights, pond);

    if (cut < leastCut) {
      best = pond;
      leastCut = cut;
    }
  }

  return best;
}

function fittedPond(siting: SpringSiting, neighbors: SpringNeighbors, seats: readonly SpringSite[]): SeatedPond | null {
  const wanted = Math.max(
    ...seats.map((seat) => {
      return pondRadius(seat, siting.riverThreshold);
    })
  );

  for (let radius = wanted; ; radius = Math.max(SMALLEST_POND, radius * POND_SHRINK)) {
    for (const site of seats) {
      const pond = bestShapeAt(siting, neighbors, site, radius);

      if (pond !== null) {
        return { pond, site };
      }
    }

    if (radius <= SMALLEST_POND) {
      return null;
    }
  }
}

function pondSpring(siting: SpringSiting, { pond, site }: SeatedPond): SpringPlanEntry {
  const { grid } = siting;

  const cells = grid.cellsInRadius(pond.x, pond.z, pondOutlineExtent(pond) + POND_RIM).filter((cell) => {
    return pondEdgeReach(pond, grid.cellCenterX(cell), grid.cellCenterZ(cell)) > -POND_RIM;
  });

  return { channel: null, river: site.river, spring: { ...pond, cells } };
}

function caveSpring(siting: SpringSiting, site: SpringSite): SpringPlanEntry {
  const { direction, head, seed } = site;

  const width = caveWidth(site);

  const mouthX = head.x - direction.x * CAVE_SETBACK;
  const mouthZ = head.z - direction.z * CAVE_SETBACK;
  const massX = mouthX - direction.x * CAVE_MASS_SETBACK;
  const massZ = mouthZ - direction.z * CAVE_MASS_SETBACK;

  return {
    channel: [
      channelPoint(head, mouthX - direction.x * CAVE_DEPTH, mouthZ - direction.z * CAVE_DEPTH, width, CAVE_FLOOR_DEPTH),
      channelPoint(head, head.x, head.z, width, CAVE_FLOOR_DEPTH),
    ],
    river: site.river,
    spring: {
      cells: siting.grid.cellsInRadius(massX, massZ, width / 2 + CAVE_MASS_MARGIN),
      directionX: direction.x,
      directionZ: direction.z,
      kind: "cave",
      level: head.surface,
      radius: width / 2,
      river: site.river.id,
      seed,
      x: mouthX,
      z: mouthZ,
    },
  };
}

function siteAt(siting: SpringSiting, river: River, origin: RiverPoint): SpringSite | null {
  const [head] = river.points;

  const direction = downstreamDirection(river);

  if (direction === null || isFedByLake(siting, head)) {
    return null;
  }

  const column = siting.grid.columnAt(origin.x);
  const row = siting.grid.rowAt(origin.z);

  return {
    direction,
    head,
    river,
    seed: hashToUnit(column, row, SPRING_SALT),
    sizing: hashToUnit(column, row, SIZE_SALT),
    slope: slopeBehind(siting, head, direction),
  };
}

function distancesAlong(river: River): number[] {
  let along = 0;

  return river.points.map((point, index) => {
    const previous = river.points[Math.max(0, index - 1)];

    along += Math.hypot(point.x - previous.x, point.z - previous.z);

    return along;
  });
}

function firstJoin(siting: SpringSiting, rivers: readonly River[], river: River): number {
  const reach = siting.grid.cellSize * JOIN_REACH_CELLS;
  const ends = rivers.flatMap((other) => {
    const end = other.points.at(-1);

    return other.id === river.id || end === undefined ? [] : [end];
  });

  const joined = river.points.findIndex((point) => {
    return ends.some((end) => {
      return Math.hypot(end.x - point.x, end.z - point.z) < reach;
    });
  });

  return joined < 0 ? river.points.length - 1 : joined;
}

function seatIndices(siting: SpringSiting, rivers: readonly River[], river: River): number[] {
  const alongs = distancesAlong(river);
  const length = alongs.at(-1);

  if (length === undefined) {
    return [0];
  }

  const reach = Math.min(
    SEAT_REACH,
    length * SEAT_RIVER_SHARE,
    alongs[firstJoin(siting, rivers, river)] - SOURCE_REACH
  );
  const indices = [0];

  for (const [index, along] of alongs.entries()) {
    if (along > reach) {
      break;
    }

    if (along >= indices.length * SEAT_STEP) {
      indices.push(index);
    }
  }

  return indices;
}

function seatsOf(siting: SpringSiting, rivers: readonly River[], site: SpringSite): SpringSite[] {
  const { head, river } = site;

  return seatIndices(siting, rivers, river).flatMap((index) => {
    if (index === 0) {
      return [site];
    }

    const seat = siteAt(siting, { ...river, points: river.points.slice(index) }, head);

    return seat === null || seat.slope >= CAVE_SLOPE ? [] : [seat];
  });
}

function springAt(siting: SpringSiting, neighbors: SpringNeighbors, site: SpringSite): SpringPlanEntry {
  if (site.slope >= CAVE_SLOPE) {
    return caveSpring(siting, site);
  }

  const seated = fittedPond(siting, neighbors, seatsOf(siting, neighbors.rivers, site));

  if (seated === null) {
    return caveSpring(siting, site);
  }

  return pondSpring(siting, seated);
}

export function placeSprings(siting: SpringSiting, rivers: readonly River[]): SpringPlan {
  const channels: (readonly RiverPoint[])[] = [];
  const seatedRivers = [...rivers];
  const springs: Spring[] = [];

  for (const river of rivers) {
    const site = siteAt(siting, river, river.points[0]);

    if (site === null) {
      continue;
    }

    const entry = springAt(siting, { rivers: seatedRivers, springs }, site);

    if (entry.channel !== null) {
      channels.push(entry.channel);
    }

    seatedRivers[river.id] = entry.river;
    springs.push(entry.spring);
  }

  return { channels, rivers: seatedRivers, springs };
}
