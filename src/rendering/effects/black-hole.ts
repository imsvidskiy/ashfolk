import {
  abs,
  atan,
  cameraProjectionMatrix,
  cos,
  dot,
  exp,
  float,
  fwidth,
  length,
  max,
  mix,
  modelScale,
  modelViewPosition,
  positionGeometry,
  screenSize,
  screenUV,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  viewportSharedTexture,
} from "three/tsl";
import { Mesh, MeshBasicNodeMaterial, type Node, PlaneGeometry, type Texture } from "three/webgpu";
import { smoothstep as ease } from "../../shared/math.ts";
import type { BlackHoleEffect } from "../../simulation/effects.ts";
import { BLACK_HOLE_CORE_SHARE } from "../../simulation/powers/black-holes.ts";
import { createBlackHoleDebris, type InflowSurface } from "./black-hole-debris.ts";
import type { ActiveEffect } from "./transient-effects.ts";

function bentBackground(sceneColor: Texture, point: Node<"vec2">, radius: Node<"float">, age: Node<"float">) {
  const field = smoothstep(BLACK_HOLE_CORE_SHARE, 1, radius).oneMinus();
  const twist = field.mul(field).mul(
    sin(age.mul(1.8).sub(radius.mul(8)))
      .mul(0.08)
      .add(0.65)
  );
  const turned = vec2(
    point.x.mul(cos(twist)).sub(point.y.mul(sin(twist))),
    point.y.mul(cos(twist)).add(point.x.mul(sin(twist)))
  );
  const bend = field.mul(0.26).div(max(dot(point, point), 0.07));
  const offset = turned.mul(bend.oneMinus()).sub(point);
  const pixelsPerRadius = float(1).div(max(fwidth(point.x), 0.0001));
  const sampledUv = screenUV
    .add(vec2(offset.x, offset.y.negate()).mul(pixelsPerRadius).div(screenSize))
    .clamp(0.001, 0.999);
  const solid = texture(sceneColor, sampledUv);
  const translucent = viewportSharedTexture(sampledUv);

  return solid.rgb.mul(translucent.a.oneMinus()).add(translucent.rgb);
}

function accretionStream(orbit: Node<"vec2">, age: Node<"float">) {
  const distance = length(orbit);
  const heading = atan(orbit.y, orbit.x);
  const sweep = heading.mul(3).sub(age.mul(3.8)).add(distance.mul(11));
  const wave = sin(sweep).mul(1.65);
  const lanes = sin(distance.mul(80).add(wave)).mul(0.32).add(0.68);
  const clumps = sin(sweep.add(sin(heading.mul(5).add(age.mul(1.8)))))
    .mul(0.3)
    .add(0.7);
  const band = smoothstep(0.15, 0.28, distance).mul(smoothstep(0.43, 0.92, distance).oneMinus());

  return band.mul(lanes).mul(clumps);
}

function createLensMaterial(sceneColor: Texture, age: Node<"float">): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ depthWrite: false, fog: false, transparent: true });
  const point = uv().mul(2).sub(1);
  const radius = length(point);
  const core = BLACK_HOLE_CORE_SHARE;
  const softness = max(0.004, fwidth(radius));
  const outside = smoothstep(float(core).sub(softness), float(core).add(softness), radius);
  const rim = exp(abs(radius.sub(core)).div(max(0.009, softness)).negate());
  const axis = vec2(point.x.add(point.y.mul(0.2)), point.y.sub(point.x.mul(0.2)));
  const plane = vec2(axis.x, axis.y.add(0.045).mul(5.8));
  const near = accretionStream(plane, age).mul(mix(1, outside, smoothstep(-0.08, -0.008, axis.y)));
  const refracted = axis.mul(float(1).sub(float(0.098).div(max(0.04, dot(point, point)))));
  const arc = accretionStream(vec2(refracted.x, refracted.y.mul(5.4)), age)
    .mul(outside)
    .mul(smoothstep(0.52, 0.73, radius).oneMinus())
    .mul(smoothstep(-0.14, 0.18, axis.y).mul(0.8).add(0.2));
  const light = near.add(arc.mul(0.69));
  const hotSide = smoothstep(-0.72, 0.56, axis.x.negate());
  const gas = mix(vec3(0.84, 0.095, 0.12), vec3(1.45, 0.59, 0.18), hotSide)
    .mul(light)
    .add(vec3(0.72, 0.66, 0.49).mul(light.mul(light)));
  const background = bentBackground(sceneColor, point, radius, age);

  material.vertexNode = cameraProjectionMatrix.mul(
    vec4(modelViewPosition.add(vec3(positionGeometry.xy.mul(modelScale.xy), 0)), 1)
  );
  material.colorNode = mix(vec3(0.002, 0.001, 0.005), background, outside)
    .add(vec3(0.78, 0.2, 0.38).mul(rim))
    .add(gas);
  material.opacityNode = smoothstep(0.86, 1, radius).oneMinus();
  material.maskNode = radius.lessThan(1);

  return material;
}

export class BlackHoleLens implements ActiveEffect {
  readonly isOnGameClock = true;
  readonly meshes: readonly Mesh[];
  readonly #clock = uniform(0);
  readonly #opening = uniform(0);
  readonly #lift = uniform(0);
  readonly #effect: BlackHoleEffect;
  readonly #lens: Mesh<PlaneGeometry, MeshBasicNodeMaterial>;
  readonly #debris: ReturnType<typeof createBlackHoleDebris>;

  constructor(effect: BlackHoleEffect, sceneColor: Texture, surface: InflowSurface) {
    this.#effect = effect;
    this.#lens = new Mesh(new PlaneGeometry(2, 2), createLensMaterial(sceneColor, this.#clock));
    this.#lens.renderOrder = 4;
    this.#debris = createBlackHoleDebris(effect, surface, this.#clock, this.#opening, this.#lift);
    this.meshes = [this.#lens, this.#debris];

    this.update(effect.elapsedSeconds === undefined ? 0 : effect.elapsedSeconds);
  }

  update(seconds: number): boolean {
    this.#clock.value += seconds;

    const { durationSeconds, radius, surfaceY, x, z } = this.#effect;
    const age = this.#clock.value;
    const opening = 0.08 + ease(0, 0.7, age) * 0.92;
    const closing = 1 - ease(durationSeconds - 0.85, durationSeconds, age);

    this.#opening.value = opening * closing;
    this.#lift.value = 0.47 * this.#opening.value;
    this.#lens.position.set(x, surfaceY + radius * this.#lift.value, z);
    this.#lens.scale.setScalar(radius * this.#opening.value);

    return age < durationSeconds;
  }

  finish(): void {
    this.#lens.geometry.dispose();
    this.#lens.material.dispose();
    this.#debris.geometry.dispose();
    this.#debris.material.dispose();
  }
}
