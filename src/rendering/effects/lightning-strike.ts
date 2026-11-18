import { type Mesh, Vector3 } from "three/webgpu";
import { smoothstep } from "../../shared/math.ts";
import type { LightningEffect } from "../../simulation/effects.ts";
import type { ActiveEffect, EffectContext } from "./effect-context.ts";
import type { EffectMeshes, RibbonPoint } from "./effect-meshes.ts";

const BOLT_HEIGHT = 1100;
const BOLT_SUBDIVISIONS = 6;
const BOLT_SECONDS = 0.55;

function jaggedPath(start: Vector3, end: Vector3, roughness: number): Vector3[] {
  let points = [start, end];

  for (let level = 0; level < BOLT_SUBDIVISIONS; level += 1) {
    points = subdivide(points, roughness);
  }

  return points;
}

function subdivide(points: readonly Vector3[], roughness: number): Vector3[] {
  const refined: Vector3[] = [];

  for (const [index, point] of points.entries()) {
    refined.push(point);

    const next = points[index + 1];

    if (next === undefined) {
      continue;
    }

    const spread = point.distanceTo(next) * roughness;
    const middle = point.clone().lerp(next, 0.5);

    middle.x += (Math.random() - 0.5) * spread;
    middle.y += (Math.random() - 0.5) * spread * 0.3;
    middle.z += (Math.random() - 0.5) * spread;
    refined.push(middle);
  }

  return refined;
}

function toRibbon(points: readonly Vector3[], width: number): RibbonPoint[] {
  return points.map((position, index) => {
    return { position, width: width * (1 - (index / points.length) * 0.4) };
  });
}

function branchFrom(trunk: readonly Vector3[], share: number): RibbonPoint[] {
  const start = trunk[Math.floor(trunk.length * share)];
  const length = BOLT_HEIGHT * (0.12 + Math.random() * 0.15);
  const offset = new Vector3((Math.random() - 0.5) * length, -length, (Math.random() - 0.5) * length);

  return toRibbon(jaggedPath(start, start.clone().add(offset), 0.5).slice(0, 24), 0.7);
}

export class LightningStrike implements ActiveEffect {
  readonly meshes: readonly Mesh[];
  readonly #bolt: Mesh;
  readonly #effectMeshes: EffectMeshes;
  #age = 0;

  constructor(context: Pick<EffectContext, "flash" | "light" | "meshes" | "surface">, effect: LightningEffect) {
    const ground = new Vector3(effect.x, context.surface.surfaceAt(effect.x, effect.z), effect.z);
    const skyOffset = new Vector3((Math.random() - 0.5) * 300, BOLT_HEIGHT, (Math.random() - 0.5) * 300);

    const trunk = jaggedPath(ground.clone().add(skyOffset), ground, 0.42);
    const strands = [
      toRibbon(trunk, 1.6),
      ...[0.3, 0.55, 0.7].map((share) => {
        return branchFrom(trunk, share);
      }),
    ];

    this.#effectMeshes = context.meshes;
    this.#bolt = context.meshes.createBolt(strands);
    this.meshes = [this.#bolt];

    context.flash(effect.isNatural ? 0.75 : 1);
    context.light(ground.clone().setY(ground.y + 40), 0xcf_e0_ff, 9);
  }

  update(seconds: number): boolean {
    this.#age += seconds;

    const flicker = Math.random() > 0.35 ? 1 : 0.35;

    this.#effectMeshes.setBoltBrightness(this.#bolt, (1 - smoothstep(0.08, BOLT_SECONDS, this.#age)) * flicker);

    return this.#age < BOLT_SECONDS;
  }

  finish(): void {
    this.#bolt.geometry.dispose();
  }
}
