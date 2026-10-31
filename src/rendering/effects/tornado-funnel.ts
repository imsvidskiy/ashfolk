import type { Mesh } from "three/webgpu";
import type { Color } from "../../content/grounds.ts";
import { FULL_TURN, hashToUnit, lerp, smoothstep } from "../../shared/math.ts";
import type { TornadoEffect } from "../../simulation/effects.ts";
import { tornadoDuration, tornadoPositionAt } from "../../simulation/powers/tornadoes.ts";
import type { ActiveEffect, EffectContext, SpriteSinks } from "./transient-effects.ts";

const GROWING_SECONDS = 1.5;
const FADING_SECONDS = 2.5;
const HEIGHT_PER_RADIUS = 6;
const LAYERS = 30;
const PUFFS_PER_LAYER = 9;
const NARROWEST_SHARE = 0.12;
const WIDEST_SHARE = 2.4;
const FLARE = 2.6;
const SPIN = 5;
const SWAY = 0.35;
const CAP_PUFFS = 26;
const CAP_SPREAD = 3.4;
const DUST_PUFFS = 28;
const DEBRIS = 40;
const DEBRIS_ORBIT_SECONDS = 2.6;
const FUNNEL_SHADE: Color = [0.5, 0.52, 0.55];
const CAP_SHADE: Color = [0.36, 0.38, 0.42];
const DUST_SHADE: Color = [0.42, 0.36, 0.29];
const DEBRIS_SHADE: Color = [0.2, 0.16, 0.12];

interface Base {
  ground: number;
  presence: number;
  x: number;
  z: number;
}

export class TornadoFunnel implements ActiveEffect {
  readonly isOnGameClock = true;
  readonly meshes: readonly Mesh[] = [];
  readonly #context: EffectContext;
  readonly #duration: number;
  readonly #effect: TornadoEffect;
  readonly #height: number;
  #age = 0;

  constructor(context: EffectContext, effect: TornadoEffect) {
    this.#context = context;
    this.#effect = effect;
    this.#duration = tornadoDuration(effect.path);
    this.#height = effect.radius * HEIGHT_PER_RADIUS;
  }

  update(seconds: number, sinks: SpriteSinks): boolean {
    this.#age += seconds;

    const { x, z } = tornadoPositionAt(this.#effect.path, this.#age);

    const base = {
      ground: this.#context.heightAt(x, z),
      presence:
        smoothstep(0, GROWING_SECONDS, this.#age) *
        (1 - smoothstep(this.#duration, this.#duration + FADING_SECONDS, this.#age)),
      x,
      z,
    };

    this.#drawFunnel(base, sinks);
    this.#drawCap(base, sinks);
    this.#drawDust(base, sinks);
    this.#drawDebris(base, sinks);

    return this.#age < this.#duration + FADING_SECONDS;
  }

  #sway(share: number): number {
    return Math.sin(this.#age * 1.3 + share * 3) * this.#effect.radius * SWAY * share;
  }

  #drawFunnel(base: Base, sinks: SpriteSinks): void {
    const { radius } = this.#effect;

    for (let layer = 0; layer < LAYERS; layer += 1) {
      const share = layer / (LAYERS - 1);
      const reach = radius * lerp(NARROWEST_SHARE, WIDEST_SHARE, share ** FLARE) * lerp(0.4, 1, base.presence);
      const spin = this.#age * SPIN * lerp(1.6, 0.6, share);
      const shade = lerp(1.08, 0.88, share);
      const look = [FUNNEL_SHADE[0] * shade, FUNNEL_SHADE[1] * shade, FUNNEL_SHADE[2] * shade, 0.5 * base.presence];
      const sway = this.#sway(share);
      const height = base.ground + share * this.#height * base.presence;

      for (let puff = 0; puff < PUFFS_PER_LAYER; puff += 1) {
        const angle = hashToUnit(layer, puff, 1) * FULL_TURN + spin;
        const wobble = 0.75 + hashToUnit(layer, puff, 2) * 0.5;

        sinks.dust.add(
          [
            base.x + sway + Math.cos(angle) * reach * wobble,
            height,
            base.z + Math.sin(angle) * reach * wobble,
            radius * 0.25 + reach * 0.55,
          ],
          look
        );
      }
    }
  }

  #drawCap(base: Base, sinks: SpriteSinks): void {
    const { radius } = this.#effect;

    const look = [...CAP_SHADE, 0.55 * base.presence];

    for (let puff = 0; puff < CAP_PUFFS; puff += 1) {
      const angle = hashToUnit(puff, 21) * FULL_TURN + this.#age * 0.6;
      const reach = Math.sqrt(hashToUnit(puff, 22)) * radius * CAP_SPREAD;

      sinks.dust.add(
        [
          base.x + this.#sway(1) + Math.cos(angle) * reach,
          base.ground + this.#height * base.presence + hashToUnit(puff, 23) * radius * 0.5,
          base.z + Math.sin(angle) * reach,
          radius * (1.1 + hashToUnit(puff, 24) * 0.6),
        ],
        look
      );
    }
  }

  #drawDust(base: Base, sinks: SpriteSinks): void {
    const { radius } = this.#effect;

    const look = [...DUST_SHADE, 0.55 * base.presence];

    for (let puff = 0; puff < DUST_PUFFS; puff += 1) {
      const angle = hashToUnit(puff, 31) * FULL_TURN + this.#age * SPIN * 0.8;
      const reach = radius * (0.5 + hashToUnit(puff, 32) * 0.7);
      const rise = ((this.#age * 0.7 + hashToUnit(puff, 33)) % 1) * radius * 0.8;

      sinks.dust.add(
        [
          base.x + Math.cos(angle) * reach,
          base.ground + rise,
          base.z + Math.sin(angle) * reach,
          radius * (0.35 + hashToUnit(puff, 34) * 0.3),
        ],
        look
      );
    }
  }

  #drawDebris(base: Base, sinks: SpriteSinks): void {
    const { radius } = this.#effect;

    const look = [...DEBRIS_SHADE, 0.9 * base.presence];

    for (let piece = 0; piece < DEBRIS; piece += 1) {
      const lift = (this.#age / DEBRIS_ORBIT_SECONDS + hashToUnit(piece, 41)) % 1;
      const angle = hashToUnit(piece, 42) * FULL_TURN + this.#age * SPIN * 1.2;
      const reach = radius * lerp(0.3, 1.1, lift) * (0.8 + hashToUnit(piece, 43) * 0.4);

      sinks.dust.add(
        [
          base.x + this.#sway(lift * 0.4) + Math.cos(angle) * reach,
          base.ground + lift * this.#height * 0.4,
          base.z + Math.sin(angle) * reach,
          1.2 + hashToUnit(piece, 44) * 2.4,
        ],
        look
      );
    }
  }
}
