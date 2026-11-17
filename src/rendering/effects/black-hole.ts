import {
  abs,
  cameraProjectionMatrix,
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
  uv,
  vec2,
  vec3,
  vec4,
  viewportSharedTexture,
} from "three/tsl";
import { Mesh, MeshBasicNodeMaterial, PlaneGeometry, type Texture } from "three/webgpu";
import { smoothstep as ease } from "../../shared/math.ts";
import type { BlackHoleEffect } from "../../simulation/effects.ts";
import type { ActiveEffect } from "./transient-effects.ts";

function createLensMaterial(sceneColor: Texture): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ depthWrite: false, fog: false, transparent: true });
  const point = uv().mul(2).sub(1);
  const radius = length(point);
  const edge = smoothstep(0.65, 1, radius).oneMinus();
  const pixelsPerRadius = float(1).div(max(fwidth(point.x), 0.0001));
  const bend = edge.mul(0.14).div(max(radius.mul(radius), 0.06));
  const deflection = vec2(point.x, point.y.negate()).mul(bend).mul(pixelsPerRadius).div(screenSize);
  const sampledUv = screenUV.sub(deflection).clamp(0.001, 0.999);
  const solid = texture(sceneColor, sampledUv);
  const translucent = viewportSharedTexture(sampledUv);
  const background = solid.rgb.mul(translucent.a.oneMinus()).add(translucent.rgb);

  const horizon = smoothstep(0.245, 0.263, radius);
  const rim = exp(abs(radius.sub(0.259)).mul(-130));
  const tiltedY = point.y.sub(point.x.mul(0.14));
  const orbit = length(vec2(point.x, tiltedY.mul(5.8)));
  const dust = smoothstep(0.36, 0.96, orbit)
    .oneMinus()
    .mul(smoothstep(0.16, 0.37, orbit));
  const lanes = sin(orbit.mul(115).add(point.x.mul(4)))
    .mul(0.18)
    .add(0.82);
  const disk = dust.mul(lanes).mul(
    smoothstep(-0.05, 0.04, tiltedY)
      .mul(horizon)
      .add(smoothstep(-0.05, 0.04, tiltedY).oneMinus())
  );
  const color = mix(vec3(0.004, 0.001, 0.012), background, horizon)
    .add(vec3(1.1, 0.45, 0.98).mul(rim))
    .add(mix(vec3(1.1, 0.26, 0.1), vec3(2.7, 1.7, 0.93), disk).mul(disk));

  material.vertexNode = cameraProjectionMatrix.mul(
    vec4(modelViewPosition.add(vec3(positionGeometry.xy.mul(modelScale.xy), 0)), 1)
  );
  material.colorNode = color;
  material.opacityNode = edge;

  return material;
}

export class BlackHoleLens implements ActiveEffect {
  readonly isOnGameClock = true;
  readonly meshes: readonly Mesh[];
  readonly #effect: BlackHoleEffect;
  readonly #lens: Mesh<PlaneGeometry, MeshBasicNodeMaterial>;
  #age = 0;

  constructor(effect: BlackHoleEffect, sceneColor: Texture) {
    this.#age = effect.elapsedSeconds === undefined ? 0 : effect.elapsedSeconds;
    this.#effect = effect;
    this.#lens = new Mesh(new PlaneGeometry(2, 2), createLensMaterial(sceneColor));
    this.#lens.position.set(effect.x, effect.surfaceY + effect.radius * 0.65, effect.z);
    this.#lens.renderOrder = 4;
    this.meshes = [this.#lens];
  }

  update(seconds: number): boolean {
    this.#age += seconds;

    const { durationSeconds, radius } = this.#effect;
    const opening = 0.18 + ease(0, 0.75, this.#age) * 0.82;
    const closing = 1 - ease(durationSeconds - 1, durationSeconds, this.#age);

    this.#lens.scale.setScalar(radius * opening * closing);

    return this.#age < durationSeconds;
  }

  finish(): void {
    this.#lens.geometry.dispose();
    this.#lens.material.dispose();
  }
}
