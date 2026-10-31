import {
  attribute,
  cameraPosition,
  distance,
  float,
  max,
  mix,
  positionWorld,
  smoothstep,
  time,
  vec2,
  vec3,
} from "three/tsl";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  Uint32BufferAttribute,
} from "three/webgpu";
import { saturate } from "../../shared/math.ts";
import { type CellRegion, regionsOverlap } from "../../world/change-tracking.ts";
import type { Waterfall } from "../../world/water.ts";
import type { WorldGrid } from "../../world/world-grid.ts";
import { unitNoise, unitNoise3 } from "../node-helpers.ts";
import type { IslandOutline } from "../terrain/island-outline.ts";
import type { TerrainTextures } from "../terrain/terrain-textures.ts";

const FALL_HEIGHT = 1150;
const GRAVITY = 9.8;
const LAUNCH_SPEED = 1.2;
const ALONG_SEGMENTS = 48;
const FADE_START = 0.2;
const FADE_END = 0.62;
const ROW_CROWDING = 1.7;
const SEGMENT_LENGTH = 1.5;
const LONGEST_CROSSING = 40;
const CROSSING_STEPS = 24;
const SPAN_STEP = 0.25;
const WIDEST_HALF_SPAN = 40;
const SPAN_INSET = 0.6;
const SHORE_SAMPLE_CELLS = 2;
const NARROWEST_SPAN = 3;
const FACE_CLEARANCE = 15;
const BOTTOM_SPREAD = 1.4;
const WATER_TINT = vec3(0.42, 0.6, 0.64);
const TINTED_DROP = 5;

interface Lip {
  readonly centerX: number;
  readonly centerZ: number;
  readonly left: number;
  readonly outwardX: number;
  readonly outwardZ: number;
  readonly right: number;
  readonly top: number;
}

interface CurtainWriter {
  readonly coordinates: number[];
  readonly drops: number[];
  readonly indices: number[];
  readonly positions: number[];
  readonly progress: number[];
  readonly sides: number[];
}

function lipCrossing(waterfall: Waterfall, outline: IslandOutline): readonly [number, number] {
  const { directionX, directionZ, x, z } = waterfall;

  let inside = 0;
  let outside = 0;

  for (let reach = SEGMENT_LENGTH; reach <= LONGEST_CROSSING; reach += SEGMENT_LENGTH) {
    if (outline.isInside(x - directionX * reach, z - directionZ * reach)) {
      inside = reach;

      break;
    }
  }

  if (inside === 0 || outline.isInside(x, z)) {
    return outline.atCoast(x, z);
  }

  for (let step = 0; step < CROSSING_STEPS; step += 1) {
    const middle = (inside + outside) / 2;

    if (outline.isInside(x - directionX * middle, z - directionZ * middle)) {
      inside = middle;
    } else {
      outside = middle;
    }
  }

  return [x - directionX * inside, z - directionZ * inside];
}

function wetEdge(lip: Omit<Lip, "left" | "right">, side: 1 | -1, textures: TerrainTextures): number {
  const sideX = -lip.outwardZ * side;
  const sideZ = lip.outwardX * side;
  const baseX = lip.centerX - lip.outwardX * SPAN_INSET;
  const baseZ = lip.centerZ - lip.outwardZ * SPAN_INSET;

  let previous = textures.shoreDepthAt(baseX, baseZ);

  for (let reach = SPAN_STEP; reach <= WIDEST_HALF_SPAN; reach += SPAN_STEP) {
    const depth = textures.shoreDepthAt(baseX + sideX * reach, baseZ + sideZ * reach);

    if (depth <= 0) {
      const share = previous > depth ? previous / (previous - depth) : 1;

      return reach - SPAN_STEP * (1 - saturate(share));
    }

    previous = depth;
  }

  return WIDEST_HALF_SPAN;
}

function findLip(waterfall: Waterfall, textures: TerrainTextures): Lip {
  const [centerX, centerZ] = lipCrossing(waterfall, textures.outline);
  const [outwardX, outwardZ] = textures.outline.outwardAt(centerX, centerZ);

  const lip = { centerX, centerZ, outwardX, outwardZ, top: waterfall.top };
  const left = wetEdge(lip, -1, textures);
  const right = wetEdge(lip, 1, textures);

  if (left + right < NARROWEST_SPAN) {
    return { ...lip, left: waterfall.width / 2, right: waterfall.width / 2 };
  }

  return { ...lip, left, right };
}

function faceOffset(drop: number, faceDepth: number): number {
  const launch = LAUNCH_SPEED * Math.sqrt((2 * drop) / GRAVITY);

  return launch + FACE_CLEARANCE * saturate(drop / faceDepth) ** 0.7;
}

function acrossSegments(lip: Lip): number {
  return Math.max(4, Math.ceil((lip.left + lip.right) / SEGMENT_LENGTH));
}

function addCurtain(writer: CurtainWriter, lip: Lip, outline: IslandOutline, plinth: number): void {
  const faceDepth = Math.max(1, lip.top - plinth);
  const across = acrossSegments(lip);
  const sideX = -lip.outwardZ;
  const sideZ = lip.outwardX;
  const firstVertex = writer.progress.length;
  const width = lip.left + lip.right;

  for (let along = 0; along <= ALONG_SEGMENTS; along += 1) {
    const amount = FADE_END * (along / ALONG_SEGMENTS) ** ROW_CROWDING;
    const drop = amount * FALL_HEIGHT;
    const outward = faceOffset(drop, faceDepth);
    const spread = 1 + (BOTTOM_SPREAD - 1) * amount;

    for (let step = 0; step <= across; step += 1) {
      const sideAmount = step / across;
      const offset = -lip.left + sideAmount * width;
      const [rimX, rimZ] = outline.atCoast(lip.centerX + sideX * offset, lip.centerZ + sideZ * offset);
      const spreadX = sideX * offset * (spread - 1);
      const spreadZ = sideZ * offset * (spread - 1);

      writer.positions.push(
        rimX + lip.outwardX * outward + spreadX,
        lip.top - drop,
        rimZ + lip.outwardZ * outward + spreadZ
      );
      writer.coordinates.push(offset * spread * 0.25, drop * 0.05 + outward * 0.05);
      writer.drops.push(drop);
      writer.progress.push(amount);
      writer.sides.push(sideAmount);
    }
  }

  const rowLength = across + 1;

  for (let along = 0; along < ALONG_SEGMENTS; along += 1) {
    for (let step = 0; step < across; step += 1) {
      const corner = firstVertex + along * rowLength + step;
      const below = corner + rowLength;

      writer.indices.push(corner, below, corner + 1, corner + 1, below, below + 1);
    }
  }
}

function createCurtainMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    depthWrite: false,
    forceSinglePass: true,
    side: DoubleSide,
    transparent: true,
  });
  const coordinates = attribute("fallCoordinates", "vec2");
  const progress = attribute("fallProgress", "float");
  const sideAmount = attribute("fallSide", "float");
  const drop = attribute("fallDrop", "float");

  const streaks = unitNoise(vec2(coordinates.x.mul(0.45), coordinates.y.sub(time.mul(1.4))));
  const spray = unitNoise3(vec3(coordinates.x.mul(5), coordinates.y.mul(3).sub(time.mul(3)), 7));

  const mist = max(smoothstep(0.08, 0.45, progress), smoothstep(600, 2400, distance(positionWorld, cameraPosition)));
  const edges = smoothstep(0, 0.06, sideAmount).mul(smoothstep(1, 0.94, sideAmount));
  const fade = float(1).sub(smoothstep(FADE_START, FADE_END, progress));
  const falling = smoothstep(0, TINTED_DROP, drop);

  const sheet = mix(smoothstep(0.3, 0.75, streaks.mul(0.75).add(spray.mul(0.25))), float(0.5), mist);
  const fallColor = mix(vec3(0.72, 0.84, 0.9), vec3(1, 1, 1), sheet);

  material.colorNode = mix(WATER_TINT, fallColor, falling);
  material.opacityNode = mix(float(0.85), sheet.mul(0.3).add(0.6), falling).mul(edges).mul(fade);

  return material;
}

export class WaterfallView {
  readonly mesh: Mesh<BufferGeometry, MeshBasicNodeMaterial>;
  #lips: readonly Lip[] = [];

  constructor() {
    this.mesh = new Mesh(new BufferGeometry(), createCurtainMaterial());
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  rebuild(waterfalls: readonly Waterfall[], textures: TerrainTextures, plinth: number): void {
    const writer: CurtainWriter = { coordinates: [], drops: [], indices: [], positions: [], progress: [], sides: [] };

    this.#lips = waterfalls.map((waterfall) => {
      return findLip(waterfall, textures);
    });

    for (const lip of this.#lips) {
      addCurtain(writer, lip, textures.outline, plinth);
    }

    const geometry = new BufferGeometry();

    geometry.setAttribute("position", new Float32BufferAttribute(writer.positions, 3));
    geometry.setAttribute("fallCoordinates", new Float32BufferAttribute(writer.coordinates, 2));
    geometry.setAttribute("fallDrop", new Float32BufferAttribute(writer.drops, 1));
    geometry.setAttribute("fallProgress", new Float32BufferAttribute(writer.progress, 1));
    geometry.setAttribute("fallSide", new Float32BufferAttribute(writer.sides, 1));
    geometry.setIndex(new Uint32BufferAttribute(writer.indices, 1));

    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;
    this.mesh.visible = writer.indices.length > 0;
  }

  isShapedBy(region: CellRegion | null, grid: WorldGrid): boolean {
    if (region === null) {
      return false;
    }

    const reach = SPAN_INSET + WIDEST_HALF_SPAN + grid.cellSize * SHORE_SAMPLE_CELLS;

    return this.#lips.some((lip) => {
      return regionsOverlap(region, grid.circleBounds(lip.centerX, lip.centerZ, reach));
    });
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
