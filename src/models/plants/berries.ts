import { Vector3 } from "three";
import { FULL_TURN, fractionalPart, lerp } from "../../shared/math.ts";
import { createRandom } from "../../shared/random.ts";
import { MaterialSlot } from "../materials.ts";
import { MeshBuilder } from "../mesh/mesh-builder.ts";
import type { MeshData } from "../mesh/mesh-data.ts";
import type { Shape } from "../mesh/shape.ts";
import { icosphere, sphere } from "../mesh/shapes.ts";
import { outermostHit } from "../mesh/surface-probe.ts";
import { transformOf } from "../mesh/transforms.ts";
import { crownCenter, FOLIAGE_FLUTTER, type NearLevel, plantSway, type TreeLook } from "./tree-mesher.ts";
import { GOLDEN_ANGLE, perpendicularBasis, type TreeStructure } from "./tree-structure.ts";

export const BERRY_PART = 1;
export const BERRY_RADIUS = 0.062;

const CLUSTER_RIPENING_STEP = 0.618_034;
const BERRIES_PER_CLUSTER = 3;
const CLUSTER_SPREAD = 0.072;
const LONGEST_REACH = CLUSTER_SPREAD * 2.5;
const BERRY_LIFT = 0.35;
const HIGHEST_CLUSTER = 0.9;
const LOWEST_CLUSTER = -0.05;
const CLUSTER_COUNTS: Readonly<Record<NearLevel, number>> = { high: 8, medium: 4 };

function berryPart(cluster: number, berry: number): number {
  const ripening = (berry + fractionalPart(cluster * CLUSTER_RIPENING_STEP)) / BERRIES_PER_CLUSTER;

  return BERRY_PART + ripening;
}

function berryShape(level: NearLevel): Shape {
  if (level === "high") {
    return icosphere(BERRY_RADIUS, 0);
  }

  return sphere(BERRY_RADIUS * 1.1, 4, 2);
}

function clusterDirection(cluster: number, clusters: number, twist: number): Vector3 {
  const azimuth = twist + cluster * GOLDEN_ANGLE;
  const height = lerp(HIGHEST_CLUSTER, LOWEST_CLUSTER, (cluster + 0.5) / clusters);
  const horizontal = Math.sqrt(1 - height * height);

  return new Vector3(Math.cos(azimuth) * horizontal, height, Math.sin(azimuth) * horizontal);
}

export function berryClusters(
  tree: MeshData,
  structure: TreeStructure,
  look: TreeLook,
  seed: number,
  level: NearLevel
): MeshData {
  const random = createRandom(seed);
  const builder = new MeshBuilder({ flutter: FOLIAGE_FLUTTER, slot: MaterialSlot.Berry });
  const middle = crownCenter(structure);
  const clusters = CLUSTER_COUNTS[level];
  const shape = berryShape(level);
  const twist = random.next() * FULL_TURN;

  function isFoliage(triangle: number): boolean {
    return tree.channels.slot[tree.indices[triangle * 3]] === look.foliage;
  }

  function addBerry(position: Vector3, part: number): void {
    builder.add(shape, {
      style: { part, sway: plantSway(position.y, structure.height) },
      transform: transformOf({ position: position.toArray() }),
    });
  }

  for (let cluster = 0; cluster < clusters; cluster += 1) {
    const anchor = outermostHit(tree, middle, clusterDirection(cluster, clusters, twist), isFoliage);
    const turn = random.next() * FULL_TURN;

    if (anchor === null) {
      continue;
    }

    const [across, along] = perpendicularBasis(anchor.normal);

    for (let berry = 0; berry < BERRIES_PER_CLUSTER; berry += 1) {
      const angle = turn + (berry / BERRIES_PER_CLUSTER) * FULL_TURN;

      const target = anchor.point
        .clone()
        .addScaledVector(across, Math.cos(angle) * CLUSTER_SPREAD)
        .addScaledVector(along, Math.sin(angle) * CLUSTER_SPREAD);

      const hit = outermostHit(tree, middle, target.clone().sub(middle), isFoliage);
      const isNearby = hit !== null && hit.point.distanceTo(anchor.point) < LONGEST_REACH;
      const resting = isNearby ? hit : { normal: anchor.normal, point: target };
      const position = resting.point.clone().addScaledVector(resting.normal, BERRY_RADIUS * BERRY_LIFT);

      addBerry(position, berryPart(cluster, berry));
    }
  }

  return builder.build();
}
