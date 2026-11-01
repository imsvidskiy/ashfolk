import {
  clamp,
  cos,
  Fn,
  float,
  floor,
  hash,
  instanceIndex,
  ivec2,
  length,
  max,
  mix,
  normalize,
  positionGeometry,
  select,
  sin,
  smoothstep,
  texture,
  textureLoad,
  transformNormalToView,
  uint,
  uniform,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import {
  BufferAttribute,
  type Camera,
  DoubleSide,
  InstancedBufferGeometry,
  Mesh,
  MeshStandardNodeMaterial,
  type Node,
  type Texture,
  Vector2,
  Vector3,
} from "three/webgpu";
import { clamp as clampNumber, FULL_TURN, inverseLerp, saturate } from "../../shared/math.ts";
import type { WorldGrid } from "../../world/world-grid.ts";
import { unitNoise } from "../node-helpers.ts";
import { POOL_BANK, poolReachNode } from "../terrain/bog-pools.ts";
import { fieldClearingNode } from "../terrain/field-ground.ts";
import { FIREWEED, fireweedNode } from "../terrain/fireweed.ts";
import { cellAtNode, mapCoordinatesNode, renderedHeightNode } from "../terrain/height-sampling.ts";
import type { TerrainTextures } from "../terrain/terrain-textures.ts";
import { gustAt, type PlantWeather } from "./plant-material.ts";

const BLADES_PER_CLUMP = 4;
const BLADE_OUTLINE: readonly (readonly [side: number, along: number])[] = [
  [-0.5, 0],
  [0.5, 0],
  [0, 1],
];
const BLADE_TRIANGLES: readonly number[] = [0, 1, 2];

const LATTICE_OFFSET = 32_768;
const LATTICE_ROW = 65_536;
const SALT_JITTER_X = 0x68_e3_1d_a4;
const SALT_JITTER_Z = 0xb5_29_7a_4d;
const SALT_PRESENCE = 0x1b_56_c4_e9;
const SALT_SPREAD = 0x2c_1b_3c_6d;
const SALT_BLADE = 0x7f_4a_7c_15;
const SALTS_PER_BLADE = 31;

const SHORTEST_BLADE = 0.3;
const TALLEST_BLADE = 0.75;
const NARROWEST_BLADE = 0.14;
const WIDEST_BLADE = 0.24;
const ROOT_SINK = 0.08;
const CLUMP_SPREAD = 0.24;

const FADE_START_REACH = 0.6;
const AHEAD_REACH = 0.8;
const LEVEL_LOOK = 0.5;
const MINIMUM_AHEAD = 0.05;

const SNOW_START = 0.06;
const SNOW_END = 0.3;
const DRY_MARGIN = 0.05;

const NEAREST_SPACING = 0.45;
const FARTHEST_SPACING = 1.05;
const SPACING_STEP = 0.15;
const SPACING_PER_DISTANCE = 0.011;
const SHORTEST_REED = 1.1;
const TALLEST_REED = 2.3;
const REED_NARROWING = 0.55;
const REED_STIFFNESS = 0.35;
const REED_CLUMP_SCALE = 0.16;
const REED_GREEN = vec3(0.2, 0.27, 0.09);
const REED_TIP = vec3(0.5, 0.45, 0.22);
const FADE_START_DISTANCE = 130;
const FADE_END_DISTANCE = 190;

interface GrassFieldOptions {
  readonly clumpsPerSide: number;
  readonly grid: WorldGrid;
  readonly textures: TerrainTextures;
  readonly understory: Texture;
  readonly weather: PlantWeather;
}

interface GrassUniforms {
  readonly center: Node<"vec2">;
  readonly presence: Node<"float">;
  readonly spacing: Node<"float">;
}

function createClumpGeometry(clumpCount: number): InstancedBufferGeometry {
  const vertexCount = BLADES_PER_CLUMP * BLADE_OUTLINE.length;
  const indices: number[] = [];
  const shape = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);

  for (let blade = 0; blade < BLADES_PER_CLUMP; blade += 1) {
    const firstVertex = blade * BLADE_OUTLINE.length;

    for (const [vertex, [side, along]] of BLADE_OUTLINE.entries()) {
      shape.set([side, along, blade], (firstVertex + vertex) * 3);
      normals.set([0, 1, 0], (firstVertex + vertex) * 3);
    }

    for (const corner of BLADE_TRIANGLES) {
      indices.push(firstVertex + corner);
    }
  }

  const geometry = new InstancedBufferGeometry();

  geometry.setAttribute("position", new BufferAttribute(shape, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.instanceCount = clumpCount;

  return geometry;
}

function spacingFor(viewDistance: number): number {
  const wanted = clampNumber(viewDistance * SPACING_PER_DISTANCE, NEAREST_SPACING, FARTHEST_SPACING);

  return NEAREST_SPACING + Math.round((wanted - NEAREST_SPACING) / SPACING_STEP) * SPACING_STEP;
}

function presenceFor(viewDistance: number): number {
  return 1 - saturate(inverseLerp(FADE_START_DISTANCE, FADE_END_DISTANCE, viewDistance));
}

function createGrassMaterial(options: GrassFieldOptions, uniforms: GrassUniforms): MeshStandardNodeMaterial {
  const { clumpsPerSide, grid, textures, understory, weather } = options;
  const { center, presence, spacing } = uniforms;

  const material = new MeshStandardNodeMaterial({ side: DoubleSide });
  const last = grid.cellsPerSide - 1;
  const perSide = float(clumpsPerSide);
  const instance = float(instanceIndex);
  const side = positionGeometry.x;
  const along = positionGeometry.y;
  const blade = positionGeometry.z;

  const lattice = floor(center.div(spacing))
    .sub(Math.floor(clumpsPerSide / 2))
    .add(vec2(instance.mod(perSide), floor(instance.div(perSide))));

  const key = uint(lattice.x.add(LATTICE_OFFSET))
    .mul(LATTICE_ROW)
    .add(uint(lattice.y.add(LATTICE_OFFSET)));

  function random(salt: number): Node<"float"> {
    return hash(key.bitXor(salt));
  }

  function bladeRandom(salt: number): Node<"float"> {
    return hash(key.bitXor(SALT_BLADE).add(uint(blade.mul(SALTS_PER_BLADE).add(salt))));
  }

  const root = lattice.add(vec2(random(SALT_JITTER_X), random(SALT_JITTER_Z))).mul(spacing);

  const rootUv = mapCoordinatesNode(grid, root);
  const ground = texture(textures.groundAlbedo.texture, rootUv).level(float(0));
  const cell = cellAtNode(grid, root);
  const height = renderedHeightNode(textures, grid, root);

  const surface = textureLoad(textures.surface, cell);
  const understoryCover = texture(understory, rootUv).level(float(0)).x;
  const wetland = texture(textures.wetland, rootUv).level(float(0));
  const footprint = floor(root.add(grid.halfSize).div(grid.cellSize).sub(0.5));

  function waterAt(column: number, row: number): Node<"float"> {
    return textureLoad(textures.water, ivec2(clamp(footprint.add(vec2(column, row)), vec2(0, 0), vec2(last, last)))).x;
  }

  const nearestWater = max(max(waterAt(0, 0), waterAt(1, 0)), max(waterAt(0, 1), waterAt(1, 1)));
  const isDry = nearestWater.lessThan(height.add(DRY_MARGIN));
  const isOnIsland = textures.outline.insideNode(root);
  const fordPath = textures.fords.pathNode(root);
  const reach = length(root.sub(center)).div(perSide.mul(spacing).mul(0.5));

  const reed = smoothstep(0.45, 0.8, wetland.r);
  const poolFree = float(1).sub(smoothstep(POOL_BANK * 0.5, POOL_BANK, poolReachNode(textures, grid, root)));
  const clump = unitNoise(root.mul(REED_CLUMP_SCALE));

  const cover = max(ground.a, reed.mul(mix(float(0.3), float(1), clump)))
    .mul(poolFree)
    .mul(understoryCover)
    .mul(float(1).sub(smoothstep(SNOW_START, SNOW_END, surface.r)))
    .mul(float(1).sub(surface.b))
    .mul(float(1).sub(fordPath))
    .mul(float(1).sub(fieldClearingNode(textures, grid, root)))
    .mul(float(1).sub(smoothstep(FADE_START_REACH, 1, reach)))
    .mul(select(isDry.and(isOnIsland), float(1), float(0)))
    .mul(presence);

  const growth = clamp(cover.sub(random(SALT_PRESENCE)).mul(5), 0, 1);

  const grassHeight = mix(float(SHORTEST_BLADE), float(TALLEST_BLADE), bladeRandom(3)).mul(
    mix(float(0.65), float(1), ground.a)
  );
  const reedHeight = mix(float(SHORTEST_REED), float(TALLEST_REED), bladeRandom(3));
  const bladeHeight = mix(grassHeight, reedHeight, reed).mul(growth);
  const bladeWidth = mix(float(NARROWEST_BLADE), float(WIDEST_BLADE), bladeRandom(5))
    .mul(mix(float(1), float(REED_NARROWING), reed))
    .mul(growth);
  const facingAngle = bladeRandom(7).mul(FULL_TURN);
  const spreadAngle = blade.mul(FULL_TURN / BLADES_PER_CLUMP).add(random(SALT_SPREAD).mul(FULL_TURN));
  const leanAngle = bladeRandom(11).mul(FULL_TURN);

  const facing = vec2(cos(facingAngle), sin(facingAngle));
  const spread = vec2(cos(spreadAngle), sin(spreadAngle)).mul(spacing.mul(CLUMP_SPREAD));
  const lean = vec2(cos(leanAngle), sin(leanAngle)).mul(
    bladeRandom(13).mul(mix(float(0.35), float(REED_STIFFNESS * 0.35), reed))
  );
  const wave = gustAt(weather, root);
  const curve = along.mul(along);

  const bend = lean.add(weather.wind.mul(weather.gust).mul(wave.mul(0.28).add(0.14)));

  const offset = facing.mul(side.mul(bladeWidth)).add(bend.mul(curve.mul(bladeHeight)));
  const rise = along.mul(bladeHeight).mul(float(1).sub(curve.mul(length(bend)).mul(0.25)));

  const bladeNormal = normalize(vec3(facing.y.negate().mul(0.35), 1, facing.x.mul(0.35)).add(vec3(bend.x, 0, bend.y)));
  const tint = bladeRandom(17).mul(0.3).add(0.85);

  material.positionNode = Fn(() => {
    return vec3(
      root.x.add(spread.x).add(offset.x),
      height.sub(ROOT_SINK).add(rise),
      root.y.add(spread.y).add(offset.y)
    );
  })();

  const shadedGround = ground.rgb.mul(mix(float(0.68), float(1.22), along)).mul(tint);
  const grassLeaf = mix(shadedGround, shadedGround.mul(vec3(1.08, 1.1, 0.82)), curve);
  const reedLeaf = mix(
    REED_GREEN.mul(mix(float(0.55), float(1.15), along)).mul(tint),
    REED_TIP,
    curve.mul(bladeRandom(23).mul(0.7))
  );
  const leafColor = mix(grassLeaf, reedLeaf, reed);
  const isFlowering = bladeRandom(19).lessThan(fireweedNode(surface.b, textures.bloom).mul(0.7));
  const bladeColor = mix(leafColor, FIREWEED, select(isFlowering, smoothstep(0.55, 0.85, along), float(0)));

  material.colorNode = varying(mix(ground.rgb, bladeColor, growth), "grassColor");
  material.normalNode = transformNormalToView(varying(bladeNormal, "grassNormal"));
  material.roughnessNode = float(0.9);

  return material;
}

export class GrassField {
  readonly mesh: Mesh;
  readonly #center = uniform(new Vector2());
  readonly #clumpsPerSide: number;
  readonly #forward = new Vector3();
  readonly #presence = uniform(1);
  readonly #spacing = uniform(NEAREST_SPACING);

  constructor(options: GrassFieldOptions) {
    this.#clumpsPerSide = options.clumpsPerSide;

    const geometry = createClumpGeometry(options.clumpsPerSide * options.clumpsPerSide);
    const uniforms = { center: this.#center, presence: this.#presence, spacing: this.#spacing };

    this.mesh = new Mesh(geometry, createGrassMaterial(options, uniforms));
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
  }

  update(camera: Camera, viewDistance: number): void {
    const presence = presenceFor(viewDistance);
    const spacing = spacingFor(viewDistance);

    camera.getWorldDirection(this.#forward);

    const radius = (this.#clumpsPerSide * spacing) / 2;
    const ahead = Math.hypot(this.#forward.x, this.#forward.z);
    const shift = radius * AHEAD_REACH * Math.min(1, ahead / LEVEL_LOOK);

    this.mesh.visible = presence > 0;
    this.#presence.value = presence;
    this.#spacing.value = spacing;
    this.#center.value.set(camera.position.x, camera.position.z);

    if (ahead > MINIMUM_AHEAD) {
      this.#center.value.x += (this.#forward.x / ahead) * shift;
      this.#center.value.y += (this.#forward.z / ahead) * shift;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
