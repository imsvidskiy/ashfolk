import { attribute, cos, float, fract, mix, normalGeometry, positionGeometry, sin, smoothstep, vec3 } from "three/tsl";
import {
  IcosahedronGeometry,
  InstancedBufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  type Node,
  Sphere,
  Vector3,
} from "three/webgpu";
import { FULL_TURN, hashToUnit } from "../../shared/math.ts";
import type { BlackHoleEffect } from "../../simulation/effects.ts";
import { toInstancedGeometry } from "../instancing.ts";

const STREAMS = 4;
const PIECES = 64;

export interface InflowSurface {
  readonly isWaterAt: (x: number, z: number) => boolean;
  readonly surfaceAt: (x: number, z: number) => number;
}

function debrisMaterial(clock: Node<"float">, opening: Node<"float">, lift: Node<"float">): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const orbit = attribute("inflowOrbit", "vec4");
  const piece = attribute("inflowPiece", "vec4");
  const travel = clock.mul(orbit.z).add(orbit.w);
  const phase = fract(travel);
  const fall = phase.mul(phase);
  const angle = orbit.x.add(phase.mul(0.6)).add(fall.mul(4.6));
  const reach = orbit.y.mul(float(1).sub(fall));
  const height = mix(piece.x, lift, smoothstep(0, 0.95, phase));
  const center = vec3(cos(angle).mul(reach), height, sin(angle).mul(reach));
  const size = piece.y
    .mul(opening)
    .mul(smoothstep(0, 0.12, phase))
    .mul(smoothstep(0, 0.12, travel))
    .mul(smoothstep(0.85, 0.99, phase).oneMinus());
  const turn = angle.add(sin(phase.mul(8)).mul(phase.oneMinus()));
  const fragment = positionGeometry.mul(size);
  const along = fragment.x.mul(1.6).mul(float(1).add(fall.mul(2.8)));
  const wing = fragment.z.mul(0.7);

  material.positionNode = center.add(
    vec3(wing.mul(cos(turn)).sub(along.mul(sin(turn))), fragment.y, along.mul(cos(turn)).add(wing.mul(sin(turn))))
  );

  const earth = mix(vec3(0.105, 0.067, 0.034), vec3(0.38, 0.28, 0.16), piece.z);
  const spray = mix(vec3(0.075, 0.26, 0.33), vec3(0.35, 0.67, 0.82), piece.z);
  const lit = mix(earth, spray, piece.w).mul(normalGeometry.y.mul(0.3).add(0.75));
  const heat = smoothstep(0.5, 0.92, phase).mul(piece.z.mul(0.8).add(0.2));

  material.colorNode = mix(lit, vec3(1.04, 0.34, 0.09), heat);

  return material;
}

export function createBlackHoleDebris(
  effect: BlackHoleEffect,
  surface: InflowSurface,
  clock: Node<"float">,
  opening: Node<"float">,
  lift: Node<"float">
) {
  const geometry = toInstancedGeometry(new IcosahedronGeometry(1, 0));
  const orbits: number[] = [];
  const pieces: number[] = [];
  const heading = hashToUnit(effect.x, effect.z) * FULL_TURN;
  let heightRange = 1;

  for (let index = 0; index < PIECES; index += 1) {
    const stream = index % STREAMS;
    const swirl = hashToUnit(index, 2);
    const angle = heading + (stream / STREAMS) * FULL_TURN + (swirl - 0.5) * 0.55;
    const spread = 0.73 + hashToUnit(index, 3) * 0.27;
    const x = effect.x + Math.cos(angle) * spread * effect.radius;
    const z = effect.z + Math.sin(angle) * spread * effect.radius;
    const surfaceY = surface.surfaceAt(x, z);
    const height = (surfaceY - effect.surfaceY) / effect.radius;
    const isWater = surface.isWaterAt(x, z);

    heightRange = Math.max(heightRange, Math.abs(height) + 0.12);
    orbits.push(angle, spread, 0.38 + hashToUnit(stream, 1) * 0.12, -hashToUnit(index, 4));
    pieces.push(height, 0.005 + hashToUnit(index, 5) ** 2 * 0.019, swirl, Number(isWater));
  }

  geometry.setAttribute("inflowOrbit", new InstancedBufferAttribute(new Float32Array(orbits), 4));
  geometry.setAttribute("inflowPiece", new InstancedBufferAttribute(new Float32Array(pieces), 4));
  geometry.instanceCount = PIECES;
  geometry.boundingSphere = new Sphere(new Vector3(), Math.hypot(1.1, heightRange));

  const mesh = new Mesh(geometry, debrisMaterial(clock, opening, lift));

  mesh.position.set(effect.x, effect.surfaceY, effect.z);
  mesh.scale.setScalar(effect.radius);

  return mesh;
}
