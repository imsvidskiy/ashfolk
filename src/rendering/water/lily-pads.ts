import {
  attribute,
  cameraPosition,
  cos,
  distance,
  Fn,
  float,
  mix,
  positionGeometry,
  select,
  sin,
  smoothstep,
  textureLoad,
  transformNormalToView,
  uniform,
  vec3,
} from "three/tsl";
import {
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshStandardNodeMaterial,
  type Node,
} from "three/webgpu";
import type { WorldMirror } from "../../game/world-mirror.ts";
import { FULL_TURN, smoothstep as smoothstepNumber } from "../../shared/math.ts";
import type { WorldGrid } from "../../world/world-grid.ts";
import { markOutlined } from "../outlines.ts";
import { POOL_BANK, poolReachNode } from "../terrain/bog-pools.ts";
import { cellAtNode, coarseGroundOffsetNode, sampleHeightNode } from "../terrain/height-sampling.ts";
import type { TerrainTextures } from "../terrain/terrain-textures.ts";
import { placeLilies, SHALLOWEST_LILY_WATER } from "./lily-placement.ts";

const LilyPart = {
  Heart: 2,
  Pad: 0,
  Petal: 1,
} as const;

const PAD_SEGMENTS = 10;
const NOTCH_ANGLE = 0.5;
const PETALS = 6;
const FLOATS_PER_LILY = 4;
const FLOWER_SCALE = 2;
const FLOAT_LIFT = 0.03;
const POOL_LIFT = 0.05;
const POOL_SHRINK = 0.2;
const NEAR_FADE = 450;
const FAR_FADE = 650;
const PAD_GREEN = vec3(0.13, 0.25, 0.07);
const PAD_YELLOW = vec3(0.3, 0.32, 0.1);
const WHITE_PETAL = vec3(0.92, 0.92, 0.86);
const PINK_PETAL = vec3(0.92, 0.55, 0.68);
const FLOWER_HEART = vec3(0.95, 0.75, 0.2);

interface LilyShape {
  readonly parts: number[];
  readonly positions: number[];
}

interface LilyUniforms {
  readonly bloom: Node<"float">;
  readonly presence: Node<"float">;
}

function padShape(): LilyShape {
  const positions: number[] = [];
  const parts: number[] = [];
  const sweep = FULL_TURN - NOTCH_ANGLE;

  for (let segment = 0; segment < PAD_SEGMENTS; segment += 1) {
    const from = NOTCH_ANGLE / 2 + (segment / PAD_SEGMENTS) * sweep;
    const to = NOTCH_ANGLE / 2 + ((segment + 1) / PAD_SEGMENTS) * sweep;

    positions.push(0, 0, 0, Math.cos(to), 0, Math.sin(to), Math.cos(from), 0, Math.sin(from));
    parts.push(LilyPart.Pad, LilyPart.Pad, LilyPart.Pad);
  }

  return { parts, positions };
}

function flowerShape(): LilyShape {
  const positions: number[] = [];
  const parts: number[] = [];
  const side = FULL_TURN / PETALS / 2.4;

  for (let petal = 0; petal < PETALS; petal += 1) {
    const angle = (petal / PETALS) * FULL_TURN;

    positions.push(
      0,
      0.02,
      0,
      Math.cos(angle - side) * 0.32,
      0.12,
      Math.sin(angle - side) * 0.32,
      Math.cos(angle) * 0.42,
      0.26,
      Math.sin(angle) * 0.42,
      0,
      0.02,
      0,
      Math.cos(angle) * 0.42,
      0.26,
      Math.sin(angle) * 0.42,
      Math.cos(angle + side) * 0.32,
      0.12,
      Math.sin(angle + side) * 0.32
    );
    parts.push(LilyPart.Petal, LilyPart.Petal, LilyPart.Petal, LilyPart.Petal, LilyPart.Petal, LilyPart.Petal);
  }

  for (let corner = 0; corner < 3; corner += 1) {
    const angle = (corner / 3) * FULL_TURN;

    positions.push(Math.cos(angle) * 0.1, 0.16, Math.sin(angle) * 0.1);
    parts.push(LilyPart.Heart);
  }

  return { parts, positions };
}

function createGeometry(shape: LilyShape, lilies: number[]): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  const normals = shape.positions.map((_value, index) => {
    return index % 3 === 1 ? 1 : 0;
  });

  geometry.setAttribute("position", new Float32BufferAttribute(shape.positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("lilyPart", new Float32BufferAttribute(shape.parts, 1));
  geometry.setAttribute("lily", new InstancedBufferAttribute(new Float32Array(lilies), FLOATS_PER_LILY));
  geometry.instanceCount = lilies.length / FLOATS_PER_LILY;

  return geometry;
}

function lilyPresenceFor(season: number): number {
  return Math.max(1 - smoothstepNumber(2.5, 2.95, season), smoothstepNumber(3.55, 3.95, season));
}

function lilyBloomFor(season: number): number {
  return smoothstepNumber(0.35, 0.7, season) * (1 - smoothstepNumber(2, 2.35, season));
}

function createLilyMaterial(
  textures: TerrainTextures,
  grid: WorldGrid,
  uniforms: LilyUniforms,
  isFlower: boolean
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ side: DoubleSide });

  const lily = attribute("lily", "vec4");
  const part = attribute("lilyPart", "float");

  const point = lily.xy;
  const size = lily.w.abs();
  const turn = lily.z;
  const cell = cellAtNode(grid, point);

  const ground = sampleHeightNode(textures.height, grid, point).add(coarseGroundOffsetNode(textures, grid, point));
  const water = textureLoad(textures.water, cell).x;
  const pool = poolReachNode(textures, grid, point);
  const frozen = smoothstep(0.1, 0.3, textureLoad(textures.surface, cell).r);
  const fade = smoothstep(FAR_FADE, NEAR_FADE, distance(vec3(point.x, ground, point.y), cameraPosition));

  const isFloating = water.greaterThan(ground.add(SHALLOWEST_LILY_WATER));
  const isInPool = pool.greaterThan(POOL_BANK + POOL_SHRINK);
  const level = select(isFloating, water.add(FLOAT_LIFT), ground.add(POOL_LIFT));
  const shown = select(isFloating.or(isInPool), float(1), float(0));
  const season = isFlower ? uniforms.bloom : uniforms.presence;
  const growth = isFlower ? FLOWER_SCALE : 1;

  const scale = size.mul(growth).mul(shown).mul(fade).mul(season).mul(float(1).sub(frozen));
  const local = positionGeometry.mul(scale);
  const cosine = cos(turn);
  const sine = sin(turn);

  material.positionNode = Fn(() => {
    return vec3(
      point.x.add(local.x.mul(cosine)).add(local.z.mul(sine)),
      level.add(local.y),
      point.y.add(local.z.mul(cosine)).sub(local.x.mul(sine))
    );
  })();

  const tint = smoothstep(0.2, 1, positionGeometry.xz.length()).mul(0.4);
  const petal = select(lily.w.lessThan(0), PINK_PETAL, WHITE_PETAL);

  material.colorNode = isFlower
    ? select(part.equal(LilyPart.Heart), FLOWER_HEART, petal)
    : mix(PAD_GREEN, PAD_YELLOW, tint);
  material.roughnessNode = float(isFlower ? 0.7 : 0.35);
  material.normalNode = transformNormalToView(vec3(0, 1, 0));

  markOutlined(material);

  return material;
}

export class LilyPads {
  readonly #bloom = uniform(0);
  readonly #flowers: Mesh<InstancedBufferGeometry, MeshStandardNodeMaterial>;
  readonly #pads: Mesh<InstancedBufferGeometry, MeshStandardNodeMaterial>;
  readonly #presence = uniform(0);

  constructor(mirror: WorldMirror, textures: TerrainTextures) {
    const uniforms = { bloom: this.#bloom, presence: this.#presence };

    this.#pads = new Mesh(new InstancedBufferGeometry(), createLilyMaterial(textures, mirror.grid, uniforms, false));
    this.#flowers = new Mesh(new InstancedBufferGeometry(), createLilyMaterial(textures, mirror.grid, uniforms, true));

    for (const mesh of [this.#pads, this.#flowers]) {
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
    }

    this.rebuild(mirror);
  }

  get meshes(): readonly Mesh[] {
    return [this.#pads, this.#flowers];
  }

  rebuild(mirror: WorldMirror): void {
    const placements = placeLilies(mirror);

    this.#pads.geometry.dispose();
    this.#flowers.geometry.dispose();
    this.#pads.geometry = createGeometry(padShape(), placements.pads);
    this.#flowers.geometry = createGeometry(flowerShape(), placements.flowers);
  }

  update(season: number): void {
    this.#presence.value = lilyPresenceFor(season);
    this.#bloom.value = lilyBloomFor(season) * this.#presence.value;
    this.#pads.visible = this.#presence.value > 0;
    this.#flowers.visible = this.#bloom.value > 0;
  }

  dispose(): void {
    for (const mesh of [this.#pads, this.#flowers]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}
