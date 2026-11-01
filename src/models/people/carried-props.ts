import { FULL_TURN } from "../../shared/math.ts";
import { createVolumeNoise } from "../../shared/noise.ts";
import { createRandom } from "../../shared/random.ts";
import { MaterialSlot, type MaterialSlotIndex } from "../materials.ts";
import type { MeshBuilder } from "../mesh/mesh-builder.ts";
import { blob, icosphere } from "../mesh/shapes.ts";
import { type Triple, transformOf } from "../mesh/transforms.ts";
import type { HumanDetail } from "./human-detail.ts";
import { addBasket, type Basket, CRADLE, inLeftHand, LEFT_FIST, onChest } from "./prop-placement.ts";

const LOAD_NOISE = createVolumeNoise(createRandom(5151));

const FRUIT_BASKET: Basket = {
  depth: 0.28,
  profile: [
    { radius: 0, y: 0 },
    { radius: 0.08, y: 0.004 },
    { radius: 0.11, y: 0.055 },
    { radius: 0.12, y: 0.12 },
    { radius: 0.112, y: 0.135 },
    { radius: 0.1, y: 0.128 },
    { radius: 0.092, y: 0.065 },
    { radius: 0, y: 0.055 },
  ],
  rimHeight: 0.13,
  rimRadius: 0.108,
  rimStretch: 1.35,
  rimThickness: 0.008,
};

interface Lump {
  readonly offset: Triple;
  readonly radius: number;
  readonly slot: MaterialSlotIndex;
}

const ORE_LUMPS: readonly Lump[] = [
  { offset: [-0.07, -0.05, 0.01], radius: 0.085, slot: MaterialSlot.Stone },
  { offset: [0.075, -0.045, -0.01], radius: 0.08, slot: MaterialSlot.Stone },
  { offset: [0, 0.02, 0.02], radius: 0.075, slot: MaterialSlot.Stone },
  { offset: [-0.03, 0.05, 0.05], radius: 0.035, slot: MaterialSlot.IronOre },
  { offset: [0.05, 0.03, 0.05], radius: 0.03, slot: MaterialSlot.CopperOre },
];

export function addCarriedOre(builder: MeshBuilder, detail: HumanDetail): void {
  const [x, y, z] = CRADLE;

  for (const [index, lump] of ORE_LUMPS.entries()) {
    const [offsetX, offsetY, offsetZ] = lump.offset;

    builder.add(
      blob({
        detail: detail.propSubdivisions,
        noise: LOAD_NOISE,
        offset: [index * 3.1, index * 1.7, index * 2.3],
        radius: lump.radius,
        roughness: 0.35,
      }),
      {
        style: onChest(lump.slot),
        transform: transformOf({ position: [x + offsetX, y - 0.04 + offsetY, z + offsetZ], scale: [1.1, 0.85, 1] }),
      }
    );
  }
}

export function addCarriedClay(builder: MeshBuilder, detail: HumanDetail): void {
  const [x, y, z] = CRADLE;

  builder.add(
    blob({
      detail: detail.propSubdivisions + 1,
      noise: LOAD_NOISE,
      offset: [4, 8, 2],
      radius: 0.12,
      roughness: 0.12,
    }),
    {
      style: onChest(MaterialSlot.Clay),
      transform: transformOf({ position: [x, y - 0.035, z], scale: [1.35, 0.82, 1] }),
    }
  );
}

export function addCarriedFruit(builder: MeshBuilder, detail: HumanDetail): void {
  const [x, , z] = LEFT_FIST;

  const apples = detail.hasSmallParts ? 7 : 4;
  const bottom = addBasket(builder, detail, FRUIT_BASKET);

  for (let apple = 0; apple < apples; apple += 1) {
    const angle = (apple / apples) * FULL_TURN;
    const reach = apple === 0 ? 0 : 0.058;

    builder.add(icosphere(0.036, 0), {
      style: inLeftHand(MaterialSlot.Apple),
      transform: transformOf({
        position: [x + Math.cos(angle) * reach, bottom + 0.118 + (apple % 2) * 0.014, z + Math.sin(angle) * reach],
      }),
    });
  }
}
