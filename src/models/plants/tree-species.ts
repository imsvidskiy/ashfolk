import { Vector3 } from "three";
import { PlantSpecies, type PlantSpeciesIndex } from "../../content/plants.ts";
import { FULL_TURN, lerp } from "../../shared/math.ts";
import type { RandomSource } from "../../shared/random.ts";
import { pointAlong, type TubePoint } from "../mesh/tubes.ts";
import { addBlob, addLimb, addTrunk, BLOB_TINT, createGrowth, finish, type Growth, rooted } from "./tree-growth.ts";
import {
  endedBelow,
  type Foliage,
  GOLDEN_ANGLE,
  growBranch,
  jitter,
  type TreeStructure,
  tiltedDirection,
  tipOf,
  toVector,
} from "./tree-structure.ts";

export const TREE_HEIGHTS = {
  [PlantSpecies.Acacia]: 9,
  [PlantSpecies.Alder]: 14,
  [PlantSpecies.Birch]: 19,
  [PlantSpecies.Bush]: 2.2,
  [PlantSpecies.Cactus]: 4,
  [PlantSpecies.DeadTree]: 9,
  [PlantSpecies.DesertShrub]: 1.2,
  [PlantSpecies.Maple]: 16,
  [PlantSpecies.Oak]: 16,
  [PlantSpecies.Palm]: 10,
  [PlantSpecies.Pine]: 24,
  [PlantSpecies.Poplar]: 21,
  [PlantSpecies.Spruce]: 24,
  [PlantSpecies.Willow]: 12,
} as const satisfies Readonly<Partial<Record<PlantSpeciesIndex, number>>>;

export const TREE_GENERATORS: Readonly<Partial<Record<PlantSpeciesIndex, TreeGenerator>>> = {
  [PlantSpecies.Acacia]: acacia,
  [PlantSpecies.Alder]: alder,
  [PlantSpecies.Birch]: birch,
  [PlantSpecies.Bush]: bush,
  [PlantSpecies.DeadTree]: deadTree,
  [PlantSpecies.DesertShrub]: desertShrub,
  [PlantSpecies.Maple]: maple,
  [PlantSpecies.Oak]: oak,
  [PlantSpecies.Palm]: palm,
  [PlantSpecies.Pine]: pine,
  [PlantSpecies.Poplar]: poplar,
  [PlantSpecies.Spruce]: spruce,
  [PlantSpecies.Willow]: willow,
};

const FORK_HEIGHT = 0.93;
const DRAPE_SHARE = 0.68;
const STUBS_PER_TIER = 3;
const BARE_TOP_TIERS = 2;
const TUCKED_SHARE = 0.12;
const BLOB_COVER = 0.45;
const DESERT_SHRUB_FORMS: readonly ((growth: Growth) => void)[] = [addSagebrush, addRosette, addGrassTuft];

export const DESERT_SHRUB_FORM_COUNT = DESERT_SHRUB_FORMS.length;

interface FrondShape {
  readonly droop: number;
  readonly length: number;
  readonly segments: number;
  readonly width: number;
}

type TreeGenerator = (seed: number, variant: number) => TreeStructure;

function oak(seed: number): TreeStructure {
  const growth = createGrowth(seed);

  const { random } = growth;

  const trunk = addTrunk(growth, {
    height: random.between(5, 6.4),
    isForked: true,
    lean: random.between(0, 0.1),
    radiusBottom: 0.56,
    radiusTop: 0.36,
    segments: 4,
    wobble: 0.22,
  });

  const limbCount = random.integer(4, 6);

  for (let limb = 0; limb < limbCount; limb += 1) {
    const azimuth = limb * GOLDEN_ANGLE + jitter(random, 0.4);

    const main = addLimb(growth, trunk, random.between(0.72, 1), azimuth, {
      bend: 0.03,
      depth: 1,
      gravity: 0.07,
      length: random.between(5.8, 7.6),
      radiusEnd: 0.09,
      segments: 4,
      tilt: random.between(0.65, 1.1),
      wobble: 0.35,
    });

    for (let twig = 0; twig < 2; twig += 1) {
      const offshoot = addLimb(growth, main, random.between(0.45, 0.85), random.next() * FULL_TURN, {
        bend: 0.06,
        depth: 2,
        gravity: 0.05,
        length: random.between(2.4, 3.6),
        radiusEnd: 0.03,
        segments: 3,
        tilt: random.between(0.5, 0.9),
        wobble: 0.3,
      });

      addBlob(growth, toVector(tipOf(offshoot)), random.between(2.1, 2.9), 0.74);
    }

    addBlob(growth, toVector(tipOf(main)), random.between(2.4, 3.1), 0.72);
  }

  addBlob(growth, toVector(tipOf(trunk)).add(new Vector3(0, 3.2, 0)), random.between(2.8, 3.4), 0.7);

  return finish(growth, TREE_HEIGHTS[PlantSpecies.Oak]);
}

function stemOffset(random: RandomSource, stem: number, stems: number): Vector3 {
  if (stems === 1) {
    return new Vector3();
  }

  return new Vector3((stem - 0.5) * 0.7, 0, jitter(random, 0.2));
}

function stemLean(random: RandomSource, stems: number): number {
  if (stems === 1) {
    return random.between(0, 0.06);
  }

  return random.between(0.08, 0.14);
}

function birch(seed: number): TreeStructure {
  const growth = createGrowth(seed);

  const { random } = growth;

  const stems = random.chance(0.3) ? 2 : 1;

  for (let stem = 0; stem < stems; stem += 1) {
    const trunk = addTrunk(
      growth,
      {
        height: random.between(16, 18.5) - stem * 2,
        isForked: false,
        lean: stemLean(random, stems),
        radiusBottom: 0.3 - stem * 0.06,
        radiusTop: 0.06,
        segments: 6,
        wobble: 0.12,
      },
      stemOffset(random, stem, stems)
    );

    const branchCount = random.integer(6, 9);

    for (let branch = 0; branch < branchCount; branch += 1) {
      const along = lerp(0.42, 0.95, branch / branchCount) + jitter(random, 0.03);

      const offshoot = addLimb(growth, trunk, along, branch * GOLDEN_ANGLE + jitter(random, 0.3), {
        bend: 0.05,
        depth: 1,
        gravity: 0.1,
        length: random.between(2.6, 4.4) * (1.2 - along * 0.5),
        radiusEnd: 0.02,
        segments: 3,
        tilt: random.between(0.45, 0.8),
        wobble: 0.25,
      });

      addBlob(growth, toVector(tipOf(offshoot)), random.between(1.4, 2), 0.95);
    }

    addBlob(growth, toVector(tipOf(trunk)), random.between(1.5, 2), 1.1);
  }

  return finish(growth, TREE_HEIGHTS[PlantSpecies.Birch]);
}

function maple(seed: number): TreeStructure {
  const growth = createGrowth(seed);

  const { random } = growth;

  const trunk = addTrunk(growth, {
    height: random.between(4, 5.2),
    isForked: true,
    lean: random.between(0, 0.07),
    radiusBottom: 0.45,
    radiusTop: 0.32,
    segments: 3,
    wobble: 0.15,
  });

  const limbCount = random.integer(2, 4);

  for (let limb = 0; limb < limbCount; limb += 1) {
    const main = addLimb(growth, trunk, FORK_HEIGHT, (limb / limbCount) * FULL_TURN + jitter(random, 0.5), {
      bend: 0.05,
      depth: 1,
      gravity: 0.02,
      length: random.between(6.5, 8),
      radiusEnd: 0.08,
      segments: 4,
      tilt: random.between(0.3, 0.55),
      wobble: 0.22,
    });

    for (let twig = 0; twig < 3; twig += 1) {
      const offshoot = addLimb(growth, main, random.between(0.4, 0.9), random.next() * FULL_TURN, {
        bend: 0.05,
        depth: 2,
        gravity: 0.03,
        length: random.between(2.5, 3.5),
        radiusEnd: 0.03,
        segments: 3,
        tilt: random.between(0.6, 1),
        wobble: 0.25,
      });

      addBlob(growth, toVector(tipOf(offshoot)), random.between(2.2, 2.8), 0.9);
    }
  }

  addBlob(growth, toVector(tipOf(trunk)).add(new Vector3(0, 6.5, 0)), random.between(3, 3.6), 0.9);

  return finish(growth, TREE_HEIGHTS[PlantSpecies.Maple]);
}

function willow(seed: number): TreeStructure {
  const growth = createGrowth(seed);

  const { random } = growth;

  const trunk = addTrunk(growth, {
    height: random.between(2.6, 3.4),
    isForked: true,
    lean: random.between(0.04, 0.16),
    radiusBottom: 0.55,
    radiusTop: 0.42,
    segments: 3,
    wobble: 0.2,
  });

  const limbCount = random.integer(4, 6);

  for (let limb = 0; limb < limbCount; limb += 1) {
    const main = addLimb(growth, trunk, random.between(0.8, 1), limb * GOLDEN_ANGLE + jitter(random, 0.3), {
      bend: 0.06,
      depth: 1,
      gravity: 0.14,
      length: random.between(5, 6.5),
      radiusEnd: 0.07,
      segments: 4,
      tilt: random.between(0.55, 0.95),
      wobble: 0.25,
    });

    const tip = toVector(tipOf(main));
    const crownRadius = random.between(2, 2.6);
    const hang = random.between(4, Math.max(4.5, tip.y - 1));

    growth.foliage.push({
      center: tip.toArray(),
      drape: hang * DRAPE_SHARE,
      kind: "blob",
      radius: crownRadius,
      squash: 0.8,
      tint: jitter(random, BLOB_TINT),
    });
  }

  return finish(growth, TREE_HEIGHTS[PlantSpecies.Willow]);
}

function alder(seed: number): TreeStructure {
  const growth = createGrowth(seed);

  const { random } = growth;

  const stems = random.integer(1, 3);

  for (let stem = 0; stem < stems; stem += 1) {
    const trunk = addTrunk(
      growth,
      {
        height: random.between(11, 13) - stem * 1.5,
        isForked: false,
        lean: stemLean(random, stems),
        radiusBottom: 0.32 - stem * 0.05,
        radiusTop: 0.08,
        segments: 5,
        wobble: 0.14,
      },
      alderStemOffset(random, stem, stems)
    );

    const branchCount = random.integer(5, 7);

    for (let branch = 0; branch < branchCount; branch += 1) {
      const along = lerp(0.35, 0.9, branch / branchCount) + jitter(random, 0.03);

      const offshoot = addLimb(growth, trunk, along, branch * GOLDEN_ANGLE + jitter(random, 0.3), {
        bend: 0.04,
        depth: 1,
        gravity: 0.06,
        length: random.between(2.2, 3.4) * (1.25 - along * 0.6),
        radiusEnd: 0.03,
        segments: 3,
        tilt: random.between(0.7, 1.05),
        wobble: 0.25,
      });

      addBlob(growth, toVector(tipOf(offshoot)), random.between(1.7, 2.3) * (1.2 - along * 0.4), 0.85);
    }

    addBlob(growth, toVector(tipOf(trunk)), random.between(1.4, 1.8), 1.15);
  }

  return finish(growth, TREE_HEIGHTS[PlantSpecies.Alder]);
}

function alderStemOffset(random: RandomSource, stem: number, stems: number): Vector3 {
  if (stems === 1) {
    return new Vector3();
  }

  const angle = (stem / stems) * FULL_TURN + jitter(random, 0.4);

  return new Vector3(Math.cos(angle) * 0.45, 0, Math.sin(angle) * 0.45);
}

function spruce(seed: number): TreeStructure {
  const growth = createGrowth(seed);

  const { random } = growth;

  const height = TREE_HEIGHTS[PlantSpecies.Spruce] * random.between(0.94, 1.02);

  const trunk = addTrunk(growth, {
    height,
    isForked: false,
    lean: random.between(0, 0.03),
    radiusBottom: 0.42,
    radiusTop: 0.04,
    segments: 5,
    wobble: 0.04,
  });

  const tiers = random.integer(6, 12);
  const lowest = random.between(1.4, 3.4);
  const baseRadius = random.between(3.3, 4.9);
  const taper = random.between(0.8, 1.15);

  for (let tier = 0; tier < tiers; tier += 1) {
    const amount = tier / tiers;
    const tierHeight = (height - lowest) / tiers + random.between(1.2, 1.8);
    const bottom = lerp(lowest, height * 0.9, amount);
    const center = toVector(pointAlong(trunk, bottom / height));
    const radius = (baseRadius * (1 - amount) ** taper + 0.35) * random.between(0.86, 1.12);

    growth.foliage.push({
      bottom: bottom - 0.4,
      center: [center.x + jitter(random, 0.15), center.y, center.z + jitter(random, 0.15)],
      droop: random.between(0.5, 0.9) * radius * 0.35,
      kind: "skirt",
      radius,
      tint: jitter(random, 0.08),
      top: bottom + tierHeight,
    });
  }

  tuckTrunk(growth, skirtCeiling(growth.foliage));
  addSpruceStubs(growth, trunk, height);

  return finish(growth, height);
}

function addSpruceStubs(growth: Growth, trunk: readonly TubePoint[], height: number): void {
  const { random } = growth;

  const skirts = growth.foliage.filter((item) => {
    return item.kind === "skirt";
  });

  for (const [tier, skirt] of skirts.slice(0, -BARE_TOP_TIERS).entries()) {
    for (let stub = 0; stub < STUBS_PER_TIER; stub += 1) {
      const azimuth = (tier * 0.37 + stub / STUBS_PER_TIER) * FULL_TURN + jitter(random, 0.4);

      addLimb(growth, trunk, (skirt.bottom + 0.3) / height, azimuth, {
        bend: 0.05,
        depth: 2,
        gravity: 0.06,
        length: skirt.radius * random.between(0.4, 0.65),
        radiusEnd: 0.02,
        segments: 2,
        tilt: random.between(1.2, 1.45),
        wobble: 0.2,
      });
    }
  }
}

function skirtCeiling(foliage: readonly Foliage[]): number {
  const skirts = foliage.filter((item) => {
    return item.kind === "skirt";
  });
  const highest = skirts.reduce((top, skirt) => {
    return skirt.top > top.top ? skirt : top;
  });

  return lerp(highest.top, highest.bottom, TUCKED_SHARE);
}

function tuckTrunk(growth: Growth, ceiling: number): void {
  const index = growth.branches.findIndex((branch) => {
    return branch.depth === 0;
  });
  const trunk = growth.branches[index];

  growth.branches[index] = { ...trunk, points: endedBelow(trunk.points, ceiling) };
}

function pine(seed: number): TreeStructure {
  const growth = createGrowth(seed);

  const { random } = growth;

  const trunk = addTrunk(growth, {
    height: random.between(19, 21.5),
    isForked: false,
    lean: random.between(0.02, 0.1),
    radiusBottom: 0.42,
    radiusTop: 0.12,
    segments: 6,
    wobble: 0.1,
  });

  const branchCount = random.integer(5, 8);

  for (let branch = 0; branch < branchCount; branch += 1) {
    const along = lerp(0.55, 0.96, branch / branchCount) + jitter(random, 0.03);

    const limb = addLimb(growth, trunk, along, branch * GOLDEN_ANGLE + jitter(random, 0.4), {
      bend: 0.08,
      depth: 1,
      gravity: 0.03,
      length: random.between(2.6, 4.6) * (1.25 - along * 0.6),
      radiusEnd: 0.05,
      segments: 3,
      tilt: random.between(0.95, 1.35),
      wobble: 0.25,
    });

    addBlob(growth, toVector(tipOf(limb)).add(new Vector3(0, 0.4, 0)), random.between(1.7, 2.5), 0.42);
  }

  addBlob(growth, toVector(tipOf(trunk)).add(new Vector3(0, 0.6, 0)), random.between(2, 2.4), 0.55);

  return finish(growth, TREE_HEIGHTS[PlantSpecies.Pine]);
}

function bush(seed: number): TreeStructure {
  const growth = createGrowth(seed);

  const { random } = growth;

  const stems = random.integer(3, 6);

  for (let stem = 0; stem < stems; stem += 1) {
    const angle = (stem / stems) * FULL_TURN + jitter(random, 0.4);
    const tilt = random.between(0.2, 0.6);

    const points = growBranch({
      bend: 0.08,
      direction: tiltedDirection(angle, tilt),
      gravity: 0.1,
      length: random.between(1, 1.6),
      noise: growth.noise,
      radiusEnd: 0.015,
      radiusStart: 0.05,
      segments: 3,
      start: new Vector3(jitter(random, 0.1), 0, jitter(random, 0.1)),
      wobble: 0.4,
    });

    growth.branches.push({ depth: 1, points });
    addBlob(growth, toVector(tipOf(points)), random.between(0.55, 0.8), 0.85);
  }

  addBlob(growth, new Vector3(0, random.between(0.75, 0.95), 0), random.between(0.75, 0.95), 0.8);

  return finish(growth, TREE_HEIGHTS[PlantSpecies.Bush]);
}

function addFrond(growth: Growth, points: readonly TubePoint[]): void {
  growth.foliage.push({ kind: "frond", points, tint: jitter(growth.random, 0.1) });
}

function frondPath(growth: Growth, start: Vector3, direction: Vector3, shape: FrondShape): TubePoint[] {
  const { droop, length, segments, width } = shape;

  const path = growBranch({
    bend: 0,
    direction,
    gravity: droop,
    length,
    noise: growth.noise,
    radiusEnd: 0,
    radiusStart: 0,
    segments,
    start,
    wobble: 0.04,
  });

  return path.map((point, index) => {
    const amount = index / (path.length - 1);

    return { ...point, radius: width * Math.sin(Math.PI * Math.min(1, 0.12 + amount * 0.95)) };
  });
}

function palm(seed: number): TreeStructure {
  const growth = createGrowth(seed);

  const { random } = growth;

  const leanAngle = random.next() * FULL_TURN;
  const lean = random.between(0.12, 0.38);

  const trunk = growBranch({
    bend: 0.035,
    direction: new Vector3(Math.cos(leanAngle) * lean, 1, Math.sin(leanAngle) * lean),
    gravity: 0,
    length: random.between(8, 9.5),
    noise: growth.noise,
    radiusEnd: 0.19,
    radiusStart: 0.3,
    segments: 6,
    start: new Vector3(),
    wobble: 0.05,
  });

  growth.branches.push({
    depth: 0,
    points: rooted(
      trunk.map((point, index) => {
        return index === 0 ? { ...point, radius: 0.42 } : point;
      })
    ),
  });

  const crown = toVector(tipOf(trunk));

  addBlob(growth, crown.clone().add(new Vector3(0, 0.1, 0)), 0.62, 0.8);

  const fronds = random.integer(10, 14);

  for (let frond = 0; frond < fronds; frond += 1) {
    const azimuth = frond * GOLDEN_ANGLE + jitter(random, 0.25);
    const rise = random.between(-0.05, 0.75);
    const direction = new Vector3(Math.cos(azimuth), rise, Math.sin(azimuth));

    addFrond(
      growth,
      frondPath(growth, crown, direction, {
        droop: random.between(0.32, 0.5),
        length: random.between(3.6, 4.8),
        segments: 8,
        width: random.between(0.55, 0.7),
      })
    );
  }

  return finish(growth, TREE_HEIGHTS[PlantSpecies.Palm]);
}

function acacia(seed: number): TreeStructure {
  const growth = createGrowth(seed);

  const { random } = growth;

  const trunk = addTrunk(growth, {
    height: random.between(2.4, 3.4),
    isForked: true,
    lean: random.between(0.05, 0.22),
    radiusBottom: 0.34,
    radiusTop: 0.26,
    segments: 3,
    wobble: 0.2,
  });

  const crownHeight = random.between(6.8, 7.8);
  const limbCount = random.integer(3, 5);

  for (let limb = 0; limb < limbCount; limb += 1) {
    const azimuth = (limb / limbCount) * FULL_TURN + jitter(random, 0.5);

    const main = addLimb(growth, trunk, random.between(0.85, 1), azimuth, {
      bend: 0.05,
      depth: 1,
      gravity: 0,
      length: random.between(4.4, 5.6),
      radiusEnd: 0.08,
      segments: 4,
      tilt: random.between(0.55, 0.85),
      wobble: 0.3,
    });

    const tip = toVector(tipOf(main));

    for (let twig = 0; twig < 2; twig += 1) {
      const offshoot = addLimb(growth, main, random.between(0.55, 0.85), random.next() * FULL_TURN, {
        bend: 0.02,
        depth: 2,
        gravity: 0,
        length: random.between(1.6, 2.4),
        radiusEnd: 0.03,
        segments: 3,
        tilt: random.between(0.7, 1.1),
        wobble: 0.3,
      });

      const end = toVector(tipOf(offshoot));

      addBlob(growth, end.setY(Math.max(end.y + 0.3, crownHeight - 0.6)), random.between(1.9, 2.5), 0.3);
    }

    addBlob(growth, tip.setY(Math.max(tip.y + 0.3, crownHeight)), random.between(2.4, 3.1), 0.3);
  }

  return finish(growth, TREE_HEIGHTS[PlantSpecies.Acacia]);
}

function poplar(seed: number): TreeStructure {
  const growth = createGrowth(seed);

  const { random } = growth;

  const height = random.between(18, 20.5);

  const trunk = addTrunk(growth, {
    height,
    isForked: false,
    lean: random.between(0, 0.04),
    radiusBottom: 0.4,
    radiusTop: 0.07,
    segments: 6,
    wobble: 0.06,
  });

  const branchCount = random.integer(6, 9);

  for (let branch = 0; branch < branchCount; branch += 1) {
    const along = lerp(0.22, 0.85, branch / branchCount);

    addLimb(growth, trunk, along, branch * GOLDEN_ANGLE, {
      bend: 0.12,
      depth: 1,
      gravity: 0,
      length: random.between(2, 3.2),
      radiusEnd: 0.03,
      segments: 3,
      tilt: random.between(0.3, 0.5),
      wobble: 0.15,
    });
  }

  const tiers = random.integer(4, 6);

  for (let tier = 0; tier < tiers; tier += 1) {
    const amount = (tier + 0.5) / tiers;
    const center = toVector(pointAlong(trunk, lerp(0.3, 0.9, amount)));
    const radius = (1.5 + Math.sin(amount * Math.PI) * 0.6) * random.between(0.9, 1.1);

    addBlob(
      growth,
      center.add(new Vector3(jitter(random, 0.3), 0, jitter(random, 0.3))),
      radius,
      random.between(1.7, 2.2)
    );
  }

  tuckTrunk(growth, blobCeiling(growth.foliage));

  return finish(growth, TREE_HEIGHTS[PlantSpecies.Poplar]);
}

function blobCeiling(foliage: readonly Foliage[]): number {
  return foliage.reduce((ceiling, item) => {
    if (item.kind !== "blob") {
      return ceiling;
    }

    return Math.max(ceiling, item.center[1] + item.radius * item.squash * BLOB_COVER);
  }, 0);
}

function deadTree(seed: number): TreeStructure {
  const growth = createGrowth(seed);

  const { random } = growth;

  const isStump = random.chance(0.25);

  const trunk = addTrunk(growth, {
    height: isStump ? random.between(3.5, 5) : random.between(7, 9.5),
    isForked: false,
    lean: random.between(0, 0.18),
    radiusBottom: 0.42,
    radiusTop: isStump ? 0.3 : 0.1,
    segments: 5,
    wobble: 0.22,
  });

  const limbCount = isStump ? random.integer(0, 2) : random.integer(2, 5);

  for (let limb = 0; limb < limbCount; limb += 1) {
    const main = addLimb(growth, trunk, random.between(0.4, 0.85), limb * GOLDEN_ANGLE + jitter(random, 0.6), {
      bend: random.between(-0.02, 0.06),
      depth: 1,
      gravity: random.between(0, 0.08),
      length: random.between(1.6, 3.4),
      radiusEnd: 0.03,
      segments: 3,
      tilt: random.between(0.7, 1.3),
      wobble: 0.45,
    });

    if (random.chance(0.6)) {
      addLimb(growth, main, random.between(0.4, 0.7), random.next() * FULL_TURN, {
        bend: 0.04,
        depth: 2,
        gravity: 0.02,
        length: random.between(0.7, 1.4),
        radiusEnd: 0.015,
        segments: 2,
        tilt: random.between(0.5, 0.9),
        wobble: 0.4,
      });
    }
  }

  return finish(growth, TREE_HEIGHTS[PlantSpecies.DeadTree]);
}

function addSagebrush(growth: Growth): void {
  const { random } = growth;

  const stems = random.integer(7, 11);

  for (let stem = 0; stem < stems; stem += 1) {
    const angle = (stem / stems) * FULL_TURN + jitter(random, 0.4);
    const tilt = random.between(0.55, 1.05);

    const points = growBranch({
      bend: 0.05,
      direction: tiltedDirection(angle, tilt),
      gravity: 0.2,
      length: random.between(0.5, 0.85),
      noise: growth.noise,
      radiusEnd: 0.012,
      radiusStart: 0.035,
      segments: 3,
      start: new Vector3(jitter(random, 0.08), 0, jitter(random, 0.08)),
      wobble: 0.5,
    });

    growth.branches.push({ depth: 1, points });
    addBlob(growth, toVector(tipOf(points)), random.between(0.28, 0.4), 0.65);
  }

  addBlob(growth, new Vector3(0, random.between(0.5, 0.65), 0), random.between(0.5, 0.6), 0.7);
}

function addRosette(growth: Growth): void {
  const { random } = growth;

  const leaves = random.integer(16, 24);

  for (let leaf = 0; leaf < leaves; leaf += 1) {
    const azimuth = leaf * GOLDEN_ANGLE;
    const rise = lerp(0.35, 3, leaf / leaves) * random.between(0.85, 1.15);
    const direction = new Vector3(Math.cos(azimuth), rise, Math.sin(azimuth));
    const start = new Vector3(Math.cos(azimuth) * 0.05, 0, Math.sin(azimuth) * 0.05);

    addFrond(
      growth,
      frondPath(growth, start, direction, { droop: 0.04, length: random.between(0.6, 0.85), segments: 4, width: 0.05 })
    );
  }

  const stalk = growBranch({
    bend: 0.1,
    direction: new Vector3(jitter(random, 0.1), 1, jitter(random, 0.1)),
    gravity: 0,
    length: random.between(1, 1.3),
    noise: growth.noise,
    radiusEnd: 0.012,
    radiusStart: 0.03,
    segments: 3,
    start: new Vector3(),
    wobble: 0.2,
  });

  growth.branches.push({ depth: 1, points: stalk });
}

function addGrassTuft(growth: Growth): void {
  const { random } = growth;

  const blades = random.integer(14, 20);

  for (let blade = 0; blade < blades; blade += 1) {
    const azimuth = random.next() * FULL_TURN;
    const tilt = random.between(0.12, 0.65);

    const direction = tiltedDirection(azimuth, tilt);
    const start = new Vector3(Math.cos(azimuth) * 0.08, 0, Math.sin(azimuth) * 0.08);

    addFrond(
      growth,
      frondPath(growth, start, direction, {
        droop: random.between(0.2, 0.6),
        length: random.between(0.55, 1.05),
        segments: 4,
        width: 0.03,
      })
    );
  }
}

function desertShrub(seed: number, variant: number): TreeStructure {
  const growth = createGrowth(seed);

  DESERT_SHRUB_FORMS[variant % DESERT_SHRUB_FORMS.length](growth);

  return finish(growth, TREE_HEIGHTS[PlantSpecies.DesertShrub]);
}
