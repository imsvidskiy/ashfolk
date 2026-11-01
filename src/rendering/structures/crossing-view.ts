import {
  abs,
  attribute,
  cos,
  Fn,
  float,
  int,
  max,
  mix,
  normalize,
  normalLocal,
  normalView,
  normalWorld,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  textureLoad,
  transformNormalToView,
  varying,
  vec3,
} from "three/tsl";
import {
  BufferGeometry,
  type Frustum,
  Group,
  Mesh,
  MeshStandardNodeMaterial,
  type Node,
  type PerspectiveCamera,
  PlaneGeometry,
  Sphere,
  Vector3,
} from "three/webgpu";
import type { WorldMirror } from "../../game/world-mirror.ts";
import type { MeshData } from "../../models/mesh/mesh-data.ts";
import {
  buildFallenLogs,
  buildSteppingStones,
  CROSSING_DETAIL_LEVELS,
  FALLEN_LOG_LENGTHS,
  FALLEN_LOG_ROOT_RADIUS,
  fallenLogVariant,
  STEPPING_STONE_HEIGHT,
  STONE_WIDTH,
} from "../../models/structures/crossings.ts";
import { fractionalPart, smoothstep as smoothstepNumber } from "../../shared/math.ts";
import {
  type Crossing,
  crossingLength,
  crossingMiddle,
  type Ford,
  fallenLog,
  type LogBridge,
  pointOnCrossing,
  STEPPING_STONE_VARIANTS,
} from "../../world/crossings.ts";
import { NO_WATER } from "../../world/water.ts";
import type { WorldGrid } from "../../world/world-grid.ts";
import { geometryFromMeshData, InstanceBatch, toInstancedGeometry } from "../instancing.ts";
import { MODEL_ROUGHNESS, modelColor, styleModel } from "../model-style.ts";
import { rotateAroundUp, SNOW_COLOR, slotColorTable, snowCoverNode } from "../node-helpers.ts";
import { markOutlined } from "../outlines.ts";
import { cellAtNode, groundOffsetNode } from "../terrain/height-sampling.ts";
import type { TerrainTextures } from "../terrain/terrain-textures.ts";
import { assignSphereLevels, HIDDEN_LEVEL } from "../view-input.ts";
import { drawnWaterDepthNode } from "../water/water-material.ts";
import { sampleWaterSurface } from "../water/water-surface.ts";
import { type BarPoint, type FordStone, layFord } from "./ford-layout.ts";
import {
  createBarGeometry,
  createBarMaterial,
  createFoamMaterial,
  FOAM_FIELDS,
  sunkenBedColorNode,
} from "./ford-materials.ts";

const LEVEL_DISTANCES: readonly number[] = [150, 650, 3600];
const SHADOW_LEVEL_COUNT = 2;
const FOAM_LEVEL_COUNT = 2;
const FOAM_BATCH = -1;
const FOAM_WAKE = 3.2;
const FOAM_ABOVE = 0.15;
const FLOW_PROBE = 8;
const BOUNDS_MARGIN = 4;
const WET_STONE = vec3(0.55, 0.58, 0.52);
const COVERED_DEPTH = 0.12;
const SINKING_START = 0.02;
const SUNK_DEPTH = 0.22;
const WATERLINE_BAND = 0.06;
const WATERLINE_FOAM_SHARE = 0.35;
const WATERLINE_FOAM = vec3(0.84, 0.89, 0.9);

const CROSSING_CHANNELS = ["shade", "slot"] as const;

const CROSSING_FIELDS = [
  { name: "crossingPlacement", size: 4 },
  { name: "crossingShape", size: 4 },
  { name: "crossingLook", size: 4 },
] as const;

interface PlacedPiece {
  readonly batch: number;
  readonly data: readonly number[];
}

interface FordFlow {
  readonly angle: number;
  readonly strength: number;
}

interface PlacedCrossing {
  readonly bar: readonly (readonly BarPoint[])[];
  readonly bounds: Sphere;
  level: number;
  readonly pieces: readonly PlacedPiece[];
}

function pitched(vector: Node<"vec3">, angle: Node<"float">): Node<"vec3"> {
  const cosine = cos(angle);
  const sine = sin(angle);

  return vec3(vector.x.mul(cosine).sub(vector.y.mul(sine)), vector.x.mul(sine).add(vector.y.mul(cosine)), vector.z);
}

function createCrossingMaterial(textures: TerrainTextures, grid: WorldGrid): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  const placement = attribute("crossingPlacement", "vec4");
  const shape = attribute("crossingShape", "vec4");
  const look = attribute("crossingLook", "vec4");
  const slot = int(attribute("slot", "float").add(0.5));
  const shade = attribute("shade", "float");

  const ground = vec3(0, groundOffsetNode(textures, grid, placement.xz).mul(look.z), 0);

  material.positionNode = Fn(() => {
    normalLocal.assign(normalize(rotateAroundUp(pitched(normalLocal.div(shape.xyz), shape.w), placement.w)));

    return rotateAroundUp(pitched(positionLocal.mul(shape.xyz), shape.w), placement.w)
      .add(placement.xyz)
      .add(ground);
  })();

  const cell = cellAtNode(grid, placement.xz);

  const snow = varying(snowCoverNode(textureLoad(textures.surface, cell)), "crossingSnow");
  const base = modelColor(slotColorTable().element(slot).mul(shade).mul(look.y), "crossingColor");

  const belowWater = look.x.sub(positionWorld.y);
  const covered = smoothstep(0, COVERED_DEPTH, drawnWaterDepthNode(textures, grid));
  const wetness = smoothstep(-0.08, 0.2, belowWater).mul(covered);
  const sinking = smoothstep(SINKING_START, SUNK_DEPTH, belowWater).mul(covered);
  const snowOnTop = snow.mul(smoothstep(0.3, 0.8, normalWorld.y)).mul(float(1).sub(wetness));

  const wet = mix(base, base.mul(WET_STONE), wetness);
  const sunken = mix(wet, sunkenBedColorNode(max(belowWater, 0)), sinking);
  const waterline = smoothstep(WATERLINE_BAND, 0.01, abs(positionWorld.y.sub(look.x))).mul(WATERLINE_FOAM_SHARE);

  material.colorNode = mix(mix(sunken, WATERLINE_FOAM, waterline.mul(covered)), SNOW_COLOR, snowOnTop);
  styleModel(material);
  material.normalNode = normalize(mix(normalView, transformNormalToView(vec3(0, 1, 0)), sinking));
  material.roughnessNode = mix(float(MODEL_ROUGHNESS), float(0.55), wetness);

  markOutlined(material, float(1).sub(sinking));

  return material;
}

function fordFlowOf(mirror: WorldMirror, ford: Ford): FordFlow {
  const middle = crossingLength(ford) / 2;
  const upstream = pointOnCrossing(ford, middle, -FLOW_PROBE);
  const downstream = pointOnCrossing(ford, middle, FLOW_PROBE);

  const fall = mirror.waterLevelAt(upstream.x, upstream.z) - mirror.waterLevelAt(downstream.x, downstream.z);
  const sign = fall < 0 ? -1 : 1;
  const directionX = (downstream.x - upstream.x) * sign;
  const directionZ = (downstream.z - upstream.z) * sign;

  return { angle: Math.atan2(directionX, directionZ), strength: Math.min(1, 0.35 + Math.abs(fall) * 4) };
}

function logPiece(bridge: LogBridge): PlacedPiece {
  const log = fallenLog(bridge);
  const horizontal = Math.hypot(log.tipX - log.rootX, log.tipZ - log.rootZ);
  const rise = log.tipBottom - log.rootBottom;
  const variant = fallenLogVariant(horizontal, bridge.seed);
  const radius = log.rootRadius / FALLEN_LOG_ROOT_RADIUS;

  return {
    batch: STEPPING_STONE_VARIANTS + variant,
    data: [
      log.rootX,
      log.rootBottom,
      log.rootZ,
      Math.atan2(-(log.tipZ - log.rootZ), log.tipX - log.rootX),
      Math.hypot(horizontal, rise) / FALLEN_LOG_LENGTHS[variant % FALLEN_LOG_LENGTHS.length],
      radius,
      radius,
      Math.atan2(rise, horizontal),
      NO_WATER,
      0.92 + 0.16 * bridge.seed,
      0,
      0,
    ],
  };
}

function stonePiece(stone: FordStone): PlacedPiece {
  const width = (stone.radius * 2) / STONE_WIDTH;

  return {
    batch: stone.variant,
    data: [
      stone.x,
      stone.bottom,
      stone.z,
      stone.rotation,
      width,
      (stone.top - stone.bottom) / STEPPING_STONE_HEIGHT,
      width,
      stone.pitch,
      stone.waterLevel,
      0.86 + 0.28 * fractionalPart(stone.rotation * 7.3),
      stone.isGrounded ? 1 : 0,
      0,
    ],
  };
}

function foamPiece(stone: FordStone, flow: FordFlow): PlacedPiece {
  const above = smoothstepNumber(-FOAM_ABOVE, 0.05, stone.top - stone.waterLevel);

  return {
    batch: FOAM_BATCH,
    data: [
      stone.x,
      stone.waterLevel,
      stone.z,
      flow.angle,
      stone.radius,
      stone.radius * FOAM_WAKE * flow.strength,
      fractionalPart(stone.rotation * 3.1) * 40,
      0.35 + 0.65 * above,
    ],
  };
}

export class CrossingView {
  readonly group = new Group();
  readonly #all: readonly InstanceBatch[];
  readonly #batches: readonly (readonly InstanceBatch[])[];
  readonly #bar: Mesh<BufferGeometry, MeshStandardNodeMaterial>;
  readonly #foam: InstanceBatch;
  readonly #mirror: WorldMirror;
  readonly #textures: TerrainTextures;
  #isDirty = true;
  #placed: PlacedCrossing[] = [];

  constructor(mirror: WorldMirror, textures: TerrainTextures) {
    this.#mirror = mirror;
    this.#textures = textures;

    const material = createCrossingMaterial(textures, mirror.grid);

    this.#batches = CROSSING_DETAIL_LEVELS.map((level, levelIndex) => {
      return [...buildSteppingStones(level), ...buildFallenLogs(level)].map((model) => {
        return this.#createBatch(model, material, levelIndex < SHADOW_LEVEL_COUNT);
      });
    });

    this.#foam = new InstanceBatch(
      toInstancedGeometry(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
      createFoamMaterial(),
      FOAM_FIELDS,
      64
    );
    this.#foam.mesh.renderOrder = 3;
    this.#all = [...this.#batches.flat(), this.#foam];
    this.#bar = new Mesh(new BufferGeometry(), createBarMaterial(textures, mirror.grid));
    this.#bar.receiveShadow = true;
    this.group.add(this.#foam.mesh, this.#bar);

    this.rebuild();
  }

  rebuild(): void {
    this.#placed = this.#mirror.crossings
      .map((crossing) => {
        return this.#place(crossing);
      })
      .filter((placed) => {
        return placed.pieces.length > 0;
      });
    this.#isDirty = true;

    this.#bar.geometry.dispose();
    this.#bar.geometry = createBarGeometry(
      this.#placed
        .map((placed) => {
          return placed.bar;
        })
        .filter((bar) => {
          return bar.length > 1;
        })
    );
  }

  update(camera: PerspectiveCamera, frustum: Frustum, detail: number): void {
    const hasNewLevels = assignSphereLevels(this.#placed, camera, frustum, LEVEL_DISTANCES, detail);

    if (!(hasNewLevels || this.#isDirty)) {
      return;
    }

    this.#isDirty = false;
    this.#refill();
  }

  dispose(): void {
    for (const batch of this.#all) {
      batch.dispose();
    }

    this.#bar.geometry.dispose();
    this.#bar.material.dispose();
  }

  #refill(): void {
    for (const batch of this.#all) {
      batch.begin();
    }

    for (const crossing of this.#placed) {
      if (crossing.level === HIDDEN_LEVEL) {
        continue;
      }

      const isNear = crossing.level < FOAM_LEVEL_COUNT;

      for (const piece of crossing.pieces) {
        const isFoam = piece.batch === FOAM_BATCH;

        if (isFoam && !isNear) {
          continue;
        }

        const batch = isFoam ? this.#foam : this.#batches[crossing.level][piece.batch];

        batch.add(piece.data);
      }
    }

    for (const batch of this.#all) {
      batch.commit();
    }
  }

  #createBatch(model: MeshData, material: MeshStandardNodeMaterial, shouldCastShadow: boolean): InstanceBatch {
    const batch = new InstanceBatch(geometryFromMeshData(model, CROSSING_CHANNELS), material, CROSSING_FIELDS, 16);

    batch.mesh.castShadow = shouldCastShadow;
    batch.mesh.receiveShadow = true;
    this.group.add(batch.mesh);

    return batch;
  }

  #place(crossing: Crossing): PlacedCrossing {
    const { bar, pieces } =
      crossing.kind === "ford" ? this.#fordOf(crossing) : { bar: [], pieces: [logPiece(crossing)] };

    const middle = crossingMiddle(crossing);
    const bounds = new Sphere(
      new Vector3(middle.x, this.#mirror.heightAt(middle.x, middle.z), middle.z),
      crossingLength(crossing) / 2 + BOUNDS_MARGIN
    );

    return { bar, bounds, level: HIDDEN_LEVEL, pieces };
  }

  #fordOf(ford: Ford): { bar: readonly (readonly BarPoint[])[]; pieces: PlacedPiece[] } {
    const mirror = this.#mirror;
    const textures = this.#textures;
    const flow = fordFlowOf(mirror, ford);

    const { bar, stones } = layFord(ford, {
      heightAt: (x, z) => {
        return mirror.heightAt(x, z);
      },
      shoreDepthAt: (x, z) => {
        return textures.shoreDepthAt(x, z);
      },
      waterLevelAt: (x, z) => {
        return mirror.waterLevelAt(x, z);
      },
      waterSurfaceAt: (x, z) => {
        return sampleWaterSurface(mirror.terrain, mirror.grid, x, z);
      },
    });

    const foam = stones
      .filter((stone) => {
        return (stone.kind === "step" || stone.kind === "boulder") && stone.top > stone.waterLevel - FOAM_ABOVE;
      })
      .map((stone) => {
        return foamPiece(stone, flow);
      });

    return { bar, pieces: [...stones.map(stonePiece), ...foam] };
  }
}
