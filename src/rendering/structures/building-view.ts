import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Group,
  type InstancedBufferGeometry,
  type MeshStandardNodeMaterial,
  Sphere,
  Vector3,
} from "three/webgpu";
import { type BuildingKind, isEnclosure, isLitCampfire } from "../../content/buildings.ts";
import { DEPOSIT_KINDS, MINED_DEPOSIT_KINDS } from "../../content/deposits.ts";
import type { WorldMirror } from "../../game/world-mirror.ts";
import type { MeshData } from "../../models/mesh/mesh-data.ts";
import { buildBuildingModel, SINGLE_MODEL_KINDS } from "../../models/structures/building-models.ts";
import {
  buildEnclosurePiece,
  ENCLOSURE_FOOTING_DEPTH,
  ENCLOSURE_SEGMENT_LENGTH,
  type EnclosureKind,
  type EnclosurePiece,
} from "../../models/structures/enclosures.ts";
import { buildMineModel, MINE_SCALE, type MineOre } from "../../models/structures/mine-model.ts";
import { clamp, FULL_TURN, saturate } from "../../shared/math.ts";
import type { BuildingView as BuildingSnapshot, SimulationFrame } from "../../simulation/frame.ts";
import type { WorldGrid } from "../../world/world-grid.ts";
import { columnVisibility, extentOf, type ObjectExtent } from "../camera-fade.ts";
import { geometryFromMeshData, InstanceBatch, toInstancedGeometry, writeVec4 } from "../instancing.ts";
import type { TerrainTextures } from "../terrain/terrain-textures.ts";
import type { TribeLooks } from "../tribe-looks.ts";
import type { ViewInput } from "../view-input.ts";
import { createBuildingMaterial, createPlinthMaterial } from "./building-materials.ts";

const LEVEL_DISTANCES = { high: 320, low: 3200 } as const;
const PIECE_RADIUS = 9;
const PIECE_CENTER_LIFT = 2;
const WORKPLACE_GLOW = 0.55;
const SMALLEST_RING = 10;
const ROUND_KINDS: ReadonlySet<BuildingKind> = new Set(["hut", "kiln", "smelter", "tent"]);
const GLOWING_KINDS: ReadonlySet<BuildingKind> = new Set(["forge", "kiln", "smelter"]);
const ENCLOSURE_KINDS: readonly EnclosureKind[] = ["palisade", "stoneWall"];
const ENCLOSURE_PIECES: readonly EnclosurePiece[] = ["segment", "gate"];
const BUILDING_CHANNELS = ["buildOrder", "part", "shade", "slot"] as const;
const GROUND_BAND = 0.3;
const PLINTH_INSET = 0.1;
const PLINTH_TOP = -0.03;
const PLINTH_FOOTING = 0.6;
const TALLEST_PLINTH = 3;
const SINKING_ALLOWANCE = 0.6;
const ROUND_PLINTH_SIDES = 14;
const FADING_BATCH = 2;
const FLOATS_PER_INSTANCE = 12;

const BUILDING_FIELDS = [
  { name: "buildingPlacement", size: 4 },
  { name: "buildingLook", size: 4 },
  { name: "buildingState", size: 4 },
] as const;

const PLINTH_FIELDS = [
  { name: "plinthPlacement", size: 4 },
  { name: "plinthBox", size: 4 },
  { name: "plinthLook", size: 4 },
] as const;

type GroundProbe = readonly [number, number];

const CENTER_PROBE: readonly GroundProbe[] = [[0, 0]];
const MINE_GROUND_PROBES: readonly GroundProbe[] = [
  [0, 0],
  [0, 1],
  [0, 2],
  [-1.75, 1.35],
  [1.95, 1],
  [-1.1, 0.4],
  [1.1, 0.4],
].map(([x, z]): GroundProbe => {
  return [x * MINE_SCALE, z * MINE_SCALE];
});

interface GroundBox {
  readonly centerX: number;
  readonly centerZ: number;
  readonly isRound: boolean;
  readonly length: number;
  readonly width: number;
}

interface Footing {
  readonly lift: number;
  readonly plinth: GroundBox | null;
  readonly probes: readonly GroundProbe[];
  readonly sinking: number;
}

const MINE_FOOTING: Footing = { lift: 0, plinth: null, probes: MINE_GROUND_PROBES, sinking: 0 };
const CAMPFIRE_FOOTING: Footing = { lift: 0, plinth: null, probes: CENTER_PROBE, sinking: 0 };
const ENCLOSURE_FOOTING: Footing = {
  lift: ENCLOSURE_FOOTING_DEPTH,
  plinth: null,
  probes: [
    [-ENCLOSURE_SEGMENT_LENGTH / 2, 0],
    [0, 0],
    [ENCLOSURE_SEGMENT_LENGTH / 2, 0],
  ],
  sinking: 0,
};

type ModelKey = string;

interface PiecePlacement {
  readonly key: ModelKey;
  readonly progress: number;
  readonly rotation: number;
  readonly x: number;
  readonly z: number;
}

interface Seat {
  readonly floor: number;
  readonly lowest: number;
}

interface PlacedPiece {
  readonly batches: readonly InstanceBatch[];
  readonly building: BuildingSnapshot;
  readonly extent: ObjectExtent;
  readonly plinth: GroundBox | null;
  readonly progress: number;
  readonly rotation: number;
  readonly seat: Seat;
  readonly x: number;
  readonly z: number;
}

interface ModelSource {
  readonly footing: (high: MeshData) => Footing;
  readonly key: ModelKey;
  readonly mesh: (level: "high" | "low") => MeshData;
}

function groundBoxOf(mesh: MeshData, isRound: boolean): GroundBox {
  const { positions } = mesh;

  let minimumX = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let minimumZ = Number.POSITIVE_INFINITY;
  let maximumZ = Number.NEGATIVE_INFINITY;

  for (let offset = 0; offset < positions.length; offset += 3) {
    if (positions[offset + 1] < GROUND_BAND) {
      minimumX = Math.min(minimumX, positions[offset]);
      maximumX = Math.max(maximumX, positions[offset]);
      minimumZ = Math.min(minimumZ, positions[offset + 2]);
      maximumZ = Math.max(maximumZ, positions[offset + 2]);
    }
  }

  return {
    centerX: (minimumX + maximumX) / 2,
    centerZ: (minimumZ + maximumZ) / 2,
    isRound,
    length: Math.max(0, maximumZ - minimumZ - PLINTH_INSET * 2),
    width: Math.max(0, maximumX - minimumX - PLINTH_INSET * 2),
  };
}

function plinthFooting(high: MeshData, isRound: boolean): Footing {
  const box = groundBoxOf(high, isRound);
  const probes: GroundProbe[] = [];

  for (const sideX of [-0.5, 0, 0.5]) {
    for (const sideZ of [-0.5, 0, 0.5]) {
      probes.push([box.centerX + sideX * box.width, box.centerZ + sideZ * box.length]);
    }
  }

  return { lift: TALLEST_PLINTH, plinth: box, probes, sinking: SINKING_ALLOWANCE };
}

function seatOf(mirror: WorldMirror, piece: PiecePlacement, footing: Footing): Seat {
  const cosine = Math.cos(piece.rotation);
  const sine = Math.sin(piece.rotation);

  const heights = footing.probes.map(([localX, localZ]) => {
    return mirror.heightAt(piece.x + localX * cosine + localZ * sine, piece.z + localZ * cosine - localX * sine);
  });

  const lowest = Math.min(...heights);
  const highest = Math.max(...heights);

  return { floor: Math.max(lowest, Math.min(highest - footing.sinking, lowest + footing.lift)), lowest };
}

function createBatch(
  geometry: InstancedBufferGeometry,
  material: MeshStandardNodeMaterial,
  fields: typeof BUILDING_FIELDS | typeof PLINTH_FIELDS
): InstanceBatch {
  const batch = new InstanceBatch(geometry, material, fields, 16);

  batch.mesh.castShadow = true;
  batch.mesh.receiveShadow = true;

  return batch;
}

function createPlinthBatch(shape: BufferGeometry, material: MeshStandardNodeMaterial): InstanceBatch {
  return createBatch(toInstancedGeometry(shape.translate(0, -0.5, 0)), material, PLINTH_FIELDS);
}

function mineKey(ore: MineOre): ModelKey {
  return `mine:${ore}`;
}

function enclosureKey(kind: EnclosureKind, piece: EnclosurePiece): ModelKey {
  return `${kind}:${piece}`;
}

function modelSources(): ModelSource[] {
  const sources: ModelSource[] = [];

  for (const kind of SINGLE_MODEL_KINDS) {
    sources.push({
      footing: (high) => {
        return kind === "campfire" ? CAMPFIRE_FOOTING : plinthFooting(high, ROUND_KINDS.has(kind));
      },
      key: kind,
      mesh: (level) => {
        return buildBuildingModel(kind, level);
      },
    });
  }

  for (const ore of MINED_DEPOSIT_KINDS) {
    sources.push({
      footing: () => {
        return MINE_FOOTING;
      },
      key: mineKey(ore),
      mesh: (level) => {
        return buildMineModel(ore, level);
      },
    });
  }

  for (const kind of ENCLOSURE_KINDS) {
    for (const piece of ENCLOSURE_PIECES) {
      sources.push({
        footing: () => {
          return ENCLOSURE_FOOTING;
        },
        key: enclosureKey(kind, piece),
        mesh: (level) => {
          return buildEnclosurePiece(kind, piece, level);
        },
      });
    }
  }

  return sources;
}

function oreOfVariant(variant: number): MineOre {
  const deposit = DEPOSIT_KINDS[variant - 1];

  if (deposit === "tin" || deposit === "iron") {
    return deposit;
  }

  return "copper";
}

function enclosureKindOf(kind: BuildingKind): EnclosureKind {
  return kind === "stoneWall" ? "stoneWall" : "palisade";
}

function ringOf(mirror: WorldMirror, building: BuildingSnapshot): PiecePlacement[] {
  const kind = enclosureKindOf(building.kind);
  const length = ENCLOSURE_SEGMENT_LENGTH;

  const count = Math.max(SMALLEST_RING, Math.round((FULL_TURN * building.extent) / length));
  const halfStep = Math.PI / count;
  const radius = length / (2 * Math.tan(halfStep));

  const pieces: PiecePlacement[] = [];

  for (let index = 0; index < count; index += 1) {
    const angle = building.rotation + (index / count) * FULL_TURN;

    const ends = [angle - halfStep, angle, angle + halfStep].map((end) => {
      return {
        x: building.x + Math.cos(end) * radius,
        z: building.z + Math.sin(end) * radius,
      };
    });

    if (
      ends.some((end) => {
        return mirror.isWaterAt(end.x, end.z);
      })
    ) {
      continue;
    }

    pieces.push({
      key: enclosureKey(kind, index === 0 ? "gate" : "segment"),
      progress: saturate(building.progress * count - index),
      rotation: -angle - Math.PI / 2,
      x: building.x + Math.cos(angle) * radius,
      z: building.z + Math.sin(angle) * radius,
    });
  }

  return pieces;
}

function glowOf(building: BuildingSnapshot): number {
  if (GLOWING_KINDS.has(building.kind)) {
    return building.progress >= 1 ? WORKPLACE_GLOW : 0;
  }

  if (!isLitCampfire(building)) {
    return 0;
  }

  return clamp(building.fuel * 1.5, 0.35, 1);
}

function piecesOf(mirror: WorldMirror, building: BuildingSnapshot): PiecePlacement[] {
  if (isEnclosure(building.kind)) {
    return ringOf(mirror, building);
  }

  const key = building.kind === "mine" ? mineKey(oreOfVariant(building.variant)) : building.kind;

  return [{ key, progress: building.progress, rotation: building.rotation, x: building.x, z: building.z }];
}

export class BuildingView {
  readonly group = new Group();
  readonly #all: readonly InstanceBatch[];
  readonly #batches = new Map<ModelKey, readonly InstanceBatch[]>();
  readonly #base = new Vector3();
  readonly #bounds = new Sphere(new Vector3(), PIECE_RADIUS);
  readonly #extents = new Map<ModelKey, ObjectExtent>();
  readonly #fading: readonly InstanceBatch[];
  readonly #fadingPlinths: readonly InstanceBatch[];
  readonly #footings = new Map<ModelKey, Footing>();
  readonly #instance = new Float32Array(FLOATS_PER_INSTANCE);
  readonly #plinths: readonly InstanceBatch[];
  readonly #tribes: TribeLooks;
  #isWarmingFading: boolean;
  #laidOutFrame: SimulationFrame | null = null;
  #pieces: PlacedPiece[] = [];

  constructor(tribes: TribeLooks, textures: TerrainTextures, grid: WorldGrid) {
    this.#tribes = tribes;

    const material = createBuildingMaterial(textures, grid, false);
    const fadingMaterial = createBuildingMaterial(textures, grid, true);

    for (const source of modelSources()) {
      const high = source.mesh("high");

      const levels = [high, source.mesh("low")].map((meshData) => {
        return createBatch(geometryFromMeshData(meshData, BUILDING_CHANNELS), material, BUILDING_FIELDS);
      });
      const fading = createBatch(toInstancedGeometry(levels[0].mesh.geometry), fadingMaterial, BUILDING_FIELDS);

      this.#batches.set(source.key, [...levels, fading]);
      this.#extents.set(source.key, extentOf(high.positions));
      this.#footings.set(source.key, source.footing(high));
    }

    const plinthMaterial = createPlinthMaterial(textures, grid, false);
    const fadingPlinthMaterial = createPlinthMaterial(textures, grid, true);

    this.#plinths = [
      createPlinthBatch(new BoxGeometry(1, 1, 1), plinthMaterial),
      createPlinthBatch(new CylinderGeometry(0.5, 0.5, 1, ROUND_PLINTH_SIDES), plinthMaterial),
    ];
    this.#fadingPlinths = [
      createPlinthBatch(new BoxGeometry(1, 1, 1), fadingPlinthMaterial),
      createPlinthBatch(new CylinderGeometry(0.5, 0.5, 1, ROUND_PLINTH_SIDES), fadingPlinthMaterial),
    ];
    this.#fading = [
      ...[...this.#batches.values()].map((batches) => {
        return batches[FADING_BATCH];
      }),
      ...this.#fadingPlinths,
    ];
    this.#isWarmingFading = true;

    this.#all = [...[...this.#batches.values()].flat(), ...this.#plinths, ...this.#fadingPlinths];
    this.group.add(
      ...this.#all.map((batch) => {
        return batch.mesh;
      })
    );
  }

  update(input: ViewInput): void {
    this.#layOut(input.mirror);

    for (const batch of this.#all) {
      batch.begin();
    }

    for (const piece of this.#pieces) {
      this.#place(input, piece);
    }

    for (const batch of this.#all) {
      batch.commit();
    }

    this.#warmFadingBatches();
  }

  dispose(): void {
    for (const batch of this.#all) {
      batch.dispose();
    }
  }

  #layOut(mirror: WorldMirror): void {
    const { frame } = mirror;

    if (frame === this.#laidOutFrame) {
      return;
    }

    this.#laidOutFrame = frame;
    this.#pieces = [];

    for (const building of frame.buildings) {
      for (const piece of piecesOf(mirror, building)) {
        this.#addPiece(mirror, building, piece);
      }
    }
  }

  #addPiece(mirror: WorldMirror, building: BuildingSnapshot, piece: PiecePlacement): void {
    const batches = this.#batches.get(piece.key);
    const extent = this.#extents.get(piece.key);
    const footing = this.#footings.get(piece.key);

    if (batches === undefined || extent === undefined || footing === undefined) {
      return;
    }

    this.#pieces.push({
      batches,
      building,
      extent,
      plinth: footing.plinth,
      progress: piece.progress,
      rotation: piece.rotation,
      seat: seatOf(mirror, piece, footing),
      x: piece.x,
      z: piece.z,
    });
  }

  #place(input: ViewInput, piece: PlacedPiece): void {
    const { building, seat } = piece;

    const y = seat.floor;

    this.#bounds.center.set(piece.x, y + PIECE_CENTER_LIFT, piece.z);

    const distance = input.camera.position.distanceTo(this.#bounds.center);

    if (distance > LEVEL_DISTANCES.low * input.detail || !input.frustum.intersectsSphere(this.#bounds)) {
      return;
    }

    const level = distance < LEVEL_DISTANCES.high * input.detail ? 0 : 1;
    const accent = this.#tribes.accent(building.tribeId);
    const visibility = columnVisibility(input.camera.position, this.#base.set(piece.x, y, piece.z), piece.extent);
    const instance = this.#instance;

    writeVec4(instance, 0, piece.x, y, piece.z, piece.rotation);
    writeVec4(instance, 4, piece.progress, accent.r, accent.g, accent.b);
    writeVec4(instance, 8, saturate(1 - building.health), glowOf(building), building.style, visibility);
    piece.batches[visibility < 1 ? FADING_BATCH : level].add(instance);

    if (piece.plinth !== null) {
      this.#placePlinth(piece, piece.plinth, visibility);
    }
  }

  #placePlinth(piece: PlacedPiece, box: GroundBox, visibility: number): void {
    const { building, seat } = piece;
    const [boxes, rounds] = visibility < 1 ? this.#fadingPlinths : this.#plinths;

    const plinths = box.isRound ? rounds : boxes;
    const depth = seat.floor - seat.lowest + PLINTH_FOOTING;
    const instance = this.#instance;

    writeVec4(instance, 0, piece.x, seat.floor + PLINTH_TOP, piece.z, piece.rotation);
    writeVec4(instance, 4, box.centerX, box.centerZ, box.width, box.length);
    writeVec4(instance, 8, depth, saturate(1 - building.health), building.style, visibility);
    plinths.add(instance);
  }

  #warmFadingBatches(): void {
    const isWarming = this.#isWarmingFading;

    this.#isWarmingFading = false;

    for (const batch of this.#fading) {
      batch.mesh.visible = isWarming || batch.count > 0;
    }
  }
}
