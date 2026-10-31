import { Group, PointLight, type Vector3 } from "three/webgpu";
import type { SimulationEffect } from "../../simulation/effects.ts";
import { ArrowFlight, ArrowParts } from "./arrow-flight.ts";
import { type CameraAxes, createBillboardBatch } from "./billboards.ts";
import { EffectMeshes } from "./effect-meshes.ts";
import type { GroundRing } from "./ground-ring.ts";
import { MeteorFall } from "./meteor-fall.ts";
import { createDustMaterial, createGlowMaterial } from "./sprite-materials.ts";
import { TornadoFunnel } from "./tornado-funnel.ts";
import {
  type ActiveEffect,
  Blessing,
  Earthquake,
  type EffectContext,
  EmberFlight,
  Explosion,
  LightningStrike,
  Splash,
  type SpriteSinks,
} from "./transient-effects.ts";

const FLASH_DECAY = 7;
const LIGHT_DECAY = 5;
const LIGHT_DISTANCE = 900;
const LIGHT_FALLOFF = 1.4;
const LIGHT_POWER = 400;

interface EffectViewOptions {
  readonly axes: CameraAxes;
  readonly createRing: () => GroundRing;
  readonly heightAt: (x: number, z: number) => number;
  readonly shake: (amount: number, x: number, z: number) => void;
}

export class EffectView {
  readonly group = new Group();
  readonly #active: ActiveEffect[] = [];
  readonly #arrowParts = new ArrowParts();
  readonly #context: EffectContext;
  readonly #createRing: () => GroundRing;
  readonly #idleRings: GroundRing[] = [];
  readonly #light = new PointLight(0xff_ff_ff, 0, LIGHT_DISTANCE, LIGHT_FALLOFF);
  readonly #meshes = new EffectMeshes();
  readonly #sinks: SpriteSinks;
  #flash = 0;
  #lightStrength = 0;

  constructor(options: EffectViewOptions) {
    this.#createRing = options.createRing;
    this.#sinks = {
      dust: createBillboardBatch(createDustMaterial(options.axes), 5),
      glow: createBillboardBatch(createGlowMaterial(options.axes), 9),
    };

    this.#context = {
      flash: (amount) => {
        this.#flash = Math.max(this.#flash, amount);
      },
      heightAt: options.heightAt,
      light: (position, color, intensity) => {
        this.#lightUp(position, color, intensity);
      },
      meshes: this.#meshes,
      releaseRing: (ring) => {
        this.#releaseRing(ring);
      },
      shake: options.shake,
      takeRing: () => {
        return this.#takeRing();
      },
    };

    this.group.add(this.#sinks.dust.mesh, this.#sinks.glow.mesh, this.#light);
  }

  get flash(): number {
    return this.#flash;
  }

  add(effects: readonly SimulationEffect[]): void {
    for (const effect of effects) {
      const active = this.#start(effect);

      this.#active.push(active);

      for (const mesh of active.meshes) {
        this.group.add(mesh);
      }
    }
  }

  update(realSeconds: number, gameSeconds: number): void {
    this.#sinks.dust.begin();
    this.#sinks.glow.begin();

    for (let index = this.#active.length - 1; index >= 0; index -= 1) {
      const effect = this.#active[index];

      if (!effect.update(effect.isOnGameClock === true ? gameSeconds : realSeconds, this.#sinks)) {
        this.#finish(index, effect);
      }
    }

    this.#sinks.dust.commit();
    this.#sinks.glow.commit();
    this.#flash *= Math.exp(-FLASH_DECAY * realSeconds);
    this.#lightStrength *= Math.exp(-LIGHT_DECAY * realSeconds);
    this.#light.intensity = this.#lightStrength * LIGHT_POWER;
  }

  dispose(): void {
    for (let index = this.#active.length - 1; index >= 0; index -= 1) {
      this.#finish(index, this.#active[index]);
    }

    for (const ring of this.#idleRings.splice(0)) {
      ring.dispose();
    }

    for (const batch of [this.#sinks.dust, this.#sinks.glow]) {
      batch.dispose();
      batch.mesh.material.dispose();
    }

    this.#meshes.dispose();
    this.#arrowParts.dispose();
  }

  #start(effect: SimulationEffect): ActiveEffect {
    switch (effect.kind) {
      case "arrow":
        return new ArrowFlight(this.#context, effect, this.#arrowParts);
      case "blessing":
        return new Blessing(this.#context, effect);
      case "earthquake":
        return new Earthquake(this.#context, effect);
      case "ember":
        return new EmberFlight(this.#context, effect);
      case "explosion":
        return new Explosion(this.#context, effect);
      case "lightning":
        return new LightningStrike(this.#context, effect);
      case "meteor":
        return new MeteorFall(this.#context, effect);
      case "splash":
        return new Splash(effect);
      case "tornado":
        return new TornadoFunnel(this.#context, effect);
      default:
        return effect satisfies never;
    }
  }

  #finish(index: number, effect: ActiveEffect): void {
    this.#active.splice(index, 1);

    for (const mesh of effect.meshes) {
      this.group.remove(mesh);
    }

    if (effect.finish !== undefined) {
      effect.finish();
    }
  }

  #takeRing(): GroundRing {
    const ring = this.#idleRings.pop();

    return ring === undefined ? this.#createRing() : ring;
  }

  #releaseRing(ring: GroundRing): void {
    ring.hide();
    this.#idleRings.push(ring);
  }

  #lightUp(position: Vector3, color: number, intensity: number): void {
    this.#light.position.copy(position);
    this.#light.color.setHex(color);
    this.#lightStrength = Math.max(this.#lightStrength, intensity);
  }
}
