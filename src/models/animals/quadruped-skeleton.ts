import { onSide, type Side, type Triple } from "../mesh/transforms.ts";
import { type BoneDefinition, type ContactPoint, createSkeleton, NO_PARENT, type Skeleton } from "../rig/skeleton.ts";

export const QuadrupedBone = {
  Chest: 2,
  Head: 4,
  HoofFrontLeft: 8,
  HoofFrontRight: 11,
  HoofHindLeft: 14,
  HoofHindRight: 17,
  LowerFrontLeft: 7,
  LowerFrontRight: 10,
  LowerHindLeft: 13,
  LowerHindRight: 16,
  Neck: 3,
  Pelvis: 0,
  Spine: 1,
  Tail: 5,
  UpperFrontLeft: 6,
  UpperFrontRight: 9,
  UpperHindLeft: 12,
  UpperHindRight: 15,
} as const;

export const FIRST_EXTRA_BONE = Object.keys(QuadrupedBone).length;
export const LEG_ENDS: readonly LegEnd[] = ["front", "hind"];

type LegJoints = readonly [upper: Triple, lower: Triple, hoof: Triple];

export interface QuadrupedFrame {
  readonly bodyContacts: readonly ContactPoint[];
  readonly chest: Triple;
  readonly extraBones: readonly BoneDefinition[];
  readonly frontHoof: Triple;
  readonly frontLeg: LegJoints;
  readonly head: Triple;
  readonly hindHoof: Triple;
  readonly hindLeg: LegJoints;
  readonly neck: Triple;
  readonly pelvis: Triple;
  readonly spine: Triple;
  readonly tail: Triple;
}

export type LegEnd = "front" | "hind";

export type SideName = "left" | "right";

interface LegBones {
  readonly hoof: number;
  readonly lower: number;
  readonly upper: number;
}

const LEG_BONES: Readonly<Record<LegEnd, Readonly<Record<SideName, LegBones>>>> = {
  front: {
    left: {
      hoof: QuadrupedBone.HoofFrontLeft,
      lower: QuadrupedBone.LowerFrontLeft,
      upper: QuadrupedBone.UpperFrontLeft,
    },
    right: {
      hoof: QuadrupedBone.HoofFrontRight,
      lower: QuadrupedBone.LowerFrontRight,
      upper: QuadrupedBone.UpperFrontRight,
    },
  },
  hind: {
    left: { hoof: QuadrupedBone.HoofHindLeft, lower: QuadrupedBone.LowerHindLeft, upper: QuadrupedBone.UpperHindLeft },
    right: {
      hoof: QuadrupedBone.HoofHindRight,
      lower: QuadrupedBone.LowerHindRight,
      upper: QuadrupedBone.UpperHindRight,
    },
  },
};

export function sideName(side: Side): SideName {
  return side === 1 ? "left" : "right";
}

export function legBones(end: LegEnd, side: Side): LegBones {
  return LEG_BONES[end][sideName(side)];
}

function legDefinitions(frame: QuadrupedFrame, end: LegEnd, side: Side): BoneDefinition[] {
  const bones = legBones(end, side);
  const joints = end === "front" ? frame.frontLeg : frame.hindLeg;
  const parent = end === "front" ? QuadrupedBone.Chest : QuadrupedBone.Pelvis;
  const name = `${end === "front" ? "Front" : "Hind"}${side === 1 ? "Left" : "Right"}`;

  return [
    { joint: onSide(joints[0], side), name: `upper${name}`, order: "limb", parent },
    { joint: onSide(joints[1], side), name: `lower${name}`, order: "limb", parent: bones.upper },
    { joint: onSide(joints[2], side), name: `hoof${name}`, order: "limb", parent: bones.lower },
  ];
}

function hoofContacts(frame: QuadrupedFrame, end: LegEnd, side: Side): ContactPoint[] {
  const { hoof } = legBones(end, side);
  const [x, , z] = end === "front" ? frame.frontHoof : frame.hindHoof;

  return [
    { bone: hoof, position: [x * side, 0, z - 0.04] },
    { bone: hoof, position: [x * side, 0, z + 0.05] },
  ];
}

export function createQuadrupedSkeleton(frame: QuadrupedFrame): Skeleton {
  return createSkeleton({
    bodyContacts: frame.bodyContacts,
    bones: [
      { joint: frame.pelvis, name: "pelvis", parent: NO_PARENT },
      { joint: frame.spine, name: "spine", parent: QuadrupedBone.Pelvis },
      { joint: frame.chest, name: "chest", parent: QuadrupedBone.Spine },
      { joint: frame.neck, name: "neck", parent: QuadrupedBone.Chest },
      { joint: frame.head, name: "head", parent: QuadrupedBone.Neck },
      { joint: frame.tail, name: "tail", parent: QuadrupedBone.Pelvis },
      ...legDefinitions(frame, "front", 1),
      ...legDefinitions(frame, "front", -1),
      ...legDefinitions(frame, "hind", 1),
      ...legDefinitions(frame, "hind", -1),
      ...frame.extraBones,
    ],
    footContacts: [
      ...hoofContacts(frame, "front", 1),
      ...hoofContacts(frame, "front", -1),
      ...hoofContacts(frame, "hind", 1),
      ...hoofContacts(frame, "hind", -1),
    ],
  });
}
