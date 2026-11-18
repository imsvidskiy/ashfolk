import {
  cross,
  dFdx,
  dFdy,
  dot,
  float,
  length,
  max,
  mix,
  mx_noise_float,
  normalize,
  smoothstep as shadeStep,
  sign,
  sqrt,
  uniform,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import { MeshBasicNodeMaterial, Vector3 } from "three/webgpu";
import { FULL_TURN, hashToUnit, lerp, smoothstep } from "../../shared/math.ts";
import type { InstanceBatch } from "../instancing.ts";
import { billboardNodes, type CameraAxes, createBillboardBatch, facingBillboard } from "./billboards.ts";

const CROWN_BILLOWS = 45;
const RIM_BILLOWS = 27;
const COLUMN_BILLOWS = 47;
const SKIRT_BILLOWS = 16;
const GOLDEN_ANGLE = 2.399_96;

type Flow = "column" | "crown" | "rim" | "skirt";

interface Billow {
  readonly angle: number;
  readonly flow: Flow;
  readonly phase: number;
  readonly reach: number;
  readonly seed: number;
  readonly size: number;
  readonly variation: number;
}

interface Puff {
  readonly billow: Billow;
  depth: number;
  heat: number;
  light: number;
  opacity: number;
  size: number;
  x: number;
  y: number;
  z: number;
}

function createBillows(flow: Flow, count: number, salt: number): Billow[] {
  return Array.from({ length: count }, (_, index) => {
    const spread = (index + 0.5) / count;
    const angle = flow === "rim" || flow === "skirt" ? spread * FULL_TURN : index * GOLDEN_ANGLE;
    const variation = hashToUnit(index, salt);

    return {
      angle,
      flow,
      phase: flow === "column" ? spread : hashToUnit(index, salt + 1),
      reach: Math.sqrt(spread),
      seed: hashToUnit(index, salt + 2) * 19,
      size: 0.82 + variation * 0.34,
      variation,
    };
  });
}

const BILLOWS = [
  ...createBillows("crown", CROWN_BILLOWS, 1),
  ...createBillows("rim", RIM_BILLOWS, 6),
  ...createBillows("column", COLUMN_BILLOWS, 12),
  ...createBillows("skirt", SKIRT_BILLOWS, 17),
];

function createPlumeMaterial(axes: CameraAxes) {
  const material = new MeshBasicNodeMaterial({ depthWrite: false, transparent: true });
  const { corner, look, placement } = billboardNodes();
  const age = uniform(0);
  const point = varying(vec2(corner.x, corner.y.sub(0.5)).mul(2));
  const sample = vec3(point.mul(1.4).add(look.w), look.w.add(age.mul(0.18)));
  const folds = mx_noise_float(sample);
  const edge = length(point).add(folds.mul(0.15));
  const depth = sqrt(max(0, float(1).sub(dot(point, point))));
  const surface = vec3(point, depth.add(folds.mul(0.36)));
  const gradient = cross(dFdx(surface), dFdy(surface));
  const normal = normalize(gradient.mul(sign(gradient.z)));
  const lobeLight = dot(normal, vec3(-0.52, 0.63, 0.42));
  const light = shadeStep(0.02, 0.96, look.y.add(lobeLight.mul(0.37)).add(folds.mul(0.18)));
  const ash = mix(vec3(0.045, 0.042, 0.045), vec3(0.58, 0.54, 0.48), light);
  const flame = mix(vec3(0.68, 0.16, 0.032), vec3(1.4, 0.63, 0.18), light);

  material.positionNode = facingBillboard(axes, placement.xyz, corner, placement.w);
  material.colorNode = mix(ash, flame, look.x);
  material.opacityNode = shadeStep(0.64, 0.99, edge).oneMinus().mul(look.z);

  return { age, material };
}

function place(puff: Puff, angle: number, reach: number, height: number): void {
  puff.x = Math.cos(angle) * reach;
  puff.z = Math.sin(angle) * reach;
  puff.y = height;
}

function rollCrown(puff: Puff, age: number, lift: number, width: number, fray: number): void {
  const { angle, flow, phase, reach, size, variation } = puff.billow;
  const isRim = flow === "rim";
  const spread = smoothstep(0.1 + phase * 0.3, 1.7 + phase * 0.45, age);
  const roll = phase * 2.8 + age * (1.16 + variation * 0.36) + Math.sin(angle * 3) * 0.7;
  const radius = isRim ? 0.76 + Math.sin(roll) * 0.12 : reach * (0.69 + Math.sin(roll) * 0.045);
  const height = isRim ? -0.045 + Math.cos(roll) * 0.12 : 0.08 + Math.sqrt(1 - reach * reach) * 0.3;
  const bearing = angle + Math.sin(roll * 0.55) * 0.09;

  place(puff, bearing, width * radius * lerp(0.54, 1, spread), lift + width * height * (0.6 + 0.4 * spread));
  puff.x += fray * width * (variation - 0.3) * 0.75;
  puff.y += width * (Math.sin(roll + angle) * 0.038 + fray * phase * 0.36);
  puff.z += fray * width * (phase - 0.5) * 0.56;
  puff.size = width * size * (isRim ? 0.5 : 0.62) * (1 + 0.12 * Math.sin(roll) + fray * (variation - 0.55) * 0.55);
  puff.light = (isRim ? 0.19 : 0.41) + height * 0.32 - Math.cos(bearing) * radius * 0.22;
  puff.heat = (isRim ? 0.93 : 0.72) + 0.16 * Math.cos(roll);
  puff.opacity = 0.95 * (1 - smoothstep(4.9 + phase * 2.2, 7.1 + variation * 2.6, age));
}

function feedColumn(puff: Puff, age: number, lift: number, width: number, fray: number): void {
  const { angle, phase, size, variation } = puff.billow;
  const rise = (phase + age * (0.26 + variation * 0.085)) % 1;
  const skirt = (1 - rise) ** 4;
  const neck = rise ** 3;
  const bearing = angle + rise * 3.4 + age * 0.35;
  const spread = (0.075 + 0.18 * skirt + 0.22 * neck) * (0.62 + variation * 0.5);

  place(puff, bearing, width * spread, lift * rise);
  puff.x += width * Math.sin(rise * 7 - age * 1.4) * 0.052 + fray * width * rise * 0.28;
  puff.z += width * Math.sin(rise * 5 + age * 0.95) * 0.044;
  puff.size = width * size * (0.42 + 0.26 * skirt + 0.16 * neck);
  puff.light = 0.29 + 0.13 * Math.sin(bearing) + 0.16 * skirt - 0.1 * neck;
  puff.heat = 0.4 + 0.29 * neck + variation * 0.17;
  puff.opacity =
    smoothstep(0, 0.12, rise) *
    (1 - smoothstep(0.88, 1, rise)) *
    (1 - smoothstep(4.6 + rise * 1.7, 7.4 + rise * 1.2, age)) *
    0.93;
}

function spreadSkirt(puff: Puff, age: number, width: number, radius: number, craterDepth: number): void {
  const { angle, phase, size, variation } = puff.billow;
  const roll = age * 1.3 + angle * 2;
  const spread = 0.34 + smoothstep(0.1, 3.4 + phase, age) * (0.32 + variation * 0.18);

  const bank = craterDepth * smoothstep(0, 0.92, (spread * width) / radius);

  place(puff, angle + 0.09 * Math.sin(roll), width * spread, bank + width * (0.04 + 0.07 * Math.sin(roll) ** 2));
  puff.size = width * size * (0.34 + phase * 0.18);
  puff.light = 0.4 - 0.16 * Math.cos(angle);
  puff.heat = 0.34;
  puff.opacity = 0.72 * (1 - smoothstep(2.7 + phase, 6.2 + phase, age));
}

export class NuclearPlume {
  readonly #axes: CameraAxes;
  readonly #batch: InstanceBatch;
  readonly #facing = new Vector3();
  readonly #puffs: Puff[] = BILLOWS.map((billow) => {
    return { billow, depth: 0, heat: 0, light: 0, opacity: 0, size: 0, x: 0, y: 0, z: 0 };
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

  update(age: number, radius: number, craterDepth: number): void {
    const lift = craterDepth + radius * (0.1 + 0.77 * (1 - Math.exp(-age * 0.77)) + age * 0.043);
    const width = radius * (0.17 + 0.64 * smoothstep(0, 2.55, age) + age * 0.018);
    const fray = smoothstep(4.1, 9.7, age);
    const opening = smoothstep(0, 0.45, age);
    const heat = 1 - smoothstep(0.48, 3.6, age);

    this.#shader.age.value = age;
    this.#facing.crossVectors(this.#axes.right.value, this.#axes.up.value);
    this.#batch.begin();

    for (const puff of this.#puffs) {
      const { flow, phase, variation } = puff.billow;

      if (flow === "column") {
        feedColumn(puff, age, lift, width, fray);
      } else if (flow === "skirt") {
        spreadSkirt(puff, age, width, radius, craterDepth);
      } else {
        rollCrown(puff, age, lift, width, fray);
      }

      const altitude = puff.y / lift;
      const drift = age * 0.027 * radius * altitude;

      puff.x += drift;
      puff.z -= drift * 0.37;
      puff.heat *= heat * (0.78 + variation * 0.2);
      puff.opacity *= opening * (0.96 + phase * 0.04);
      puff.depth = puff.x * this.#facing.x + puff.y * this.#facing.y + puff.z * this.#facing.z;
    }

    this.#puffs.sort((first, second) => {
      return first.depth - second.depth;
    });

    for (const puff of this.#puffs) {
      if (puff.opacity > 0.004) {
        this.#batch.add([puff.x, puff.y, puff.z, puff.size], [puff.heat, puff.light, puff.opacity, puff.billow.seed]);
      }
    }

    this.#batch.commit();
  }

  dispose(): void {
    this.#batch.dispose();
    this.#shader.material.dispose();
  }
}
