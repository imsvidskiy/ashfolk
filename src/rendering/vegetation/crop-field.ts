import {
  attribute,
  clamp,
  equal,
  Fn,
  float,
  int,
  mix,
  normalLocal,
  positionLocal,
  select,
  smoothstep,
  uniformArray,
  varying,
  vec3,
} from "three/tsl";
import { type Frustum, Group, MeshStandardNodeMaterial, type PerspectiveCamera, Sphere, Vector3 } from "three/webgpu";
import { CROP_KINDS, type CropKind, cropOfCode, isFencedCode } from "../../content/crops.ts";
import { Ground } from "../../content/grounds.ts";
import type { WorldMirror } from "../../game/world-mirror.ts";
import { MaterialSlot } from "../../models/materials.ts";
import type { MeshData } from "../../models/mesh/mesh-data.ts";
import {
  buildCropModel,
  buildFenceModel,
  CROP_DETAIL_LEVELS,
  CROP_HEAD_PART,
} from "../../models/plants/crop-models.ts";
import { FULL_TURN, hashToUnit } from "../../shared/math.ts";
import { GROUND_CHANNELS, GroundChannel } from "../../world/agent-buffers.ts";
import type { CellRegion, RowRun } from "../../world/change-tracking.ts";
import { geometryFromMeshData, InstanceBatch } from "../instancing.ts";
import { rotateAroundUp, slotColorTable } from "../node-helpers.ts";
import { markOutlined } from "../outlines.ts";
import { FURROW_SPACING } from "../terrain/field-ground.ts";
import { type FieldPlan, FurrowAxis } from "../terrain/field-plan.ts";
import { assignSphereLevels, HIDDEN_LEVEL } from "../view-input.ts";
import { gustAt, type PlantWeather } from "./plant-material.ts";

const BYTE = 255;
const NO_CROP = -1;
const FLOATS_PER_PLANT = 8;
const GROWTH_OFFSET = 4;
const LEVEL_DISTANCES: readonly number[] = [150, 480];
const FIELD_MARGIN = 0.45;
const ROW_JITTER = 0.06;
const PLANT_JITTER = 0.3;
const CROP_SINK = 0.03;
const HEAD_START = 0.45;
const SWAY_STRENGTH = 0.09;
const CELL_RADIUS_SHARE = 0.75;

const PLANT_SPACING: Readonly<Record<CropKind, number>> = {
  barley: 0.38,
  beans: 0.5,
  carrots: 0.33,
  flax: 0.32,
  turnips: 0.42,
  wheat: 0.36,
};

const RIPE_STEMS: Readonly<Record<CropKind, readonly [number, number, number]>> = {
  barley: [0.84, 0.74, 0.45],
  beans: [0.55, 0.55, 0.28],
  carrots: [0.3, 0.5, 0.2],
  flax: [0.62, 0.5, 0.3],
  turnips: [0.33, 0.52, 0.24],
  wheat: [0.82, 0.66, 0.3],
};

const SPROUT_GREEN = vec3(0.5, 0.7, 0.3);
const LEAF_GREEN = vec3(0.27, 0.47, 0.18);
const EAR_GREEN = vec3(0.52, 0.62, 0.28);
const SEED_CAPSULE = vec3(0.55, 0.42, 0.24);

const CROP_FIELDS = [
  { name: "cropPlacement", size: 4 },
  { name: "cropLook", size: 4 },
] as const;

const FENCE_FIELDS = [
  { name: "fenceStart", size: 4 },
  { name: "fenceEnd", size: 4 },
] as const;

interface FieldCell {
  readonly bounds: Sphere;
  fences: Float32Array;
  growth: number;
  kind: number;
  layout: string;
  level: number;
  plants: Float32Array;
}

interface FieldEdge {
  readonly column: number;
  readonly from: readonly [number, number];
  readonly row: number;
  readonly to: readonly [number, number];
}

interface PlantRows {
  readonly axis: number;
  readonly column: number;
  readonly edges: readonly FieldEdge[];
  readonly growth: number;
  readonly kind: CropKind;
  readonly row: number;
}

function hasEdge(edges: readonly FieldEdge[], column: number, row: number): boolean {
  return edges.some((edge) => {
    return edge.column === column && edge.row === row;
  });
}

function createCropMaterial(weather: PlantWeather): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  const placement = attribute("cropPlacement", "vec4");
  const look = attribute("cropLook", "vec4");
  const slot = int(attribute("slot", "float").add(0.5));
  const part = attribute("part", "float");
  const shade = attribute("shade", "float");
  const sway = attribute("sway", "float");

  const growth = look.x;
  const scale = look.y;
  const kind = int(look.z.add(0.5));
  const tint = look.w;

  const isHead = equal(int(part.add(0.5)), int(CROP_HEAD_PART));
  const isHidden = isHead.and(growth.lessThan(HEAD_START));
  const height = mix(float(0.12), float(1), smoothstep(0, 0.8, growth));
  const width = mix(float(0.4), float(1), smoothstep(0, 0.6, growth));

  const local = positionLocal
    .mul(vec3(width, height, width))
    .mul(scale)
    .mul(select(isHidden, float(0), float(1)));

  const bend = sway
    .mul(sway)
    .mul(gustAt(weather, placement.xz).mul(0.6).add(0.4))
    .mul(weather.gust)
    .mul(SWAY_STRENGTH)
    .mul(height);

  const windOffset = vec3(weather.wind.x, 0, weather.wind.y).mul(bend);

  material.positionNode = Fn(() => {
    normalLocal.assign(rotateAroundUp(normalLocal, placement.w));

    return rotateAroundUp(local, placement.w).add(windOffset).add(placement.xyz);
  })();

  const slotColors = slotColorTable();
  const ripeStems = uniformArray<"vec3">(
    CROP_KINDS.map((crop) => {
      return new Vector3(...RIPE_STEMS[crop]);
    }),
    "vec3"
  );

  const ripeness = smoothstep(0.78, 1, growth);
  const green = mix(SPROUT_GREEN, LEAF_GREEN, smoothstep(0.05, 0.5, growth));
  const stemColor = mix(green, ripeStems.element(kind), ripeness);

  const isGrain = equal(slot, int(MaterialSlot.Grain));
  const isFlower = equal(slot, int(MaterialSlot.Flax));
  const slotColor = slotColors.element(slot);

  const headColor = select(
    isGrain,
    mix(EAR_GREEN, slotColor, ripeness),
    select(isFlower, mix(slotColor, SEED_CAPSULE, ripeness), slotColor)
  );

  const color = select(isHead, headColor, stemColor).mul(shade).mul(tint.mul(0.2).add(0.9));

  material.colorNode = varying(color, "cropColor");
  material.roughnessNode = float(0.9);

  return material;
}

function createFenceMaterial(length: number): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  const start = attribute("fenceStart", "vec4");
  const end = attribute("fenceEnd", "vec4");
  const slot = int(attribute("slot", "float").add(0.5));
  const shade = attribute("shade", "float");

  const along = clamp(positionLocal.x.div(length), 0, 1);
  const lift = mix(start.z, end.x, along);

  material.positionNode = Fn(() => {
    normalLocal.assign(rotateAroundUp(normalLocal, start.w));

    const flat = rotateAroundUp(vec3(positionLocal.x, 0, positionLocal.z), start.w);

    return vec3(flat.x.add(start.x), positionLocal.y.add(lift), flat.z.add(start.y));
  })();

  material.colorNode = varying(slotColorTable().element(slot).mul(shade), "fenceColor");
  material.roughnessNode = float(0.88);

  markOutlined(material);

  return material;
}

export class CropField {
  readonly group = new Group();
  readonly #cells = new Map<number, FieldCell>();
  readonly #cropBatches: readonly (readonly InstanceBatch[])[];
  readonly #fenceBatches: readonly InstanceBatch[];
  readonly #grownKinds = new Set<number>();
  readonly #mirror: WorldMirror;
  readonly #plan: FieldPlan;
  #isDirty = true;
  #planRevision: number;

  constructor(mirror: WorldMirror, weather: PlantWeather, plan: FieldPlan) {
    this.#mirror = mirror;
    this.#plan = plan;
    this.#planRevision = plan.revision;

    const cropMaterial = createCropMaterial(weather);
    const fenceMaterial = createFenceMaterial(mirror.grid.cellSize);

    this.#cropBatches = CROP_KINDS.map((kind) => {
      return CROP_DETAIL_LEVELS.map((level, levelIndex) => {
        return this.#createBatch(buildCropModel(kind, level), cropMaterial, CROP_FIELDS, levelIndex === 0);
      });
    });

    this.#fenceBatches = CROP_DETAIL_LEVELS.map((level) => {
      return this.#createBatch(buildFenceModel(mirror.grid.cellSize, level), fenceMaterial, FENCE_FIELDS, true);
    });

    this.#scanRows(0, mirror.grid.cellsPerSide - 1, false);
  }

  groundChanged(runs: readonly RowRun[]): void {
    for (const run of runs) {
      this.#scanRows(run.firstRow - 1, run.firstRow + run.rowCount, false);
    }
  }

  heightsChanged(region: CellRegion): void {
    this.#scanRows(region.firstRow - 1, region.lastRow + 1, true);
  }

  update(camera: PerspectiveCamera, frustum: Frustum, detail: number): void {
    this.#followPlan();

    const hasNewLevels = assignSphereLevels(this.#cells.values(), camera, frustum, LEVEL_DISTANCES, detail);

    if (!(hasNewLevels || this.#isDirty || this.#grownKinds.size > 0)) {
      return;
    }

    this.#refill(hasNewLevels || this.#isDirty);
    this.#isDirty = false;
    this.#grownKinds.clear();
  }

  dispose(): void {
    for (const batch of [...this.#cropBatches.flat(), ...this.#fenceBatches]) {
      batch.dispose();
    }
  }

  #createBatch(
    data: MeshData,
    material: MeshStandardNodeMaterial,
    fields: typeof CROP_FIELDS | typeof FENCE_FIELDS,
    shouldCastShadow: boolean
  ): InstanceBatch {
    const batch = new InstanceBatch(
      geometryFromMeshData(data, ["part", "shade", "slot", "sway"]),
      material,
      fields,
      256
    );

    batch.mesh.castShadow = shouldCastShadow;
    batch.mesh.receiveShadow = true;
    this.group.add(batch.mesh);

    return batch;
  }

  #groundAt(column: number, row: number, channel: number): number {
    const { grid, ground } = this.#mirror;

    if (!grid.contains(column, row)) {
      return 0;
    }

    return ground[grid.index(column, row) * GROUND_CHANNELS + channel];
  }

  #followPlan(): void {
    if (this.#plan.revision === this.#planRevision) {
      return;
    }

    const { grid } = this.#mirror;

    this.#planRevision = this.#plan.revision;

    for (const cell of [...this.#cells.keys()]) {
      this.#refreshCell(grid.columnOf(cell), grid.rowOf(cell), false);
    }
  }

  #isFarm(column: number, row: number): boolean {
    return this.#groundAt(column, row, GroundChannel.Ground) === Ground.Farm;
  }

  #scanRows(firstRow: number, lastRow: number, isForced: boolean): void {
    const { grid } = this.#mirror;

    const first = Math.max(0, firstRow);
    const last = Math.min(grid.cellsPerSide - 1, lastRow);

    for (let row = first; row <= last; row += 1) {
      for (let column = 0; column < grid.cellsPerSide; column += 1) {
        this.#refreshCell(column, row, isForced);
      }
    }
  }

  #refreshCell(column: number, row: number, isForced: boolean): void {
    const cell = this.#mirror.grid.index(column, row);
    const code = this.#groundAt(column, row, GroundChannel.CropKind);
    const kind = cropOfCode(code);

    if (!this.#isFarm(column, row)) {
      if (this.#cells.delete(cell)) {
        this.#isDirty = true;
      }

      return;
    }

    const edges = this.#edges(column, row);
    const axis = this.#plan.axisAt(cell);
    const growth = this.#groundAt(column, row, GroundChannel.Crop);
    const layout = `${code}:${axis}:${edges
      .map((edge) => {
        return `${edge.column},${edge.row}`;
      })
      .join(";")}`;

    const existing = this.#cells.get(cell);

    if (existing !== undefined && existing.layout === layout && !isForced) {
      this.#regrow(existing, growth);

      return;
    }

    const fences = isFencedCode(code) ? edges : [];
    const plants = kind === null ? null : { axis, column, edges, growth: growth / BYTE, kind, row };

    this.#cells.set(cell, this.#buildCell(column, row, plants, growth, fences, layout));
    this.#isDirty = true;
  }

  #regrow(field: FieldCell, growth: number): void {
    if (field.growth === growth) {
      return;
    }

    field.growth = growth;

    const share = growth / BYTE;

    for (let offset = GROWTH_OFFSET; offset < field.plants.length; offset += FLOATS_PER_PLANT) {
      field.plants[offset] = share;
    }

    this.#grownKinds.add(field.kind);
  }

  #edges(column: number, row: number): FieldEdge[] {
    const { grid } = this.#mirror;

    const half = grid.cellSize / 2;
    const centerX = grid.centerX(column);
    const centerZ = grid.centerZ(row);

    const west = centerX - half;
    const east = centerX + half;
    const north = centerZ - half;
    const south = centerZ + half;

    const candidates: FieldEdge[] = [
      { column, from: [west, north], row: row - 1, to: [east, north] },
      { column, from: [west, south], row: row + 1, to: [east, south] },
      { column: column - 1, from: [west, north], row, to: [west, south] },
      { column: column + 1, from: [east, north], row, to: [east, south] },
    ];

    return candidates.filter((edge) => {
      return !this.#isFarm(edge.column, edge.row);
    });
  }

  #buildCell(
    column: number,
    row: number,
    plants: PlantRows | null,
    growth: number,
    fences: readonly FieldEdge[],
    layout: string
  ): FieldCell {
    const { grid } = this.#mirror;

    const centerX = grid.centerX(column);
    const centerZ = grid.centerZ(row);
    const center = new Vector3(centerX, this.#mirror.heightAt(centerX, centerZ), centerZ);

    return {
      bounds: new Sphere(center, grid.cellSize * CELL_RADIUS_SHARE + 1),
      fences: this.#fenceInstances(fences),
      growth,
      kind: plants === null ? NO_CROP : CROP_KINDS.indexOf(plants.kind),
      layout,
      level: HIDDEN_LEVEL,
      plants: plants === null ? new Float32Array(0) : this.#plantInstances(plants),
    };
  }

  #plantInstances({ axis, column, edges, growth, kind, row }: PlantRows): Float32Array {
    const { grid } = this.#mirror;

    const isAlongX = axis !== FurrowAxis.AlongZ;
    const spacing = PLANT_SPACING[kind];
    const cell = grid.index(column, row);
    const kindIndex = CROP_KINDS.indexOf(kind);
    const west = grid.centerX(column) - grid.cellSize / 2;
    const north = grid.centerZ(row) - grid.cellSize / 2;
    const rows = Math.round(grid.cellSize / FURROW_SPACING);

    const alongStart = (isAlongX ? west : north) + grid.halfSize;
    const acrossStart = isAlongX ? north : west;
    const columnStep = isAlongX ? 1 : 0;
    const rowStep = isAlongX ? 0 : 1;

    const firstAlong = hasEdge(edges, column - columnStep, row - rowStep) ? FIELD_MARGIN : 0;
    const lastAlong = grid.cellSize - (hasEdge(edges, column + columnStep, row + rowStep) ? FIELD_MARGIN : 0);

    const firstPlant = Math.ceil((alongStart + firstAlong) / spacing - 0.5);
    const lastPlant = Math.ceil((alongStart + lastAlong) / spacing - 0.5) - 1;

    const data = new Float32Array(rows * Math.max(0, lastPlant - firstPlant + 1) * FLOATS_PER_PLANT);

    let offset = 0;

    for (let line = 0; line < rows; line += 1) {
      for (let plant = firstPlant; plant <= lastPlant; plant += 1) {
        const across =
          acrossStart + (line + 0.5) * FURROW_SPACING + (hashToUnit(cell, line, plant + 0.5) - 0.5) * 2 * ROW_JITTER;
        const along =
          (plant + 0.5) * spacing -
          grid.halfSize +
          (hashToUnit(cell, plant, line + 0.25) - 0.5) * 2 * spacing * PLANT_JITTER;

        const x = isAlongX ? along : across;
        const z = isAlongX ? across : along;

        data[offset] = x;
        data[offset + 1] = this.#mirror.heightAt(x, z) - CROP_SINK;
        data[offset + 2] = z;
        data[offset + 3] = hashToUnit(cell, line + 0.75, plant) * FULL_TURN;
        data[offset + GROWTH_OFFSET] = growth;
        data[offset + 5] = 0.85 + hashToUnit(plant, cell, line) * 0.3;
        data[offset + 6] = kindIndex;
        data[offset + 7] = hashToUnit(line, plant, cell);
        offset += FLOATS_PER_PLANT;
      }
    }

    return data;
  }

  #fenceInstances(edges: readonly FieldEdge[]): Float32Array {
    return new Float32Array(
      edges.flatMap((edge) => {
        return this.#segment(...edge.from, ...edge.to);
      })
    );
  }

  #segment(fromX: number, fromZ: number, toX: number, toZ: number): number[] {
    return [
      fromX,
      fromZ,
      this.#mirror.heightAt(fromX, fromZ),
      Math.atan2(-(toZ - fromZ), toX - fromX),
      this.#mirror.heightAt(toX, toZ),
      0,
      0,
      0,
    ];
  }

  #refill(isWhole: boolean): void {
    const fields = [...this.#cells.values()].filter((field) => {
      return field.level !== HIDDEN_LEVEL;
    });

    for (const [kindIndex, batches] of this.#cropBatches.entries()) {
      if (!(isWhole || this.#grownKinds.has(kindIndex))) {
        continue;
      }

      const ofKind = fields.filter((field) => {
        return field.kind === kindIndex;
      });

      for (const [level, batch] of batches.entries()) {
        batch.fill(
          ofKind
            .filter((field) => {
              return field.level === level;
            })
            .map((field) => {
              return field.plants;
            })
        );
      }
    }

    if (!isWhole) {
      return;
    }

    for (const [level, batch] of this.#fenceBatches.entries()) {
      batch.fill(
        fields
          .filter((field) => {
            return field.level === level;
          })
          .map((field) => {
            return field.fences;
          })
      );
    }
  }
}
