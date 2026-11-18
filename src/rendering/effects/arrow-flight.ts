import { ConeGeometry, CylinderGeometry, Mesh, MeshStandardNodeMaterial, Vector3 } from "three/webgpu";
import { saturate } from "../../shared/math.ts";
import type { ArrowEffect } from "../../simulation/effects.ts";
import type { ActiveEffect, EffectContext } from "./transient-effects.ts";

const SHAFT_LENGTH = 1.1;
const SHAFT_RADIUS = 0.035;
const HEAD_LENGTH = 0.16;
const HEAD_RADIUS = 0.06;
const RELEASE_HEIGHT = 1.9;
const TARGET_HEIGHT = 1;
const ARC_PER_METER = 0.07;
const LINGER_SECONDS = 1.2;
const SHORTEST_FLIGHT = 0.2;

export class ArrowParts {
  readonly head = new ConeGeometry(HEAD_RADIUS, HEAD_LENGTH, 5);
  readonly headMaterial = new MeshStandardNodeMaterial({ color: 0x4a_48_46, roughness: 0.6 });
  readonly shaft = new CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_LENGTH, 5);
  readonly shaftMaterial = new MeshStandardNodeMaterial({ color: 0x8b_6a_44, roughness: 0.85 });

  constructor() {
    this.shaft.rotateX(Math.PI / 2);
    this.head.rotateX(Math.PI / 2);
    this.head.translate(0, 0, SHAFT_LENGTH / 2 + HEAD_LENGTH / 2);
  }

  dispose(): void {
    this.head.dispose();
    this.headMaterial.dispose();
    this.shaft.dispose();
    this.shaftMaterial.dispose();
  }
}

export class ArrowFlight implements ActiveEffect {
  readonly isOnGameClock = true;
  readonly meshes: readonly Mesh[];
  readonly #arc: number;
  readonly #effect: ArrowEffect;
  readonly #from: Vector3;
  readonly #position = new Vector3();
  readonly #to: Vector3;
  readonly #toward = new Vector3();
  #age = 0;

  constructor(context: EffectContext, effect: ArrowEffect, parts: ArrowParts) {
    this.#effect = effect;
    this.#from = new Vector3(
      effect.fromX,
      context.surface.heightAt(effect.fromX, effect.fromZ) + RELEASE_HEIGHT,
      effect.fromZ
    );
    this.#to = new Vector3(effect.toX, context.surface.heightAt(effect.toX, effect.toZ) + TARGET_HEIGHT, effect.toZ);
    this.#arc = this.#from.distanceTo(this.#to) * ARC_PER_METER;

    const shaft = new Mesh(parts.shaft, parts.shaftMaterial);
    const head = new Mesh(parts.head, parts.headMaterial);

    shaft.castShadow = true;
    shaft.add(head);
    this.meshes = [shaft];
    this.#fly(0);
  }

  update(seconds: number): boolean {
    this.#age += seconds;

    const duration = Math.max(SHORTEST_FLIGHT, this.#effect.durationSeconds);

    this.#fly(saturate(this.#age / duration));

    return this.#age < duration + (this.#effect.isHit ? 0 : LINGER_SECONDS);
  }

  #fly(progress: number): void {
    const [shaft] = this.meshes;

    this.#pointAt(progress, this.#position);
    this.#pointAt(Math.min(1, progress + 0.02), this.#toward);

    if (progress >= 1) {
      this.#toward
        .subVectors(this.#to, this.#from)
        .normalize()
        .add(this.#to)
        .setY(this.#to.y - this.#arc);
    }

    shaft.position.copy(this.#position);
    shaft.lookAt(this.#toward);
  }

  #pointAt(progress: number, target: Vector3): void {
    target.copy(this.#from).lerp(this.#to, progress);
    target.y += Math.sin(progress * Math.PI) * this.#arc;
  }
}
