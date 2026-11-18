import {
  dot,
  float,
  length,
  max,
  mix,
  mx_noise_float,
  smoothstep as shadeStep,
  sqrt,
  uniform,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import { MeshBasicNodeMaterial, Vector3 } from "three/webgpu";
import { FULL_TURN, hashToUnit, smoothstep } from "../../shared/math.ts";
import type { InstanceBatch } from "../instancing.ts";
import { billboardNodes, type CameraAxes, createBillboardBatch, facingBillboard } from "./billboards.ts";

interface Billow {
  readonly angle: number;
  readonly heat: number;
  readonly height: number;
  readonly reach: number;
  readonly rise: number;
  readonly size: number;
}

function createBillows(): Billow[] {
  const billows: Billow[] = [];

  for (let index = 0; index < 63; index += 1) {
    const reach = Math.sqrt((index + 0.5) / 63);

    billows.push({
      angle: index * 2.399_96,
      heat: 0.56 + hashToUnit(index, 4) * 0.42,
      height: Math.sqrt(1 - reach * reach) * 0.48 - 0.045,
      reach: reach * (0.79 + hashToUnit(index, 6) * 0.07),
      rise: 1,
      size: 0.51 + hashToUnit(index, 8) * 0.18,
    });
  }

  for (let index = 0; index < 24; index += 1) {
    billows.push({
      angle: (index * FULL_TURN) / 24,
      heat: 0.26 + hashToUnit(index, 13) * 0.5,
      height: -0.1 + hashToUnit(index, 14) * 0.11,
      reach: 0.69 + hashToUnit(index, 15) * 0.14,
      rise: 1,
      size: 0.39 + hashToUnit(index, 16) * 0.15,
    });
  }

  for (let index = 0; index < 52; index += 1) {
    const rise = (index + 0.25) / 52;
    const skirt = (1 - rise) ** 7;
    const neck = rise ** 4;
    const reach = 0.09 + skirt * 0.38 + neck * 0.22;

    billows.push({
      angle: index * 2.399_96,
      heat: 0.3 + neck * 0.32 + hashToUnit(index, 3) * 0.22,
      height: skirt * 0.045,
      reach: reach * (0.45 + hashToUnit(index, 9) * 0.56),
      rise,
      size: 0.26 + neck * 0.22 + skirt * 0.24 + hashToUnit(index, 18) * 0.13,
    });
  }

  return billows;
}

const BILLOWS = createBillows();

function createPlumeMaterial(axes: CameraAxes) {
  const material = new MeshBasicNodeMaterial({ depthWrite: false, transparent: true });
  const { corner, look, placement } = billboardNodes();
  const age = uniform(0);
  const point = varying(vec2(corner.x, corner.y.sub(0.5)).mul(2));
  const radius = length(point);
  const seed = look.w;
  const sample = vec3(point.mul(2.2).add(seed), seed.add(age.mul(0.27)));
  const roll = mx_noise_float(sample).add(mx_noise_float(sample.mul(2.8)).mul(0.35));
  const edge = radius.add(roll.mul(0.18));
  const depth = sqrt(max(0, float(1).sub(dot(point, point))));
  const light = dot(vec3(point, depth), vec3(-0.55, 0.74, 0.39));
  const lightness = shadeStep(-0.8, 0.98, light.add(roll.mul(0.65)));
  const ash = mix(vec3(0.045, 0.029, 0.026), vec3(0.48, 0.39, 0.33), lightness).mul(look.y);
  const embers = shadeStep(-0.47, 0.93, light.add(roll.mul(1.5)));
  const fire = mix(vec3(0.29, 0.055, 0.016), vec3(2.05, 0.91, 0.18), embers);

  material.positionNode = facingBillboard(axes, placement.xyz, corner, placement.w);
  material.colorNode = mix(ash, fire, look.x);
  material.opacityNode = shadeStep(0.99, 0.43, edge).mul(look.z);

  return { age, material };
}

export class NuclearPlume {
  readonly #axes: CameraAxes;
  readonly #batch: InstanceBatch;
  readonly #facing = new Vector3();
  readonly #puffs = BILLOWS.map((billow, index) => {
    return { billow, depth: 0, seed: hashToUnit(index, 12) * 21, x: 0, y: 0, z: 0 };
  });
  readonly #shader: ReturnType<typeof createPlumeMaterial>;

  constructor(axes: CameraAxes) {
    this.#axes = axes;
    this.#shader = createPlumeMaterial(axes);
    this.#batch = createBillboardBatch(this.#shader.material, 6);
  }

  get mesh() {
    return this.#batch.mesh;
  }

  update(age: number, lift: number, width: number, heat: number, opacity: number): void {
    this.#shader.age.value = age;
    this.#facing.crossVectors(this.#axes.right.value, this.#axes.up.value);
    this.#batch.begin();

    for (const puff of this.#puffs) {
      const { angle, height, reach, rise } = puff.billow;
      const rotation = angle + age * (0.055 + 0.17 * (1 - rise));
      const spread = reach * width;

      puff.x = Math.cos(rotation) * spread;
      puff.y = (rise - 1) * lift + width * (height + Math.sin(age * 0.7 + puff.seed) * 0.037);
      puff.z = Math.sin(rotation) * spread;
      puff.depth = puff.x * this.#facing.x + puff.y * this.#facing.y + puff.z * this.#facing.z;
    }

    this.#puffs.sort((a, b) => {
      return a.depth - b.depth;
    });

    const disperse = 1 + smoothstep(4, 9, age) * 0.37;

    for (const puff of this.#puffs) {
      const { billow, seed, x, y, z } = puff;

      this.#batch.add(
        [x * disperse, y, z * disperse, width * billow.size * disperse],
        [heat * billow.heat, 0.77 + seed * 0.02, opacity, seed]
      );
    }

    this.#batch.commit();
  }

  dispose(): void {
    this.#batch.dispose();
    this.#shader.material.dispose();
  }
}
