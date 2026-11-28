import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from "three/webgpu";
import type { WorldMirror } from "../../game/world-mirror.ts";
import { smoothstep } from "../../shared/math.ts";
import { createVolumeNoise, type VolumeNoise } from "../../shared/noise.ts";
import { createRandom } from "../../shared/random.ts";
import { islandSpanShare } from "../../world/island-size.ts";
import { sampleHeight } from "../../world/terrain-sampling.ts";
import type { WorldGrid } from "../../world/world-grid.ts";
import type { CoastPoint, IslandOutline } from "./island-outline.ts";

const CLIFF_DROP = 60;
const SQUARE_CLIFF_BANDS = 6;
const COAST_CLIFF_BANDS = 1;

const NORMAL_UNDERSIDE_DEPTH = 1450;
const UNDERSIDE_RINGS = 30;
const MAXIMUM_RING_COLUMNS = 320;
const MINIMUM_RING_COLUMNS = 12;
const CLIFF_BULGE = 9;
const SQUARE_RIM_OFFSET = 0.4;
const COAST_RIM_OFFSET = -0.4;
const SQUARE_UNDERSIDE_RADIUS = 1.08;
const COAST_UNDERSIDE_RADIUS = 0.98;

interface PerimeterPoint {
  readonly outwardX: number;
  readonly outwardZ: number;
  readonly x: number;
  readonly z: number;
}

interface Ring {
  readonly count: number;
  readonly start: number;
}

interface BaseOutline {
  readonly cliffBands: number;
  readonly grid: WorldGrid;
  readonly noise: VolumeNoise;
  readonly plinth: number;
  readonly points: readonly PerimeterPoint[];
  readonly rimOffset: number;
  readonly undersideDepth: number;
  readonly undersideRadius: number;
}

interface IslandBaseGeometry {
  readonly cliff: BufferGeometry;
  readonly underside: BufferGeometry;
}

function squarePerimeter(grid: WorldGrid): PerimeterPoint[] {
  const points: PerimeterPoint[] = [];
  const last = grid.cellsPerSide - 1;

  function push(column: number, row: number, outwardX: number, outwardZ: number): void {
    points.push({ outwardX, outwardZ, x: grid.centerX(column), z: grid.centerZ(row) });
  }

  for (let column = 0; column < last; column += 1) {
    push(column, 0, 0, -1);
  }

  for (let row = 0; row < last; row += 1) {
    push(last, row, 1, 0);
  }

  for (let column = last; column > 0; column -= 1) {
    push(column, last, 0, 1);
  }

  for (let row = last; row > 0; row -= 1) {
    push(0, row, -1, 0);
  }

  return points;
}

function coastPerimeter(coast: readonly CoastPoint[]): PerimeterPoint[] {
  return coast.map(({ angle, radius }) => {
    const outwardX = Math.cos(angle);
    const outwardZ = Math.sin(angle);

    return { outwardX, outwardZ, x: outwardX * radius, z: outwardZ * radius };
  });
}

function islandPerimeter(mirror: WorldMirror, outline: IslandOutline): PerimeterPoint[] {
  if (outline.coast === null) {
    return squarePerimeter(mirror.grid);
  }

  return coastPerimeter(outline.coast);
}

export function islandPlinthHeight(mirror: WorldMirror, outline: IslandOutline): number {
  let lowest = Number.POSITIVE_INFINITY;

  for (const point of islandPerimeter(mirror, outline)) {
    lowest = Math.min(lowest, sampleHeight(mirror.terrain.height, mirror.grid, point.x, point.z));
  }

  return lowest - CLIFF_DROP;
}

function cliffBulge(outline: BaseOutline, point: PerimeterPoint): number {
  const angle = Math.atan2(point.z, point.x);
  const ridges = outline.noise.fractal(Math.cos(angle) * 9, 0, Math.sin(angle) * 9, { octaves: 3 });
  const lumps = outline.noise.fractal(point.x * 0.0021, 7, point.z * 0.0021, { octaves: 3 });

  return CLIFF_BULGE * (0.6 + 0.4 * Math.abs(lumps + ridges));
}

function finishGeometry(positions: readonly number[], indices: readonly number[]): BufferGeometry {
  const geometry = new BufferGeometry();

  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));

  return geometry;
}

function pushStrips(indices: number[], pointCount: number, ringCount: number): void {
  for (let point = 0; point < pointCount; point += 1) {
    const next = (point + 1) % pointCount;

    for (let ring = 0; ring < ringCount - 1; ring += 1) {
      const current = point * ringCount + ring;
      const following = next * ringCount + ring;

      indices.push(current, following, current + 1, following, following + 1, current + 1);
    }
  }
}

function buildCliff(outline: BaseOutline): BufferGeometry {
  const positions: number[] = [];
  const topPoints: number[] = [];
  const cliffAmounts: number[] = [];
  const outwards: number[] = [];
  const indices: number[] = [];

  for (const point of outline.points) {
    const bulge = cliffBulge(outline, point);

    for (let band = 0; band <= outline.cliffBands; band += 1) {
      const share = band / outline.cliffBands;
      const offset = outline.rimOffset + bulge * share;

      positions.push(point.x + point.outwardX * offset, outline.plinth, point.z + point.outwardZ * offset);
      topPoints.push(point.x, point.z);
      cliffAmounts.push(1 - share);
      outwards.push(point.outwardX, point.outwardZ);
    }
  }

  pushStrips(indices, outline.points.length, outline.cliffBands + 1);

  const geometry = finishGeometry(positions, indices);

  geometry.setAttribute("topPoint", new Float32BufferAttribute(topPoints, 2));
  geometry.setAttribute("cliffAmount", new Float32BufferAttribute(cliffAmounts, 1));
  geometry.setAttribute("outward", new Float32BufferAttribute(outwards, 2));
  geometry.computeVertexNormals();

  return geometry;
}

function joinRings(indices: number[], upper: Ring, lower: Ring): void {
  let top = 0;
  let bottom = 0;

  while (top < upper.count || bottom < lower.count) {
    const upperVertex = upper.start + (top % upper.count);
    const lowerVertex = lower.start + (bottom % lower.count);

    if ((top + 1) * lower.count <= (bottom + 1) * upper.count) {
      top += 1;
      indices.push(upperVertex, upper.start + (top % upper.count), lowerVertex);
    } else {
      bottom += 1;
      indices.push(upperVertex, lower.start + (bottom % lower.count), lowerVertex);
    }
  }
}

function buildUnderside(outline: BaseOutline): BufferGeometry {
  const { grid, noise, plinth, points, undersideDepth } = outline;
  const positions: number[] = [];
  const indices: number[] = [];

  for (const point of points) {
    const offset = outline.rimOffset + cliffBulge(outline, point);

    positions.push(point.x + point.outwardX * offset, plinth, point.z + point.outwardZ * offset);
  }

  const widest = Math.min(MAXIMUM_RING_COLUMNS, points.length);
  const innerRadius = grid.halfSize * outline.undersideRadius;
  const bottomX = grid.halfSize * 0.095 * noise.sample(2, 9, 3);
  const bottomZ = grid.halfSize * 0.095 * noise.sample(3, 9, 2);
  let upper: Ring = { count: points.length, start: 0 };

  for (let ring = 1; ring < UNDERSIDE_RINGS; ring += 1) {
    const angle = (ring / UNDERSIDE_RINGS) * (Math.PI / 2);
    const depth = Math.sin(angle);
    const reach = Math.cos(angle) * (1 - 0.34 * depth);
    const rounding = smoothstep(0, 0.85, depth);
    const relief = depth * (1 - depth);
    const count = Math.max(MINIMUM_RING_COLUMNS, 4 * Math.round((widest * reach) / 4));
    const lower: Ring = { count, start: positions.length / 3 };

    for (let column = 0; column < count; column += 1) {
      const point = points[Math.floor((column * points.length) / count)];
      const rimRadius = Math.hypot(point.x, point.z);
      const outwardX = point.x / rimRadius;
      const outwardZ = point.z / rimRadius;
      const radius = reach * (rimRadius + (innerRadius - rimRadius) * rounding);
      const folds = noise.fractal(outwardX * reach * 3.5, depth * 1.7 + 6, outwardZ * reach * 3.5, { octaves: 2 });
      const erodedRadius = radius * (1 + folds * relief * 0.6);

      positions.push(
        outwardX * erodedRadius + bottomX * depth ** 2,
        plinth - undersideDepth * (depth + folds * relief * 0.14),
        outwardZ * erodedRadius + bottomZ * depth ** 2
      );
    }

    joinRings(indices, upper, lower);
    upper = lower;
  }

  const bottom = positions.length / 3;

  positions.push(bottomX, plinth - undersideDepth, bottomZ);

  for (let column = 0; column < upper.count; column += 1) {
    indices.push(upper.start + column, upper.start + ((column + 1) % upper.count), bottom);
  }

  const geometry = finishGeometry(positions, indices);

  geometry.computeVertexNormals();

  return geometry;
}

export function buildIslandBaseGeometry(
  mirror: WorldMirror,
  outline: IslandOutline,
  plinth: number
): IslandBaseGeometry {
  const points = islandPerimeter(mirror, outline);
  const isSquare = outline.coast === null;

  const base: BaseOutline = {
    cliffBands: isSquare ? SQUARE_CLIFF_BANDS : COAST_CLIFF_BANDS,
    grid: mirror.grid,
    noise: createVolumeNoise(createRandom(mirror.seed + 17)),
    plinth,
    points,
    rimOffset: isSquare ? SQUARE_RIM_OFFSET : COAST_RIM_OFFSET,
    undersideDepth: NORMAL_UNDERSIDE_DEPTH * islandSpanShare(mirror.grid),
    undersideRadius: isSquare ? SQUARE_UNDERSIDE_RADIUS : COAST_UNDERSIDE_RADIUS,
  };

  return { cliff: buildCliff(base), underside: buildUnderside(base) };
}
