import { Vector3 } from "three";
import { FULL_TURN } from "../../shared/math.ts";
import { createRandom } from "../../shared/random.ts";
import { MaterialSlot, type MaterialSlotIndex } from "../materials.ts";
import { MeshBuilder, type VertexStyle } from "../mesh/mesh-builder.ts";
import type { MeshData } from "../mesh/mesh-data.ts";
import type { Shape } from "../mesh/shape.ts";
import { lathe, sphere } from "../mesh/shapes.ts";
import { outermostHit } from "../mesh/surface-probe.ts";
import { transformOf } from "../mesh/transforms.ts";
import { BERRY_PART } from "./berries.ts";
import { FOLIAGE_FLUTTER, type NearLevel, plantSway } from "./tree-mesher.ts";

const HANGING_STEP = 1.45;
const FRUIT_SINK = 0.4;
const PEAR_CENTER = 0.72;

type FruitShape = "pear" | "round";

interface Tessellation {
  readonly rings: number;
  readonly segments: number;
}

export const ROUND_FRUIT: Tessellation = { rings: 3, segments: 5 };
export const DISTANT_BERRY: Tessellation = { rings: 2, segments: 4 };

export interface FruitLook {
  readonly counts: Readonly<Record<NearLevel, number>>;
  readonly hanging: number;
  readonly highest: number;
  readonly lowest: number;
  readonly radius: number;
  readonly shape: FruitShape;
  readonly slot: MaterialSlotIndex;
  readonly tessellation: Readonly<Record<NearLevel, Tessellation>>;
}

interface FruitHost {
  readonly center: Vector3;
  readonly squash: number;
}

export interface FruitPlacement {
  readonly detail: NearLevel;
  readonly height: number;
  readonly hosts: readonly FruitHost[];
  readonly look: FruitLook;
  readonly seed: number;
}

function fruitShape(look: FruitLook, detail: NearLevel): Shape {
  const { rings, segments } = look.tessellation[detail];

  if (look.shape === "round") {
    return sphere(look.radius, segments, rings);
  }

  const { radius } = look;

  return lathe(
    [
      { radius: 0, y: 0 },
      { radius: radius * 0.75, y: radius * 0.18 },
      { radius, y: radius * 0.7 },
      { radius: radius * 0.78, y: radius * 1.35 },
      { radius: radius * 0.42, y: radius * 1.85 },
      { radius: 0, y: radius * 2.2 },
    ],
    segments
  );
}

function fruitLift(look: FruitLook): number {
  if (look.shape === "pear") {
    return -look.radius * 2.2 * PEAR_CENTER;
  }

  return 0;
}

export function fruitMeshes(plant: MeshData, placement: FruitPlacement): MeshData[] {
  const { hosts, look } = placement;

  const random = createRandom(placement.seed);
  const shape = fruitShape(look, placement.detail);
  const lift = fruitLift(look);
  const style: VertexStyle = {
    sway: (point) => {
      return plantSway(point.position.y, placement.height);
    },
  };
  const fruits: MeshData[] = [];

  function isFoliage(triangle: number): boolean {
    return plant.channels.slot[plant.indices[triangle * 3]] === MaterialSlot.Leaf;
  }

  for (let fruit = 0; fruit < look.counts[placement.detail]; fruit += 1) {
    const host = random.pick(hosts);
    const angle = random.next() * FULL_TURN;
    const height = random.between(look.lowest, look.highest);
    const horizontal = Math.sqrt(1 - height * height);
    const outward = new Vector3(Math.cos(angle) * horizontal, height * host.squash, Math.sin(angle) * horizontal);

    const hit = outermostHit(plant, host.center, outward, isFoliage);

    if (hit === null) {
      continue;
    }

    const center = hit.point.clone().addScaledVector(outward.normalize(), -look.radius * FRUIT_SINK);

    for (let link = 0; link <= look.hanging; link += 1) {
      const drop = link * look.radius * HANGING_STEP;
      const builder = new MeshBuilder({ flutter: FOLIAGE_FLUTTER, part: BERRY_PART, slot: look.slot });

      builder.add(shape, {
        style,
        transform: transformOf({ position: [center.x, center.y + lift - drop, center.z] }),
      });

      fruits.push(builder.build());
    }
  }

  return fruits;
}
