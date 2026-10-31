import { MaterialSlot, type MaterialSlotIndex } from "../materials.ts";
import type { MeshBuilder, VertexStyle } from "../mesh/mesh-builder.ts";
import { cylinder, lathe } from "../mesh/shapes.ts";
import { segmentLength, segmentTransform, type Triple, transformOf } from "../mesh/transforms.ts";
import { rigidStyle } from "../rig/skin-weights.ts";
import { type HumanDetail, trimmedRing, trimSegments } from "./human-detail.ts";
import { HumanBone } from "./human-skeleton.ts";

export const RIGHT_FIST: Triple = [-0.217, 0.832, 0.018];
export const LEFT_FIST: Triple = [0.217, 0.832, 0.018];
export const CRADLE: Triple = [0, 1.29, 0.28];

const BASKET_RIM_SEGMENTS = 14;

export interface Basket {
  readonly depth: number;
  readonly profile: Parameters<typeof lathe>[0];
  readonly rimHeight: number;
  readonly rimRadius: number;
  readonly rimStretch: number;
  readonly rimThickness: number;
}

interface Rod {
  readonly end: Triple;
  readonly radius: number;
  readonly start: Triple;
}

function holdStyle(bone: number, slot: MaterialSlotIndex): VertexStyle {
  return { ...rigidStyle(bone), slot };
}

export function inRightHand(slot: MaterialSlotIndex): VertexStyle {
  return holdStyle(HumanBone.HandRight, slot);
}

export function inLeftHand(slot: MaterialSlotIndex): VertexStyle {
  return holdStyle(HumanBone.HandLeft, slot);
}

export function onChest(slot: MaterialSlotIndex): VertexStyle {
  return holdStyle(HumanBone.Chest, slot);
}

export function addRod(builder: MeshBuilder, detail: HumanDetail, rod: Rod, style: VertexStyle): void {
  const { end, radius, start } = rod;

  builder.add(
    cylinder({
      height: segmentLength(start, end),
      radialSegments: trimSegments(detail, 6),
      radiusBottom: radius,
      radiusTop: radius * 0.9,
    }),
    { style, transform: segmentTransform(start, end) }
  );
}

export function basketBottom(basket: Basket): number {
  return LEFT_FIST[1] - basket.depth;
}

export function addBasket(builder: MeshBuilder, detail: HumanDetail, basket: Basket): void {
  const [x, , z] = LEFT_FIST;

  const bottom = basketBottom(basket);

  builder.add(lathe(basket.profile, detail.limbSegments + 3), {
    style: inLeftHand(MaterialSlot.Thatch),
    transform: transformOf({ position: [x, bottom, z] }),
  });
  builder.add(trimmedRing(detail, basket.rimRadius, basket.rimThickness, BASKET_RIM_SEGMENTS), {
    style: inLeftHand(MaterialSlot.Wood),
    transform: transformOf({
      position: [x, bottom + basket.rimHeight, z],
      rotation: [0, 0, Math.PI / 2],
      scale: [basket.rimStretch, 1, 1],
    }),
  });
}
