import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cos,
  dot,
  float,
  fract,
  length,
  max,
  mix,
  modelScale,
  modelViewMatrix,
  mx_noise_float,
  sin,
  smoothstep,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { InstancedBufferAttribute, Mesh, MeshBasicNodeMaterial, type Node, Sphere, Vector3 } from "three/webgpu";
import { FULL_TURN, hashToUnit, lerp } from "../../shared/math.ts";
import type { BlackHoleEffect } from "../../simulation/effects.ts";
import { writeVec4 } from "../instancing.ts";
import type { IslandOutline } from "../terrain/island-outline.ts";
import { billboardNodes, createQuadGeometry } from "./billboards.ts";
import type { EffectSurface } from "./effect-context.ts";

const STREAMS = 9;
const CLOUDS_PER_STREAM = 18;
const STRANDS_PER_STREAM = 11;
const GRAINS_PER_STREAM = 52;
const PER_STREAM = CLOUDS_PER_STREAM + STRANDS_PER_STREAM + GRAINS_PER_STREAM;
const PARTICLES = STREAMS * PER_STREAM;

const END_REACH = 0.13;
const FIRST_TURN = 0.56;
const LAST_TURN = 2.1;

export interface BlackHoleGround {
  readonly outline: Pick<IslandOutline, "isInside">;
  readonly surface: Pick<EffectSurface, "surfaceAt" | "isWaterAt">;
}

function dustMaterial(age: Node<"float">, strength: Node<"float">) {
  const material = new MeshBasicNodeMaterial({ depthWrite: false, transparent: true });
  const route = attribute("dustRoute", "vec4");
  const ground = attribute("dustGround", "vec4");
  const grain = attribute("dustGrain", "vec4");
  const { corner } = billboardNodes();

  const phase = fract(age.mul(grain.y).add(grain.x));
  const travel = phase.mul(phase.mul(0.54).add(0.46));
  const reach = mix(route.y, END_REACH, travel);
  const angle = route.x.add(travel.mul(travel.mul(LAST_TURN).add(FIRST_TURN)).mul(route.z));
  const radial = vec2(cos(angle), sin(angle));
  const xz = radial.mul(reach);
  const steps = travel.mul(3);
  const land = mix(
    mix(mix(ground.x, ground.y, steps.saturate()), ground.z, steps.sub(1).saturate()),
    0,
    steps.sub(2).saturate()
  );
  const airborne = smoothstep(0.15, 0.87, travel);
  const loft = sin(travel.mul(Math.PI)).mul(route.w);
  const y = land.mul(airborne.oneMinus()).add(airborne.mul(0.47).add(loft).mul(strength)).add(0.018);
  const center = vec3(xz.x, y, xz.y);
  const angularSpeed = travel
    .mul(2 * LAST_TURN)
    .add(FIRST_TURN)
    .mul(route.z)
    .mul(reach);
  const tangent = radial.mul(float(END_REACH).sub(route.y)).add(vec2(radial.y.negate(), radial.x).mul(angularSpeed));
  const direction = cameraViewMatrix.mul(vec4(tangent.x, loft.add(0.24).sub(ground.x), tangent.y, 0)).xy;
  const along = direction.div(max(length(direction), 0.001));
  const across = vec2(along.y.negate(), along.x);

  const isCloud = grain.w.min(1);
  const isStrand = grain.w.step(1.5);
  const seed = grain.z;
  const width = mix(seed.mul(0.082).add(0.067), seed.mul(0.027).add(0.033), isStrand);
  const size = mix(seed.mul(0.009).add(0.0055), width, isCloud);
  const cloudStretch = mix(travel.mul(1.4).add(1.5), travel.mul(3).add(4), isStrand);
  const stretch = mix(travel.mul(3.6).add(seed.mul(1.5)).add(1.2), cloudStretch, isCloud);
  const offset = along
    .mul(corner.x.mul(stretch))
    .add(across.mul(corner.y.sub(0.5)))
    .mul(size)
    .mul(modelScale.x);
  const fade = smoothstep(0, 0.1, phase)
    .mul(smoothstep(0.82, 0.99, travel).oneMinus())
    .mul(strength);
  const shade = mix(seed.mul(0.88).add(0.32), seed.mul(0.4).add(0.74), isCloud);
  const soil = mix(vec3(0.15, 0.11, 0.068), vec3(0.63, 0.49, 0.31), seed);
  const earth = mix(soil, vec3(0.86, 0.56, 0.27), travel.mul(0.75));
  const spray = mix(vec3(0.55, 0.69, 0.69), vec3(0.85, 0.64, 0.38), travel);
  const color = varying(mix(earth, spray, ground.w).mul(shade));
  const opacity = varying(fade.mul(mix(0.98, isStrand.mul(0.23).add(0.5), isCloud)));
  const point = varying(vec2(corner.x, corner.y.sub(0.5)).mul(2));
  const cloud = varying(isCloud);
  const ellipse = dot(point, point);
  const grainMask = smoothstep(0.5, 1, ellipse).oneMinus();
  const sample = vec3(point.mul(vec2(2.7, 1.6)).add(seed.mul(13)), seed.mul(24).add(age.mul(0.23)));
  const billows = mx_noise_float(sample);
  const wisp = smoothstep(-0.3, 0.72, billows.add(point.x.mul(0.15)));
  const cloudMask = smoothstep(0.03, 1, ellipse).oneMinus().mul(wisp.mul(0.95).add(0.08));

  material.vertexNode = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(center, 1)).add(vec4(offset, 0, 0)));
  material.colorNode = color;
  material.opacityNode = mix(grainMask, cloudMask, cloud).mul(opacity);

  return material;
}

function groundAt(
  { outline, surface }: BlackHoleGround,
  effect: BlackHoleEffect,
  heading: number,
  outerReach: number,
  turn: number,
  travel: number,
  fallback: number
): number {
  const angle = heading + travel * (FIRST_TURN + LAST_TURN * travel) * turn;
  const reach = lerp(outerReach, END_REACH, travel) * effect.radius;
  const x = effect.x + Math.cos(angle) * reach;
  const z = effect.z + Math.sin(angle) * reach;

  if (!outline.isInside(x, z)) {
    return fallback;
  }

  return (surface.surfaceAt(x, z) - effect.surfaceY) / effect.radius;
}

export function createBlackHoleDust(
  ground: BlackHoleGround,
  effect: BlackHoleEffect,
  age: Node<"float">,
  strength: Node<"float">
) {
  const { outline, surface } = ground;

  const geometry = createQuadGeometry();
  const routes = new Float32Array(PARTICLES * 4);
  const profiles = new Float32Array(PARTICLES * 4);
  const grains = new Float32Array(PARTICLES * 4);
  const rotation = hashToUnit(effect.x, effect.z) * FULL_TURN;
  let highestGround = 0;
  let count = 0;

  for (let stream = 0; stream < STREAMS; stream += 1) {
    const heading = rotation + ((stream + hashToUnit(stream, 1) * 0.54) * FULL_TURN) / STREAMS;
    const reach = 1.22 + hashToUnit(stream, 2) * 0.47;
    const turn = 0.79 + hashToUnit(stream, 3) * 0.5;

    for (let piece = 0; piece < PER_STREAM; piece += 1) {
      const index = stream * PER_STREAM + piece;
      const seed = hashToUnit(index, 4);
      const angle = heading + (hashToUnit(index, 5) - 0.5) * 0.35;
      const radius = reach * (0.87 + hashToUnit(index, 6) * 0.28);
      const x = effect.x + Math.cos(angle) * radius * effect.radius;
      const z = effect.z + Math.sin(angle) * radius * effect.radius;

      if (!outline.isInside(x, z)) {
        continue;
      }

      const bend = turn + (hashToUnit(index, 7) - 0.5) * 0.15;
      const lift = 0.11 + hashToUnit(index, 8) * 0.25;
      const start = (surface.surfaceAt(x, z) - effect.surfaceY) / effect.radius;
      const near = groundAt(ground, effect, angle, radius, bend, 1 / 3, start * (2 / 3));
      const middle = groundAt(ground, effect, angle, radius, bend, 2 / 3, near * 0.5);
      const wet = surface.isWaterAt(x, z);
      const isCloud = piece < CLOUDS_PER_STREAM;
      const isStrand = !isCloud && piece < CLOUDS_PER_STREAM + STRANDS_PER_STREAM;
      const phase = (piece * 0.618_034 + seed * 0.17) % 1;

      highestGround = Math.max(highestGround, Math.abs(start), Math.abs(near), Math.abs(middle));
      writeVec4(routes, count * 4, angle, radius, bend, lift);
      writeVec4(profiles, count * 4, start, near, middle, Number(wet));
      writeVec4(
        grains,
        count * 4,
        phase,
        0.31 + hashToUnit(index, 9) * 0.2,
        seed,
        Number(isCloud) + Number(isStrand) * 2
      );
      count += 1;
    }
  }

  geometry.setAttribute("dustRoute", new InstancedBufferAttribute(routes, 4));
  geometry.setAttribute("dustGround", new InstancedBufferAttribute(profiles, 4));
  geometry.setAttribute("dustGrain", new InstancedBufferAttribute(grains, 4));
  geometry.boundingSphere = new Sphere(new Vector3(), Math.hypot(2.1, highestGround + 0.85));
  geometry.instanceCount = count;

  const mesh = new Mesh(geometry, dustMaterial(age, strength));

  mesh.position.set(effect.x, effect.surfaceY, effect.z);
  mesh.scale.setScalar(effect.radius);
  mesh.renderOrder = 3;

  return mesh;
}
