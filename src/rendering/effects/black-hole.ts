import {
  abs,
  atan,
  cameraProjectionMatrix,
  cameraViewMatrix,
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
  mx_noise_float,
  normalize,
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
import type { ActiveEffect } from "./transient-effects.ts";

function rotate(point: Node<"vec2">, angle: Node<"float">) {
  return vec2(
    point.x.mul(cos(angle)).sub(point.y.mul(sin(angle))),
    point.y.mul(cos(angle)).add(point.x.mul(sin(angle)))
  );
}

function bentBackground(
  sceneColor: Texture,
  point: Node<"vec2">,
  radius: Node<"float">,
  age: Node<"float">,
  closing: Node<"float">
) {
  const pull = smoothstep(0.19, 1, radius).oneMinus();
  const tide = sin(radius.mul(9).sub(age.mul(1.7)))
    .mul(0.09)
    .add(1);
  const angle = pull.mul(pull).mul(tide).mul(closing.mul(0.65).add(0.83));
  const stretch = pull.mul(0.18).div(max(radius, 0.22));
  const sampledRadius = radius.add(stretch.mul(radius.mul(0.35).add(0.65)));
  const warped = rotate(point.div(max(radius, 0.002)), angle).mul(sampledRadius);
  const pixelsPerRadius = float(1).div(max(fwidth(point.x), 0.0001));
  const offset = warped.sub(point);
  const sampledUv = screenUV
    .add(vec2(offset.x, offset.y.negate()).mul(pixelsPerRadius).div(screenSize))
    .clamp(0.001, 0.999);
  const solid = texture(sceneColor, sampledUv);
  const translucent = viewportSharedTexture(sampledUv);

  return solid.rgb.mul(translucent.a.oneMinus()).add(translucent.rgb);
}

function gasStream(orbit: Node<"vec2">, age: Node<"float">) {
  const distance = length(orbit);
  const direction = atan(orbit.y, orbit.x);
  const turn = distance.mul(6.4).sub(age.mul(1.8));
  const stirred = rotate(orbit, turn);
  const clouds = mx_noise_float(vec3(stirred.mul(6.8), age.mul(0.19)));
  const arms = direction.mul(3).add(distance.mul(15)).sub(age.mul(3.7));
  const filaments = sin(distance.mul(91).add(sin(arms).mul(2.4)).add(clouds.mul(3.2)));
  const filigree = smoothstep(-0.74, 0.8, filaments).mul(0.57).add(0.43);
  const knots = smoothstep(-0.94, 0.87, sin(arms).add(clouds.mul(1.5)))
    .mul(0.61)
    .add(0.39);
  const inner = smoothstep(0.22, 0.35, distance);
  const outer = smoothstep(0.41, 0.92, distance.add(clouds.mul(0.065))).oneMinus();

  return inner.mul(outer).mul(knots).mul(filigree);
}

function createLensMaterial(sceneColor: Texture, age: Node<"float">, closing: Node<"float">): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ depthWrite: false, fog: false, transparent: true });
  const point = uv().mul(2).sub(1);
  const radius = length(point);
  const core = BLACK_HOLE_CORE_SHARE;
  const softness = max(0.003, fwidth(radius));
  const outside = smoothstep(float(core).sub(softness), float(core).add(softness), radius);
  const rim = exp(abs(radius.sub(core)).div(max(0.009, softness)).negate());

  const normal = cameraViewMatrix.mul(vec4(-0.18, 0.77, -0.59, 0)).xyz;
  const line = normalize(vec2(normal.y.add(0.001), normal.x.negate()));
  const across = vec2(line.y.negate(), line.x);
  const axis = vec2(dot(point, line), dot(point, across));
  const thickness = max(0.21, abs(normal.z).mul(0.72));
  const plane = vec2(axis.x, axis.y.add(0.035).div(thickness));
  const foreground = smoothstep(-0.055, 0.02, axis.y).oneMinus();
  const direct = gasStream(plane, age).mul(max(outside, foreground));

  const deflected = axis.mul(float(1).sub(float(0.129).div(max(0.045, dot(point, point)))));
  const back = gasStream(vec2(deflected.x, deflected.y.div(thickness)), age);
  const arc = back
    .mul(outside)
    .mul(smoothstep(0.48, 0.67, radius).oneMinus())
    .mul(smoothstep(-0.09, 0.17, axis.y).mul(0.83).add(0.17));
  const gas = direct.add(arc.mul(0.88));
  const approaching = smoothstep(-0.7, 0.6, axis.x.negate());
  const heat = mix(vec3(0.76, 0.068, 0.033), vec3(1.63, 0.61, 0.15), approaching)
    .mul(gas)
    .add(vec3(1.0, 0.78, 0.41).mul(gas.mul(gas)));
  const background = bentBackground(sceneColor, point, radius, age, closing);
  const shadow = smoothstep(float(core).add(0.02), 0.75, radius).mul(0.32).add(0.68);

  const vertex = modelViewPosition.add(vec3(positionGeometry.xy.mul(modelScale.xy), 0));
  // Test against the front of the lens volume so the terrain cannot slice its projected image in half.
  const front = float(1)
    .sub(modelScale.x.div(max(1, modelViewPosition.z.negate())))
    .max(0.12);

  material.vertexNode = cameraProjectionMatrix.mul(vec4(vertex.mul(front), 1));
  material.colorNode = mix(vec3(0.0013, 0.001, 0.003), background.mul(shadow), outside)
    .add(vec3(0.95, 0.51, 0.19).mul(rim))
    .add(heat);
  material.opacityNode = smoothstep(0.8, 1, radius).oneMinus();
  material.maskNode = radius.lessThan(1);

  return material;
}

export class BlackHoleLens implements ActiveEffect {
  readonly isOnGameClock = true;
  readonly meshes: readonly Mesh[];
  readonly #clock = uniform(0);
  readonly #collapse = uniform(0);
  readonly #effect: BlackHoleEffect;
  readonly #lens: Mesh<PlaneGeometry, MeshBasicNodeMaterial>;

  constructor(effect: BlackHoleEffect, sceneColor: Texture) {
    this.#effect = effect;
    this.#lens = new Mesh(new PlaneGeometry(2, 2), createLensMaterial(sceneColor, this.#clock, this.#collapse));
    this.#lens.renderOrder = 4;
    this.meshes = [this.#lens];

    this.update(effect.elapsedSeconds === undefined ? 0 : effect.elapsedSeconds);
  }

  get age(): number {
    return this.#clock.value;
  }

  get wellId(): number | undefined {
    return this.#effect.wellId;
  }

  synchronize(age: number): void {
    this.#clock.value = age;
    this.update(0);
  }

  update(seconds: number): boolean {
    this.#clock.value += seconds;

    const { durationSeconds, radius, surfaceY, x, z } = this.#effect;

    if (this.wellId !== undefined) {
      this.#clock.value = Math.min(this.#clock.value, durationSeconds - 0.23);
    }

    const age = this.#clock.value;
    const opening = 0.08 + ease(0, 0.7, age) * 0.92;
    const collapse = ease(durationSeconds - 0.85, durationSeconds, age);
    const scale = opening * (1 - collapse);

    this.#collapse.value = collapse;
    this.#lens.position.set(x, surfaceY + radius * 0.47 * scale, z);
    this.#lens.scale.setScalar(radius * scale);

    return age < durationSeconds;
  }

  finish(): void {
    this.#lens.geometry.dispose();
    this.#lens.material.dispose();
  }
}
