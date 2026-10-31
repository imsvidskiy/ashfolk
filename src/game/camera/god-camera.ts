import { type PerspectiveCamera, Vector3 } from "three/webgpu";
import { clamp, wrapAngle } from "../../shared/math.ts";

const MAXIMUM_DISTANCE_IN_HALF_SIZES = 3.5;
const MAXIMUM_PITCH = 1.48;
const MINIMUM_DISTANCE = 4;
const OPENING_DISTANCE_IN_HALF_SIZES = 1.6;
const OPENING_PITCH = 0.82;
const OPENING_YAW = 0.6;
const TARGET_LIMIT_IN_HALF_SIZES = 1.05;
const MINIMUM_PITCH = 0.08;
const SMOOTHING_RATE = 9;
const ARRIVAL_RATE = 0;
const ARRIVAL_RATE_GROWTH = 1.2;
const SKETCH_HEIGHT_SHARE = 0.72;
const SKETCH_WIDTH_SHARE = 0.86;
const CLEARANCE = 1.2;
const CLEARANCE_PER_DISTANCE = 0.02;
const LEVEL_PAN_SLANT = 0.4;
const PAN_SLANT_PER_SINE = 0.6;
const SHAKE_DECAY_RATE = 4;
const SMALLEST_SHAKE = 0.01;
const SCREEN_CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;

export interface CameraState {
  readonly distance: number;
  readonly pitch: number;
  readonly targetX: number;
  readonly targetZ: number;
  readonly yaw: number;
}

export interface GroundPoint {
  readonly x: number;
  readonly z: number;
}

type MutableCameraState = { -readonly [Key in keyof CameraState]: number };

type HeightProbe = (x: number, z: number) => number;

function groundPointAlong(origin: Vector3, direction: Vector3, level: number, reach: number): GroundPoint {
  const horizontal = Math.max(1e-6, Math.hypot(direction.x, direction.z));

  const travel = direction.y < 0 ? (level - origin.y) / direction.y : Number.POSITIVE_INFINITY;
  const distance = travel > 0 ? Math.min(reach, travel * horizontal) : reach;

  return { x: origin.x + (direction.x / horizontal) * distance, z: origin.z + (direction.z / horizontal) * distance };
}

export class GodCamera {
  readonly camera: PerspectiveCamera;
  readonly #current: MutableCameraState;
  readonly #goal: MutableCameraState;
  readonly #heightAt: HeightProbe;
  readonly #maximumDistance: number;
  readonly #offset = new Vector3();
  readonly #position = new Vector3();
  readonly #ray = new Vector3();
  readonly #target = new Vector3();
  readonly #targetCopy = new Vector3();
  readonly #worldHalfSize: number;
  #follow: (() => GroundPoint | null) | null = null;
  #rate = SMOOTHING_RATE;
  #shake = 0;
  #targetHeight: number;

  constructor(camera: PerspectiveCamera, heightAt: HeightProbe, worldHalfSize: number) {
    this.camera = camera;
    this.#heightAt = heightAt;
    this.#worldHalfSize = worldHalfSize;
    this.#maximumDistance = worldHalfSize * MAXIMUM_DISTANCE_IN_HALF_SIZES;
    this.#goal = {
      distance: worldHalfSize * OPENING_DISTANCE_IN_HALF_SIZES,
      pitch: OPENING_PITCH,
      targetX: 0,
      targetZ: 0,
      yaw: OPENING_YAW,
    };
    this.#current = { ...this.#goal };
    this.#targetHeight = heightAt(0, 0);
  }

  get isFollowing(): boolean {
    return this.#follow !== null;
  }

  get state(): CameraState {
    return { ...this.#current };
  }

  get target(): Vector3 {
    return this.#targetCopy.copy(this.#target);
  }

  groundFootprint(reach: number): GroundPoint[] {
    const { camera } = this;

    camera.updateMatrixWorld();

    return SCREEN_CORNERS.map(([column, row]) => {
      const direction = this.#ray.set(column, row, 0.5).unproject(camera).sub(camera.position).normalize();

      return groundPointAlong(camera.position, direction, this.#targetHeight, reach);
    });
  }

  jumpTo(state: Partial<CameraState>): void {
    Object.assign(this.#goal, state);
    this.#clampGoal();
    Object.assign(this.#current, this.#goal);
    this.#targetHeight = this.#heightAt(this.#current.targetX, this.#current.targetZ);
    this.#place();
  }

  arriveFromAbove(): void {
    const halfView = this.#halfViewTangent();
    const share = Math.min(SKETCH_HEIGHT_SHARE, SKETCH_WIDTH_SHARE * this.camera.aspect);

    Object.assign(this.#current, {
      distance: this.#worldHalfSize / (share * halfView),
      pitch: MAXIMUM_PITCH,
      targetX: 0,
      targetZ: 0,
      yaw: 0,
    });
    this.#rate = ARRIVAL_RATE;
    this.#place();
  }

  flyTo(state: Partial<CameraState>): void {
    this.#follow = null;
    Object.assign(this.#goal, state);
    this.#clampGoal();
  }

  setDistance(distance: number): void {
    this.#goal.distance = distance;
    this.#clampGoal();
  }

  orbit(deltaYaw: number, deltaPitch: number): void {
    this.#goal.yaw += deltaYaw;
    this.#goal.pitch += deltaPitch;
    this.#clampGoal();
  }

  zoom(factor: number, focus: GroundPoint | null): void {
    const previous = this.#goal.distance;

    this.#goal.distance *= factor;
    this.#clampGoal();

    if (focus === null || this.#follow !== null) {
      return;
    }

    const pull = 1 - this.#goal.distance / previous;

    this.#goal.targetX += (focus.x - this.#goal.targetX) * pull;
    this.#goal.targetZ += (focus.z - this.#goal.targetZ) * pull;
    this.#clampGoal();
  }

  pan(screenDeltaX: number, screenDeltaY: number, viewportHeight: number): void {
    this.#follow = null;

    const { pitch, yaw } = this.#current;

    const metersPerPixel = (2 * this.#goal.distance * this.#halfViewTangent()) / viewportHeight;
    const slant = LEVEL_PAN_SLANT + PAN_SLANT_PER_SINE * Math.sin(pitch);

    const scale = metersPerPixel / slant;
    const cosine = Math.cos(yaw);
    const sine = Math.sin(yaw);

    this.#goal.targetX += (-screenDeltaX * cosine - screenDeltaY * sine) * scale;
    this.#goal.targetZ += (screenDeltaX * sine - screenDeltaY * cosine) * scale;
    this.#clampGoal();
  }

  moveBy(forward: number, right: number): void {
    this.#follow = null;

    const { yaw } = this.#current;

    const cosine = Math.cos(yaw);
    const sine = Math.sin(yaw);

    this.#goal.targetX += -sine * forward + cosine * right;
    this.#goal.targetZ += -cosine * forward - sine * right;
    this.#clampGoal();
  }

  follow(target: (() => GroundPoint | null) | null): void {
    this.#follow = target;
  }

  shake(amount: number): void {
    this.#shake = Math.max(this.#shake, amount);
  }

  update(seconds: number): void {
    this.#applyFollow();

    this.#rate = Math.min(SMOOTHING_RATE, this.#rate + ARRIVAL_RATE_GROWTH * seconds);

    const blend = 1 - Math.exp(-this.#rate * seconds);
    const current = this.#current;
    const goal = this.#goal;

    current.distance += (goal.distance - current.distance) * blend;
    current.pitch += (goal.pitch - current.pitch) * blend;
    current.targetX += (goal.targetX - current.targetX) * blend;
    current.targetZ += (goal.targetZ - current.targetZ) * blend;
    current.yaw += wrapAngle(goal.yaw - current.yaw) * blend;
    this.#targetHeight += (this.#heightAt(current.targetX, current.targetZ) - this.#targetHeight) * blend;
    this.#shake *= Math.exp(-SHAKE_DECAY_RATE * seconds);
    this.#place();
  }

  #applyFollow(): void {
    if (this.#follow === null) {
      return;
    }

    const target = this.#follow();

    if (target === null) {
      this.#follow = null;

      return;
    }

    this.#goal.targetX = target.x;
    this.#goal.targetZ = target.z;
  }

  #clampGoal(): void {
    const limit = this.#worldHalfSize * TARGET_LIMIT_IN_HALF_SIZES;
    const goal = this.#goal;

    goal.distance = clamp(goal.distance, MINIMUM_DISTANCE, this.#maximumDistance);
    goal.pitch = clamp(goal.pitch, MINIMUM_PITCH, MAXIMUM_PITCH);
    goal.targetX = clamp(goal.targetX, -limit, limit);
    goal.targetZ = clamp(goal.targetZ, -limit, limit);
  }

  #halfViewTangent(): number {
    return Math.tan((this.camera.fov * Math.PI) / 360);
  }

  #place(): void {
    const { distance, pitch, targetX, targetZ, yaw } = this.#current;

    this.#target.set(targetX, this.#targetHeight, targetZ);
    this.#offset
      .set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
      .multiplyScalar(distance);

    const position = this.#position.copy(this.#target).add(this.#offset);

    const ground = this.#heightAt(position.x, position.z) + CLEARANCE + distance * CLEARANCE_PER_DISTANCE;

    position.y = Math.max(position.y, ground);

    if (this.#shake > SMALLEST_SHAKE) {
      position.x += (Math.random() - 0.5) * this.#shake;
      position.y += (Math.random() - 0.5) * this.#shake;
      position.z += (Math.random() - 0.5) * this.#shake;
    }

    this.camera.position.copy(position);
    this.camera.lookAt(this.#target);
  }
}
