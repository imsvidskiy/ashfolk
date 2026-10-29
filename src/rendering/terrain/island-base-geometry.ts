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
const NORMAL_UNDERSIDE_DEPTH = 1650;
const UNDERSIDE_RINGS = 14;
const UNDERSIDE_COLUMNS = 512;
const NARROWEST_UNDERSIDE_STRIDE = 4;
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

interface RingVertex {
  readonly cliffAmount: number;
  readonly depth: number;
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

function cliffRings(bands: number): RingVertex[] {
  const rings: RingVertex[] = [];

  for (let ring = 0; ring <= bands; ring += 1) {
    rings.push({ cliffAmount: 1 - ring / bands, depth: 0 });
  }

  return rings;
}

function undersideRings(): RingVertex[] {
  const rings: RingVertex[] = [];

  for (let ring = 1; ring <= UNDERSIDE_RINGS; ring += 1) {
    rings.push({ cliffAmount: 0, depth: ring / UNDERSIDE_RINGS });
  }

  return rings;
}

export function islandPlinthHeight(mirror: WorldMirror, outline: IslandOutline): number {
  let lowest = Number.POSITIVE_INFINITY;

  for (const point of islandPerimeter(mirror, outline)) {
    lowest = Math.min(lowest, sampleHeight(mirror.terrain.height, mirror.grid, point.x, point.z));
  }

  return lowest - CLIFF_DROP;
}

function undersideReach(depth: number): number {
  return 1 - 0.97 * depth ** 0.62;
}

function roundedRadius(outline: BaseOutline, x: number, z: number, depth: number): number {
  const rimRadius = Math.hypot(x, z);
  const circleRadius = outline.grid.halfSize * outline.undersideRadius;

  return rimRadius + (circleRadius - rimRadius) * smoothstep(0, 0.45, depth);
}

function placeVertex(outline: BaseOutline, point: PerimeterPoint, ring: RingVertex): readonly [number, number, number] {
  const { noise, plinth } = outline;
  const { x, z } = point;

  const angle = Math.atan2(z, x);
  const ridges = noise.fractal(Math.cos(angle) * 9, ring.depth * 2.4, Math.sin(angle) * 9, { octaves: 3 });
  const lumps = noise.fractal(x * 0.0021, ring.depth * 3.1 + 7, z * 0.0021, { octaves: 3 });

  if (ring.depth === 0) {
    const bulge = outline.rimOffset + CLIFF_BULGE * (1 - ring.cliffAmount) * (0.6 + 0.4 * Math.abs(lumps + ridges));

    return [x + point.outwardX * bulge, plinth, z + point.outwardZ * bulge];
  }

  const radius =
    roundedRadius(outline, x, z, ring.depth) * undersideReach(ring.depth) * (1 + ridges * 0.09 + lumps * 0.12);
  const spikes =
    Math.max(0, noise.fractal(Math.cos(angle) * 23, 4.2, Math.sin(angle) * 23, { octaves: 2 })) * ring.depth ** 2;

  const drop = ring.depth ** 1.1 * outline.undersideDepth * (1 + spikes * 0.45) + lumps * 60 * ring.depth;

  return [Math.cos(angle) * radius, plinth - drop, Math.sin(angle) * radius];
}

function finishGeometry(positions: readonly number[], indices: readonly number[]): BufferGeometry {
  const geometry = new BufferGeometry();

  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));

  return geometry;
}

function pushStrips(indices: number[], pointCount: number, ringCount: number, firstVertex: number): void {
  for (let point = 0; point < pointCount; point += 1) {
    const next = (point + 1) % pointCount;

    for (let ring = 0; ring < ringCount - 1; ring += 1) {
      const current = firstVertex + point * ringCount + ring;
      const following = firstVertex + next * ringCount + ring;

      indices.push(current, following, current + 1, following, following + 1, current + 1);
    }
  }
}

function buildCliff(outline: BaseOutline): BufferGeometry {
  const rings = cliffRings(outline.cliffBands);
  const positions: number[] = [];
  const topPoints: number[] = [];
  const cliffAmounts: number[] = [];
  const outwards: number[] = [];
  const indices: number[] = [];

  for (const point of outline.points) {
    for (const ring of rings) {
      positions.push(...placeVertex(outline, point, ring));
      topPoints.push(point.x, point.z);
      cliffAmounts.push(ring.cliffAmount);
      outwards.push(point.outwardX, point.outwardZ);
    }
  }

  pushStrips(indices, outline.points.length, rings.length, 0);

  const geometry = finishGeometry(positions, indices);

  geometry.setAttribute("topPoint", new Float32BufferAttribute(topPoints, 2));
  geometry.setAttribute("cliffAmount", new Float32BufferAttribute(cliffAmounts, 1));
  geometry.setAttribute("outward", new Float32BufferAttribute(outwards, 2));
  geometry.computeVertexNormals();

  return geometry;
}

function pushStitch(indices: number[], rimCount: number, stride: number, ringCount: number): void {
  const coarseCount = Math.ceil(rimCount / stride);

  for (let coarse = 0; coarse < coarseCount; coarse += 1) {
    const below = rimCount + coarse * ringCount;
    const nextBelow = rimCount + ((coarse + 1) % coarseCount) * ringCount;
    const firstRim = coarse * stride;
    const lastRim = Math.min(firstRim + stride, rimCount);

    for (let rim = firstRim; rim < lastRim; rim += 1) {
      indices.push(rim, (rim + 1) % rimCount, below);
    }

    indices.push(lastRim % rimCount, nextBelow, below);
  }
}

function buildUnderside(outline: BaseOutline): BufferGeometry {
  const rimRing: RingVertex = { cliffAmount: 0, depth: 0 };
  const rings = undersideRings();
  const stride = Math.max(NARROWEST_UNDERSIDE_STRIDE, Math.round(outline.points.length / UNDERSIDE_COLUMNS));
  const coarsePoints = outline.points.filter((_, index) => {
    return index % stride === 0;
  });

  const positions: number[] = [];
  const indices: number[] = [];

  for (const point of outline.points) {
    positions.push(...placeVertex(outline, point, rimRing));
  }

  for (const point of coarsePoints) {
    for (const ring of rings) {
      positions.push(...placeVertex(outline, point, ring));
    }
  }

  const tip = positions.length / 3;

  positions.push(0, outline.plinth - outline.undersideDepth * 1.12, 0);
  pushStitch(indices, outline.points.length, stride, rings.length);
  pushStrips(indices, coarsePoints.length, rings.length, outline.points.length);

  for (let point = 0; point < coarsePoints.length; point += 1) {
    const next = (point + 1) % coarsePoints.length;
    const lowest = outline.points.length + rings.length - 1;

    indices.push(lowest + point * rings.length, lowest + next * rings.length, tip);
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
