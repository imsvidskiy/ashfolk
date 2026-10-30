import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { Pose } from "../rig/pose.ts";
import { SkeletonPoser } from "../rig/skeleton-poser.ts";
import { isTorso, loosePieces, TOUCHING } from "../testing/mesh-connectivity.ts";
import { posedMesh } from "../testing/moved-mesh.ts";
import { ADULT, humanPartsMesh, jointOf, pointOf, posedHuman, TRIBE } from "../testing/posed-human.ts";
import { personAppearance } from "./appearance.ts";
import { applyHumanClip } from "./human-clips.ts";
import { HUMAN_DETAILS } from "./human-detail.ts";
import { buildHumanParts, type HumanPart } from "./human-model.ts";
import { humanBoneScales } from "./human-proportions.ts";
import { HUMAN_SKELETON, HumanBone } from "./human-skeleton.ts";
import { LEFT_FIST, RIGHT_FIST } from "./prop-placement.ts";

const RIGHT_FIST_POINT = new Vector3(...RIGHT_FIST);
const LEFT_FIST_POINT = new Vector3(...LEFT_FIST);
const SPEAR_TIP = new Vector3(-0.217, 0.832, 1.13);
const parts = buildHumanParts(HUMAN_DETAILS.high);

describe("fight clips", () => {
  it("raise the spear above the head on the march", () => {
    const marching = posedHuman("march", 0.3);

    expect(pointOf(marching, HumanBone.HandRight, SPEAR_TIP).y).toBeGreaterThan(jointOf(marching, HumanBone.Head).y);
  });

  it("drive the spear point forward and level in a thrust", () => {
    const guard = posedHuman("thrust", 0.1);
    const lunge = posedHuman("thrust", 0.6);

    const guardTip = pointOf(guard, HumanBone.HandRight, SPEAR_TIP);
    const lungeTip = pointOf(lunge, HumanBone.HandRight, SPEAR_TIP);
    const lungeFist = pointOf(lunge, HumanBone.HandRight, RIGHT_FIST_POINT);

    expect(lungeTip.z).toBeGreaterThan(guardTip.z + 0.25);
    expect(lungeTip.z).toBeGreaterThan(1.2);
    expect(Math.abs(lungeTip.y - lungeFist.y)).toBeLessThan(0.35);
  });

  it("raise the guard to parry a blow", () => {
    const parry = posedHuman("block", 0.2);

    expect(pointOf(parry, HumanBone.HandLeft, LEFT_FIST_POINT).y).toBeGreaterThan(1.3);
    expect(pointOf(parry, HumanBone.HandRight, RIGHT_FIST_POINT).y).toBeGreaterThan(1.3);
  });

  it("jerk the head back when struck and settle again", () => {
    const struck = posedHuman("flinch", 0.2);
    const settled = posedHuman("flinch", 0.99);

    expect(jointOf(struck, HumanBone.Head).z).toBeLessThan(jointOf(settled, HumanBone.Head).z - 0.05);
  });

  it("fall to the ground and end lying like the dead", () => {
    const toppling = posedHuman("fall", 0.3);
    const fallen = posedHuman("fall", 0.95);
    const dead = posedHuman("dead", 0);

    expect(jointOf(toppling, HumanBone.Pelvis).y).toBeGreaterThan(0.4);
    expect(jointOf(fallen, HumanBone.Pelvis).y).toBeLessThan(0.3);
    expect(jointOf(fallen, HumanBone.Head).distanceTo(jointOf(dead, HumanBone.Head))).toBeLessThan(0.15);
  });

  it("keep the weapons in the hands through every fight", () => {
    const appearance = personAppearance({ age: 30, isFemale: false, seed: 0.37, tribe: TRIBE });
    const weapons: readonly HumanPart[] = ["spear", "bow", "quiver", "warPaint"];
    const poser = new SkeletonPoser(HUMAN_SKELETON);
    const pose = new Pose(HUMAN_SKELETON.bones.length);

    for (const clip of ["march", "charge", "thrust", "block", "flinch"] as const) {
      for (const phase of [0.1, 0.45, 0.8]) {
        applyHumanClip(pose, clip, phase, ADULT);
        poser.pose(pose, humanBoneScales(appearance.body));

        const names: HumanPart[] = ["bodyMale", ...weapons];
        const mesh = posedMesh(humanPartsMesh(parts, names), poser);

        expect(loosePieces(mesh, TOUCHING, isTorso), `${clip} ${phase}`).toEqual([]);
      }
    }
  });
});
