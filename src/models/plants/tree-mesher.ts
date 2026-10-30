import { Vector3 } from "three";
import { clamp, fractionalPart, lerp, saturate, smoothstep } from "../../shared/math.ts";
import { createVolumeNoise } from "../../shared/noise.ts";
import { createRandom } from "../../shared/random.ts";
import { thinned } from "../level-of-detail.ts";
import { MaterialSlot, type MaterialSlotIndex } from "../materials.ts";
import { MeshBuilder, type SurfacePoint, type VertexStyle } from "../mesh/mesh-builder.ts";
import type { MeshData } from "../mesh/mesh-data.ts";
import { deformShape, type Shape } from "../mesh/shape.ts";
import { blob, cone, icosphere, type LoftSection, loft } from "../mesh/shapes.ts";
import { transformOf } from "../mesh/transforms.ts";
import { ribbon, type TubePoint, tube } from "../mesh/tubes.ts";
import {
  type Branch,
  endedBelow,
  type Foliage,
  type FoliageBlob,
  type FoliageFrond,
  type FoliageSkirt,
  type TreeStructure,
  toVector,
} from "./tree-structure.ts";

export const FOLIAGE_FLUTTER = 1;

const MESH_NOISE = createVolumeNoise(createRandom(5150));
const BLOB_LIMITS: Readonly<Record<NearLevel, number>> = { high: 9, medium: 4 };
const GROUNDED_CROWN_LIFT = 0.8;
const LOW_CROWN_FILL = 0.53;
const LOW_FROND_CROWN_FILL = 0.4;
const SWAY_GROWTH = 1.4;

const BRANCH_SIDES: Readonly<Record<Exclude<PlantDetailLevel, "far">, readonly number[]>> = {
  high: [6, 4, 3],
  low: [4],
  medium: [5, 3],
};

const CONE_SEGMENTS: Readonly<Record<DistantLevel, number>> = { far: 5, low: 7 };
const SPIKE_SIDES = 3;

const DOME: readonly (readonly [reach: number, radius: number])[] = [
  [0.45, 0.82],
  [0.8, 0.5],
  [0.98, 0],
];

const LOW_STEM_TAPER = 0.6;
const LOW_CONE_TRUNK = 0.5;
const MAXIMUM_BRANCH_DEPTHS: Readonly<Record<PlantDetailLevel, number>> = { far: 0, high: 2, low: 0, medium: 1 };
const SHOULDER_HEIGHT = 0.38;
const SHOULDER_RADIUS = 0.62;
const TIP_HEIGHT = 0.92;
const TIP_RADIUS = 0.16;
const HOLLOW_VERTICES = 1;
const DRAPE_FALL = 0.5;
const FRINGE_DEPTH = 0.62;
const DRAPE_TEETH: Readonly<Record<NearLevel, number>> = { high: 8, medium: 5 };

export type PlantDetailLevel = "far" | "high" | "low" | "medium";

type DistantLevel = "far" | "low";

export type NearLevel = Exclude<PlantDetailLevel, DistantLevel>;

export interface TreeLook {
  readonly bark: MaterialSlotIndex;
  readonly foliage: MaterialSlotIndex;
  readonly hasBarkMarks: boolean;
}

export const BROADLEAF_LOOK: TreeLook = { bark: MaterialSlot.Bark, foliage: MaterialSlot.Leaf, hasBarkMarks: false };

interface SkirtDetail {
  readonly hasRoundedUnderside: boolean;
  readonly segments: number;
  readonly teeth: number;
}

const SKIRT_DETAILS: Readonly<Record<NearLevel, SkirtDetail>> = {
  high: { hasRoundedUnderside: true, segments: 10, teeth: 8 },
  medium: { hasRoundedUnderside: false, segments: 8, teeth: 7 },
};

interface MergedBlob {
  readonly center: Vector3;
  readonly drape: number;
  readonly radius: number;
  readonly squash: number;
  readonly tint: number;
  readonly weight: number;
}

interface Reach {
  readonly maximum: Vector3;
  readonly minimum: Vector3;
}

interface LowCone {
  readonly bottom: number;
  readonly center: FoliageSkirt["center"];
  readonly radius: number;
  readonly top: number;
}

function silhouetteWidth(sides: number): number {
  return sides * Math.sin(Math.PI / sides);
}

export function isDistantLevel(level: PlantDetailLevel): level is DistantLevel {
  return level === "low" || level === "far";
}

export function plantSway(height: number, plantHeight: number): number {
  return saturate(height / plantHeight) ** SWAY_GROWTH;
}

function woodStyle(height: number, look: TreeLook, depth: number): VertexStyle {
  return {
    shade: (point) => {
      return 0.68 + 0.32 * smoothstep(0, height * 0.25, point.position.y);
    },
    slot: (point) => {
      return barkSlot(point, look, depth);
    },
    sway: (point) => {
      return plantSway(point.position.y, height);
    },
  };
}

function barkSlot(point: SurfacePoint, look: TreeLook, depth: number): number {
  if (!look.hasBarkMarks || depth > 0) {
    return look.bark;
  }

  const { x, y, z } = point.position;

  const mark = fractionalPart(y * 1.4 + MESH_NOISE.sample(x * 3, y * 0.7, z * 3) * 0.6);

  return mark < 0.14 ? MaterialSlot.Bark : look.bark;
}

function crownCenter(structure: TreeStructure): Vector3 {
  const centers = structure.foliage.map(foliageCenter);
  const sum = centers.reduce((total, center) => {
    return total.add(center);
  }, new Vector3());

  return sum.multiplyScalar(1 / Math.max(1, centers.length));
}

function foliageCenter(foliage: Foliage): Vector3 {
  if (foliage.kind === "frond") {
    const [first] = foliage.points;

    return toVector(first);
  }

  return new Vector3(...foliage.center);
}

export function foliageStyle(
  structure: Pick<TreeStructure, "height">,
  look: Pick<TreeLook, "foliage">,
  tint: number,
  center: Vector3
): VertexStyle {
  const outward = new Vector3();

  return {
    flutter: FOLIAGE_FLUTTER,
    shade: (point) => {
      outward.copy(point.position).sub(center).normalize();

      const facing = outward.dot(point.normal) * 0.5 + 0.5;
      const lift = smoothstep(0, structure.height, point.position.y) * 0.15;

      return clamp(0.5 + 0.38 * facing + lift + tint, 0.3, 1.15);
    },
    slot: look.foliage,
    sway: (point) => {
      return plantSway(point.position.y, structure.height);
    },
  };
}

function domed(points: readonly TubePoint[]): TubePoint[] {
  const last = points.at(-1);
  const before = points.at(-2);

  if (last === undefined || before === undefined) {
    return [...points];
  }

  const direction = toVector(last).sub(toVector(before)).normalize();

  const cap = DOME.map(([reach, radius]) => {
    const point = toVector(last).addScaledVector(direction, last.radius * reach);

    return { radius: last.radius * radius, x: point.x, y: point.y, z: point.z };
  });

  return [...points, ...cap];
}

function branchPoints(branch: Branch, structure: TreeStructure, level: PlantDetailLevel): TubePoint[] {
  const points = level === "high" ? [...branch.points] : thinned(branch.points);

  if (branch.depth > 0) {
    return points;
  }

  if (isDistantLevel(level)) {
    return lowTrunk(points, structure);
  }

  if (branch.isForked === true) {
    return domed(points);
  }

  return points;
}

function lowTrunk(points: readonly TubePoint[], structure: TreeStructure): TubePoint[] {
  const crown = lowCone(structure);

  if (crown !== null) {
    return endedBelow(points, lerp(crown.bottom, crown.top, LOW_CONE_TRUNK));
  }

  return reachingCrown(points, lowCrownCenter(structure));
}

function farTrunkTop(structure: TreeStructure, top: TubePoint): TubePoint {
  const crown = lowCrownCenter(structure);

  if (crown === null) {
    return top;
  }

  return { radius: 0, x: crown.x, y: crown.y, z: crown.z };
}

function spike(root: TubePoint, top: TubePoint): Shape {
  return loft(
    [
      { centerX: root.x, centerZ: root.z, radiusX: root.radius, radiusZ: root.radius, y: root.y },
      { centerX: top.x, centerZ: top.z, radiusX: 0, radiusZ: 0, y: top.y },
    ],
    SPIKE_SIDES
  );
}

function reachingCrown(points: readonly TubePoint[], crown: Vector3 | null): TubePoint[] {
  const last = points.at(-1);

  if (crown === null || last === undefined || crown.y <= last.y) {
    return [...points];
  }

  return [...points, { radius: last.radius * LOW_STEM_TAPER, x: crown.x, y: crown.y, z: crown.z }];
}

function branchSeam(points: readonly TubePoint[], level: PlantDetailLevel): { seam?: number } {
  if (isDistantLevel(level)) {
    return {};
  }

  const [root] = points;

  return { seam: clamp(root.radius * 1.5, 0.05, 0.45) };
}

function addBranches(builder: MeshBuilder, structure: TreeStructure, look: TreeLook, level: PlantDetailLevel): void {
  for (const branch of structure.branches) {
    if (branch.depth > MAXIMUM_BRANCH_DEPTHS[level]) {
      continue;
    }

    const points = branchPoints(branch, structure, level);
    const [root] = points;
    const top = points.at(-1);

    if (level === "far") {
      if (top !== undefined) {
        builder.add(spike(root, farTrunkTop(structure, top)), {
          style: woodStyle(structure.height, look, branch.depth),
        });
      }

      continue;
    }

    builder.add(tube(points, { hasStartCap: branch.depth > 0, radialSegments: BRANCH_SIDES[level][branch.depth] }), {
      ...(branch.depth < 2 ? branchSeam(points, level) : {}),
      style: woodStyle(structure.height, look, branch.depth),
    });
  }
}

function skirtCrown(skirt: FoliageSkirt, isCovered: boolean): LoftSection[] {
  const { bottom, radius, top } = skirt;

  const shoulder = lerp(bottom, top, SHOULDER_HEIGHT);
  const tip = lerp(bottom, top, TIP_HEIGHT);

  if (isCovered) {
    const apex = shoulder + ((tip - shoulder) * SHOULDER_RADIUS) / (SHOULDER_RADIUS - TIP_RADIUS);

    return [{ radiusX: 0, radiusZ: 0, y: apex }];
  }

  return [
    { radiusX: radius * TIP_RADIUS, radiusZ: radius * TIP_RADIUS, y: tip },
    { radiusX: 0, radiusZ: 0, y: top },
  ];
}

function toothedLoft(sections: readonly LoftSection[], skirt: FoliageSkirt, detail: SkirtDetail): Shape {
  const { bottom, droop } = skirt;

  return deformShape(loft(sections, detail.segments), (vertex) => {
    if (vertex.y > bottom + 0.01) {
      return [0, 0, 0];
    }

    const tooth = Math.abs(fractionalPart(vertex.around * detail.teeth) * 2 - 1);

    return [vertex.x * 0.12 * tooth, -droop * (1 - tooth), vertex.z * 0.12 * tooth];
  });
}

function skirtShape(skirt: FoliageSkirt, detail: SkirtDetail, isCovered: boolean): Shape {
  const { bottom, droop, radius, top } = skirt;

  const hollow: LoftSection = { radiusX: 0, radiusZ: 0, y: bottom + droop * 0.8 };
  const underside: LoftSection = { radiusX: radius * 0.55, radiusZ: radius * 0.55, y: bottom + droop * 0.55 };

  const upperSide: LoftSection[] = [
    { radiusX: radius, radiusZ: radius, y: bottom },
    {
      radiusX: radius * SHOULDER_RADIUS,
      radiusZ: radius * SHOULDER_RADIUS,
      y: lerp(bottom, top, SHOULDER_HEIGHT),
    },
    ...skirtCrown(skirt, isCovered),
  ];

  const rounded = toothedLoft([hollow, underside, ...upperSide], skirt, detail);

  if (detail.hasRoundedUnderside) {
    return rounded;
  }

  const plain = toothedLoft([hollow, ...upperSide], skirt, detail);
  const normals = new Float32Array(plain.normals);
  const rimInRounded = (HOLLOW_VERTICES + detail.segments) * 3;

  normals.set(rounded.normals.subarray(rimInRounded, rimInRounded + detail.segments * 3), HOLLOW_VERTICES * 3);

  return { ...plain, normals };
}

function isCoveredSkirt(skirt: FoliageSkirt, structure: TreeStructure): boolean {
  return structure.foliage.some((other) => {
    return other.kind === "skirt" && other.bottom > skirt.bottom && other.bottom < skirt.top;
  });
}

function addSkirt(
  builder: MeshBuilder,
  structure: TreeStructure,
  look: TreeLook,
  skirt: FoliageSkirt,
  level: NearLevel
): void {
  const center = new Vector3(skirt.center[0], (skirt.bottom + skirt.top) / 2, skirt.center[2]);

  builder.add(skirtShape(skirt, SKIRT_DETAILS[level], isCoveredSkirt(skirt, structure)), {
    style: foliageStyle(structure, look, skirt.tint, center),
    transform: transformOf({ position: [skirt.center[0], 0, skirt.center[2]] }),
  });
}

function weepingShape(foliage: FoliageBlob, drape: number, level: NearLevel): Shape {
  const { radius, squash } = foliage;
  const [x, y, z] = foliage.center;

  const teeth = DRAPE_TEETH[level];
  const segments = teeth * 2;
  const fall = -radius * squash * DRAPE_FALL;
  const hem = fall - drape;
  const valley = hem + drape * FRINGE_DEPTH;

  function strands(around: number): number {
    return 1 + 0.07 * Math.abs(Math.cos(around * Math.PI * teeth));
  }

  const sections: LoftSection[] = [
    { radiusX: 0, radiusZ: 0, y: fall * 0.6 },
    { radiusX: radius * 0.82, radiusZ: radius * 0.82, ripple: strands, y: hem },
    { radiusX: radius * 0.97, radiusZ: radius * 0.97, ripple: strands, y: fall - drape * 0.12 },
    { radiusX: radius, radiusZ: radius, y: radius * squash * 0.12 },
    { radiusX: radius * 0.66, radiusZ: radius * 0.66, y: radius * squash * 0.74 },
    { radiusX: 0, radiusZ: 0, y: radius * squash },
  ];

  return deformShape(loft(sections, segments), (vertex) => {
    if (Math.abs(vertex.y - hem) < 1e-4) {
      const isValley = Math.round(vertex.around * segments) % 2 === 1;

      return isValley ? [vertex.x * 0.04, valley - hem, vertex.z * 0.04] : [0, 0, 0];
    }

    if (vertex.y < fall) {
      return [0, 0, 0];
    }

    const lump =
      radius *
      0.12 *
      MESH_NOISE.fractal(x * 0.37 + vertex.x * 0.6, y * 0.29 + vertex.y * 0.6, z * 0.41 + vertex.z * 0.6, {
        octaves: 2,
      });

    return [vertex.normalX * lump, vertex.normalY * lump, vertex.normalZ * lump];
  });
}

function weepingStyle(
  structure: TreeStructure,
  look: TreeLook,
  foliage: FoliageBlob,
  drape: number,
  crown: Vector3
): VertexStyle {
  const fallHeight = foliage.center[1] - foliage.radius * foliage.squash * DRAPE_FALL;
  const fallSway = plantSway(fallHeight, structure.height);

  return {
    ...foliageStyle(structure, look, foliage.tint, crown),
    sway: (point) => {
      const { y } = point.position;

      if (y >= fallHeight) {
        return plantSway(y, structure.height);
      }

      return lerp(fallSway, 1, saturate((fallHeight - y) / drape));
    },
  };
}

function addBlob(
  builder: MeshBuilder,
  structure: TreeStructure,
  look: TreeLook,
  foliage: FoliageBlob,
  level: PlantDetailLevel,
  crown: Vector3
): void {
  const [x, y, z] = foliage.center;
  const { drape = 0 } = foliage;

  if (drape > 0 && !isDistantLevel(level)) {
    builder.add(weepingShape(foliage, drape, level), {
      style: weepingStyle(structure, look, foliage, drape, crown),
      transform: transformOf({ position: foliage.center }),
    });

    return;
  }

  const shape =
    level === "high"
      ? blob({
          detail: 1,
          noise: MESH_NOISE,
          offset: [x * 0.37, y * 0.29, z * 0.41],
          radius: foliage.radius,
          roughness: 0.3,
        })
      : icosphere(foliage.radius, 0);

  builder.add(shape, {
    style: foliageStyle(structure, look, foliage.tint, crown),
    transform: transformOf({ position: foliage.center, scale: [1, foliage.squash, 1] }),
  });
}

function addFrond(
  builder: MeshBuilder,
  structure: TreeStructure,
  look: TreeLook,
  frond: FoliageFrond,
  level: PlantDetailLevel,
  crown: Vector3
): void {
  const [root] = frond.points;

  const rootSway = plantSway(root.y, structure.height);
  const points = level === "high" ? frond.points : thinned(frond.points);

  builder.add(ribbon(points), {
    style: {
      ...foliageStyle(structure, look, frond.tint, crown),
      sway: (point) => {
        return lerp(rootSway, 1, point.along);
      },
    },
  });
}

function mergeClosest(blobs: MergedBlob[]): MergedBlob[] {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestFirst = 0;
  let bestSecond = 1;

  for (let first = 0; first < blobs.length; first += 1) {
    for (let second = first + 1; second < blobs.length; second += 1) {
      const distance = blobs[first].center.distanceTo(blobs[second].center);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestFirst = first;
        bestSecond = second;
      }
    }
  }

  const first = blobs[bestFirst];
  const second = blobs[bestSecond];
  const weight = first.weight + second.weight;

  const center = first.center
    .clone()
    .multiplyScalar(first.weight / weight)
    .addScaledVector(second.center, second.weight / weight);

  const merged: MergedBlob = {
    center,
    drape: (first.drape * first.weight + second.drape * second.weight) / weight,
    radius: Math.max(first.radius, second.radius) + bestDistance * 0.35,
    squash: (first.squash + second.squash) / 2,
    tint: (first.tint + second.tint) / 2,
    weight,
  };

  return [
    ...blobs.filter((_blob, index) => {
      return index !== bestFirst && index !== bestSecond;
    }),
    merged,
  ];
}

function mergedBlobs(blobs: readonly FoliageBlob[], target: number): FoliageBlob[] {
  let merged: MergedBlob[] = blobs.map((foliage) => {
    return {
      center: new Vector3(...foliage.center),
      drape: foliage.drape === undefined ? 0 : foliage.drape,
      radius: foliage.radius,
      squash: foliage.squash,
      tint: foliage.tint,
      weight: foliage.radius ** 3,
    };
  });

  while (merged.length > target) {
    merged = mergeClosest(merged);
  }

  return merged.map((foliage) => {
    return {
      center: foliage.center.toArray(),
      drape: foliage.drape,
      kind: "blob",
      radius: foliage.radius,
      squash: foliage.squash,
      tint: foliage.tint,
    };
  });
}

function crownEnvelope(structure: TreeStructure): FoliageBlob {
  const minimum = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const maximum = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

  for (const foliage of structure.foliage) {
    const reach = foliageReach(foliage);

    minimum.min(reach.minimum);
    maximum.max(reach.maximum);
  }

  const hasFronds = structure.foliage.some((foliage) => {
    return foliage.kind === "frond";
  });
  const center = minimum.clone().add(maximum).multiplyScalar(0.5);
  const size = maximum
    .clone()
    .sub(minimum)
    .multiplyScalar(hasFronds ? LOW_FROND_CROWN_FILL : LOW_CROWN_FILL);

  return {
    center: center.toArray(),
    kind: "blob",
    radius: Math.max(size.x, size.z),
    squash: size.y / Math.max(size.x, size.z, 0.001),
    tint: 0,
  };
}

function foliageReach(foliage: Foliage): Reach {
  if (foliage.kind === "frond") {
    const points = foliage.points.map(toVector);

    return {
      maximum: points.reduce((maximum, point) => {
        return maximum.max(point);
      }, points[0].clone()),
      minimum: points.reduce((minimum, point) => {
        return minimum.min(point);
      }, points[0].clone()),
    };
  }

  if (foliage.kind === "skirt") {
    const [x, , z] = foliage.center;

    return {
      maximum: new Vector3(x + foliage.radius, foliage.top, z + foliage.radius),
      minimum: new Vector3(x - foliage.radius, foliage.bottom - foliage.droop, z - foliage.radius),
    };
  }

  const { drape = 0 } = foliage;

  const center = new Vector3(...foliage.center);
  const extent = new Vector3(foliage.radius, foliage.radius * foliage.squash, foliage.radius);
  const lowest = center.clone().sub(extent);

  return {
    maximum: center.clone().add(extent),
    minimum: lowest.setY(Math.min(lowest.y, center.y - drape - extent.y * 0.5)),
  };
}

function lowCrownCenter(structure: TreeStructure): Vector3 | null {
  if (structure.foliage.length === 0 || lowCone(structure) !== null) {
    return null;
  }

  return new Vector3(...crownEnvelope(structure).center);
}

function lowCone(structure: TreeStructure): LowCone | null {
  const skirts = structure.foliage.filter((foliage) => {
    return foliage.kind === "skirt";
  });

  if (skirts.length === 0) {
    return null;
  }

  const widest = skirts.reduce((best, skirt) => {
    return skirt.radius > best.radius ? skirt : best;
  });
  const top = skirts.reduce((highest, skirt) => {
    return Math.max(highest, skirt.top);
  }, 0);

  return { bottom: widest.bottom - widest.droop * 0.5, center: widest.center, radius: widest.radius * 1.02, top };
}

function addLowCrown(builder: MeshBuilder, structure: TreeStructure, look: TreeLook, level: DistantLevel): void {
  const crown = lowCone(structure);

  if (crown !== null) {
    const { bottom, center, radius, top } = crown;

    const sides = CONE_SEGMENTS[level];
    const widening = silhouetteWidth(CONE_SEGMENTS.low) / silhouetteWidth(sides);

    builder.add(cone(radius * widening, top - bottom, sides), {
      style: foliageStyle(structure, look, 0, new Vector3(0, (top + bottom) / 2, 0)),
      transform: transformOf({ position: [center[0], bottom, center[2]] }),
    });

    return;
  }

  if (structure.foliage.length === 0) {
    return;
  }

  const envelope = crownEnvelope(structure);
  const foliageMiddle = crownCenter(structure);
  const root = stemRoot(structure);

  if (root === null) {
    addBlob(builder, structure, look, groundedEnvelope(envelope), "low", foliageMiddle);

    return;
  }

  if (needsCrownStem(structure, root, envelope, level)) {
    addCrownStem(builder, structure, look, root, envelope, level);
  }

  addBlob(builder, structure, look, envelope, "low", foliageMiddle);
}

function needsCrownStem(
  structure: TreeStructure,
  root: TubePoint,
  envelope: FoliageBlob,
  level: DistantLevel
): boolean {
  const hasTrunk = structure.branches.some((branch) => {
    return branch.depth === 0;
  });

  if (hasTrunk && envelope.center[1] > root.y) {
    return false;
  }

  return level !== "far" || !hasTrunk;
}

function groundedEnvelope(envelope: FoliageBlob): FoliageBlob {
  const [x, , z] = envelope.center;

  return { ...envelope, center: [x, envelope.radius * envelope.squash * GROUNDED_CROWN_LIFT, z] };
}

function stemRoot(structure: TreeStructure): TubePoint | null {
  const trunk = structure.branches.find((branch) => {
    return branch.depth === 0;
  });
  const top = trunk?.points.at(-1);

  if (top !== undefined) {
    return top;
  }

  const bases = structure.branches.flatMap((branch) => {
    return branch.points.slice(0, 1);
  });

  if (bases.length === 0) {
    return null;
  }

  const share = 1 / bases.length;

  return {
    radius: Math.hypot(
      ...bases.map((base) => {
        return base.radius;
      })
    ),
    x: bases.reduce((sum, base) => {
      return sum + base.x * share;
    }, 0),
    y: Math.min(
      ...bases.map((base) => {
        return base.y;
      })
    ),
    z: bases.reduce((sum, base) => {
      return sum + base.z * share;
    }, 0),
  };
}

function addCrownStem(
  builder: MeshBuilder,
  structure: TreeStructure,
  look: TreeLook,
  root: TubePoint,
  envelope: FoliageBlob,
  level: DistantLevel
): void {
  const [x, y, z] = envelope.center;

  const base = { ...root, radius: root.radius * 0.9 };
  const style = woodStyle(structure.height, look, 1);

  if (level === "far") {
    builder.add(spike(base, { radius: 0, x, y, z }), { style });

    return;
  }

  builder.add(tube([base, { radius: root.radius * 0.5, x, y, z }], { radialSegments: 3 }), { style });
}

function addFoliage(builder: MeshBuilder, structure: TreeStructure, look: TreeLook, level: PlantDetailLevel): void {
  if (isDistantLevel(level)) {
    addLowCrown(builder, structure, look, level);

    return;
  }

  const blobs = structure.foliage.filter((foliage) => {
    return foliage.kind === "blob";
  });
  const visibleBlobs = mergedBlobs(blobs, BLOB_LIMITS[level]);
  const crown = crownCenter(structure);

  for (const foliage of visibleBlobs) {
    addBlob(builder, structure, look, foliage, level, crown);
  }

  for (const foliage of structure.foliage) {
    if (foliage.kind === "skirt") {
      addSkirt(builder, structure, look, foliage, level);
    }

    if (foliage.kind === "frond") {
      addFrond(builder, structure, look, foliage, level, crown);
    }
  }
}

export function meshTree(structure: TreeStructure, look: TreeLook, level: PlantDetailLevel): MeshData {
  const builder = new MeshBuilder();

  addBranches(builder, structure, look, level);
  addFoliage(builder, structure, look, level);

  return builder.build();
}
