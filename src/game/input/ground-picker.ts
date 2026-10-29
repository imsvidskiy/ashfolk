import { type PerspectiveCamera, Raycaster, Vector3 } from "three/webgpu";
import { aimRay } from "./screen-projection.ts";

const LONGEST_RAY = 30_000;
const SHORTEST_STEP = 0.5;
const STEP_PER_DISTANCE = 0.006;
const REFINEMENT_STEPS = 12;

export type HeightField = (x: number, z: number) => number;

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface ViewportSize {
  readonly height: number;
  readonly width: number;
}

export class GroundPicker {
  readonly #camera: PerspectiveCamera;
  readonly #heightAt: HeightField;
  readonly #point = new Vector3();
  readonly #raycaster = new Raycaster();
  readonly #worldHalfSize: number;

  constructor(camera: PerspectiveCamera, heightAt: HeightField, worldHalfSize: number) {
    this.#camera = camera;
    this.#heightAt = heightAt;
    this.#worldHalfSize = worldHalfSize;
  }

  pick(point: ScreenPoint, viewport: ViewportSize): Vector3 | null {
    aimRay(this.#raycaster, this.#camera, point, viewport);

    return this.#march();
  }

  #march(): Vector3 | null {
    const { ray } = this.#raycaster;

    let previous = 0;
    let distance = SHORTEST_STEP;

    while (distance < LONGEST_RAY) {
      ray.at(distance, this.#point);

      if (this.#isUnderground(this.#point)) {
        return this.#refine(previous, distance);
      }

      previous = distance;
      distance += Math.max(SHORTEST_STEP, distance * STEP_PER_DISTANCE);
    }

    return null;
  }

  #refine(above: number, below: number): Vector3 {
    const { ray } = this.#raycaster;

    let upper = above;
    let lower = below;

    for (let step = 0; step < REFINEMENT_STEPS; step += 1) {
      const middle = (upper + lower) / 2;

      ray.at(middle, this.#point);

      if (this.#isUnderground(this.#point)) {
        lower = middle;
      } else {
        upper = middle;
      }
    }

    ray.at(lower, this.#point);

    return new Vector3(this.#point.x, this.#heightAt(this.#point.x, this.#point.z), this.#point.z);
  }

  #isUnderground(point: Vector3): boolean {
    const limit = this.#worldHalfSize;

    if (Math.abs(point.x) > limit || Math.abs(point.z) > limit) {
      return false;
    }

    return point.y <= this.#heightAt(point.x, point.z);
  }
}
