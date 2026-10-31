import { Matrix4, Quaternion, Vector3 } from "three";
import { ANGLES_PER_BONE, type Pose, RotationAxis } from "./pose.ts";
import { type ContactPoint, contactsFor, type Grounding, NO_PARENT, type Skeleton } from "./skeleton.ts";

export const PALETTE_FLOATS_PER_BONE = 12;

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);
const UNIT_SCALE = new Vector3(1, 1, 1);
const turn = new Quaternion();

interface RestContact {
  readonly bone: number;
  readonly point: Vector3;
}

function turned(rotation: Quaternion, axis: Vector3, angle: number): Quaternion {
  if (angle === 0) {
    return rotation;
  }

  return rotation.multiply(turn.setFromAxisAngle(axis, angle));
}

export function boneRotation(angles: Float32Array, bone: number, isLimb: boolean, target: Quaternion): Quaternion {
  const offset = bone * ANGLES_PER_BONE;

  const pitch = angles[offset + RotationAxis.Pitch];
  const roll = angles[offset + RotationAxis.Roll];
  const yaw = angles[offset + RotationAxis.Yaw];

  if (isLimb) {
    return turned(turned(target.setFromAxisAngle(AXIS_X, pitch), AXIS_Z, roll), AXIS_Y, yaw);
  }

  return turned(turned(target.setFromAxisAngle(AXIS_Z, roll), AXIS_X, pitch), AXIS_Y, yaw);
}

function restContacts(contacts: readonly ContactPoint[]): RestContact[] {
  return contacts.map((contact) => {
    return { bone: contact.bone, point: new Vector3(...contact.position) };
  });
}

function restOffset(joints: readonly Vector3[], parent: number, index: number): Vector3 {
  const joint = joints[index];

  if (parent === NO_PARENT) {
    return joint.clone();
  }

  return joint.clone().sub(joints[parent]);
}

export class SkeletonPoser {
  readonly #contacts: Readonly<Record<Grounding, readonly RestContact[]>>;
  readonly #fromJoints: readonly Vector3[];
  readonly #isLimb: readonly boolean[];
  readonly #offsets: readonly Vector3[];
  readonly #parents: readonly number[];
  readonly #point = new Vector3();
  readonly #rotation = new Quaternion();
  readonly #skin: readonly Matrix4[];
  readonly #translation = new Vector3();
  readonly #world: readonly Matrix4[];

  constructor(skeleton: Skeleton) {
    const restJoints = skeleton.bones.map((bone) => {
      return new Vector3(...bone.joint);
    });

    this.#contacts = {
      body: restContacts(contactsFor(skeleton, "body")),
      feet: restContacts(contactsFor(skeleton, "feet")),
    };
    this.#fromJoints = restJoints.map((joint) => {
      return joint.clone().negate();
    });
    this.#isLimb = skeleton.bones.map((bone) => {
      return bone.order === "limb";
    });
    this.#parents = skeleton.bones.map((bone) => {
      return bone.parent;
    });
    this.#offsets = skeleton.bones.map((bone, index) => {
      return restOffset(restJoints, bone.parent, index);
    });
    this.#world = skeleton.bones.map(() => {
      return new Matrix4();
    });
    this.#skin = skeleton.bones.map(() => {
      return new Matrix4();
    });
  }

  pose(pose: Pose, scales: Float32Array): void {
    for (let index = 0; index < this.#parents.length; index += 1) {
      this.#poseBone(index, pose, scales);
    }

    this.#placeOnGround(pose);
  }

  writePalette(target: Float32Array, offset: number): void {
    for (let index = 0; index < this.#skin.length; index += 1) {
      const { elements } = this.#skin[index];

      const start = offset + index * PALETTE_FLOATS_PER_BONE;

      target[start] = elements[0];
      target[start + 1] = elements[4];
      target[start + 2] = elements[8];
      target[start + 3] = elements[12];
      target[start + 4] = elements[1];
      target[start + 5] = elements[5];
      target[start + 6] = elements[9];
      target[start + 7] = elements[13];
      target[start + 8] = elements[2];
      target[start + 9] = elements[6];
      target[start + 10] = elements[10];
      target[start + 11] = elements[14];
    }
  }

  jointPosition(bone: number, target: Vector3): Vector3 {
    return target.setFromMatrixPosition(this.#world[bone]);
  }

  skinPoint(bone: number, restPoint: Vector3, target: Vector3): Vector3 {
    return target.copy(restPoint).applyMatrix4(this.#skin[bone]);
  }

  #poseBone(index: number, pose: Pose, scales: Float32Array): void {
    const parent = this.#parents[index];

    boneRotation(pose.angles, index, this.#isLimb[index], this.#rotation);
    this.#translation.copy(this.#offsets[index]);

    if (parent !== NO_PARENT) {
      this.#translation.x *= scales[parent * 3];
      this.#translation.y *= scales[parent * 3 + 1];
      this.#translation.z *= scales[parent * 3 + 2];
    }

    const world = this.#world[index].compose(this.#translation, this.#rotation, UNIT_SCALE);

    if (parent !== NO_PARENT) {
      world.premultiply(this.#world[parent]);
    }

    this.#writeSkin(index, world, scales);
  }

  #writeSkin(index: number, world: Matrix4, scales: Float32Array): void {
    const fromJoint = this.#fromJoints[index];
    const placed = world.elements;
    const { elements } = this.#skin[index];

    const scaleX = scales[index * 3];
    const scaleY = scales[index * 3 + 1];
    const scaleZ = scales[index * 3 + 2];

    for (let row = 0; row < 4; row += 1) {
      const x = placed[row] * scaleX;
      const y = placed[row + 4] * scaleY;
      const z = placed[row + 8] * scaleZ;

      elements[row] = x;
      elements[row + 4] = y;
      elements[row + 8] = z;
      elements[row + 12] = x * fromJoint.x + y * fromJoint.y + z * fromJoint.z + placed[row + 12];
    }
  }

  #placeOnGround(pose: Pose): void {
    let lowest = Number.POSITIVE_INFINITY;

    for (const contact of this.#contacts[pose.grounding]) {
      this.#point.copy(contact.point).applyMatrix4(this.#skin[contact.bone]);
      lowest = Math.min(lowest, this.#point.y);
    }

    const lift = pose.height - lowest;

    for (const matrix of this.#world) {
      matrix.elements[13] += lift;
    }

    for (const matrix of this.#skin) {
      matrix.elements[13] += lift;
    }
  }
}
