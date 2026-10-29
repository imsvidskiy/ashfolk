import { type Mesh, Vector3 } from "three/webgpu";
import { hashToUnit, smoothstep } from "../../shared/math.ts";
import type { MeteorEffect } from "../../simulation/effects.ts";
import type { ActiveEffect, EffectContext, SpriteSinks } from "./transient-effects.ts";

const ENTRY_SPEED = 0.45;
const TRAIL_SPACING = 0.6;
const SMOKE_SECONDS = 4.5;
const HOT_SECONDS = 0.35;
const SPARK_SECONDS = 0.9;
const SPARKS_PER_SECOND = 70;
const GRAVITY = 30;
const SHEATH_LENGTH = 3.2;
const TUMBLE = new Vector3(1.3, 0.8, 0.45);

interface TrailPuff {
  readonly age: number;
  readonly index: number;
  readonly position: Vector3;
}

interface Spark {
  age: number;
  readonly position: Vector3;
  readonly velocity: Vector3;
}

export class MeteorFall implements ActiveEffect {
  readonly meshes: readonly Mesh[];
  readonly #context: EffectContext;
  readonly #direction: Vector3;
  readonly #effect: MeteorEffect;
  readonly #from: Vector3;
  readonly #head = new Vector3();
  readonly #previous = new Vector3();
  readonly #puffs: TrailPuff[] = [];
  readonly #rock: Mesh;
  readonly #sheath: Mesh;
  readonly #size: number;
  readonly #sparks: Spark[] = [];
  readonly #to: Vector3;
  #age = 0;
  #sparkCount = 0;
  #sparkDebt = 0;
  #traveled = 0;

  constructor(context: EffectContext, effect: MeteorEffect) {
    this.#context = context;
    this.#effect = effect;
    this.#from = new Vector3(effect.fromX, effect.fromY, effect.fromZ);
    this.#to = new Vector3(effect.toX, context.heightAt(effect.toX, effect.toZ), effect.toZ);
    this.#direction = this.#to.clone().sub(this.#from).normalize();
    this.#size = 6 + effect.radius * 0.03;
    this.#rock = context.meshes.createMeteor();
    this.#sheath = context.meshes.createFireball();
    this.#head.copy(this.#from);
    this.meshes = [this.#rock, this.#sheath];
  }

  update(seconds: number, sinks: SpriteSinks): boolean {
    this.#age += seconds;

    const duration = this.#effect.durationSeconds;
    const isFalling = this.#age < duration;

    if (isFalling) {
      this.#fall(seconds, sinks, this.#age / duration);
    } else {
      this.#rock.visible = false;
      this.#sheath.visible = false;
    }

    this.#drawTrail(sinks);
    this.#drawSparks(seconds, sinks);

    return this.#age < duration + SMOKE_SECONDS;
  }

  #fall(seconds: number, sinks: SpriteSinks, time: number): void {
    const progress = time * (ENTRY_SPEED + (1 - ENTRY_SPEED) * time);
    const entry = smoothstep(0, 0.2, time);
    const size = this.#size;

    this.#previous.copy(this.#head);
    this.#head.lerpVectors(this.#from, this.#to, progress);
    this.#leaveTrail();
    this.#shedSparks(seconds);

    this.#rock.position.copy(this.#head);
    this.#rock.scale.setScalar(size);
    this.#rock.rotation.x += seconds * TUMBLE.x;
    this.#rock.rotation.y += seconds * TUMBLE.y;
    this.#rock.rotation.z += seconds * TUMBLE.z;

    this.#sheath.position.copy(this.#head).addScaledVector(this.#direction, -size * SHEATH_LENGTH * 0.55);
    this.#sheath.lookAt(this.#head);
    this.#sheath.scale.set(size * 1.5 * entry, size * 1.5 * entry, size * SHEATH_LENGTH * entry);
    this.#context.meshes.setFireballHeat(this.#sheath, 0.6 + 0.4 * entry);

    sinks.glow.add([this.#head.x, this.#head.y, this.#head.z, size * (4 + 4 * entry)], [1, 0.72, 0.38, entry]);
    this.#context.light(this.#head, 0xff_8a_3a, 3 + 9 * time);
  }

  #leaveTrail(): void {
    const spacing = this.#size * TRAIL_SPACING;

    this.#traveled += this.#previous.distanceTo(this.#head);

    while (this.#traveled >= spacing) {
      this.#traveled -= spacing;

      const behind = this.#head.clone().addScaledVector(this.#direction, -this.#traveled);

      this.#puffs.push({ age: this.#age, index: this.#puffs.length, position: behind });
    }
  }

  #shedSparks(seconds: number): void {
    this.#sparkDebt += seconds * SPARKS_PER_SECOND;

    while (this.#sparkDebt >= 1) {
      this.#sparkDebt -= 1;
      this.#sparkCount += 1;

      const salt = this.#sparkCount + this.#effect.fromX;
      const spread = 18 + hashToUnit(salt, 4) * 30;

      this.#sparks.push({
        age: 0,
        position: this.#head.clone(),
        velocity: new Vector3(
          (hashToUnit(salt, 1) - 0.5) * spread,
          (hashToUnit(salt, 2) - 0.3) * spread,
          (hashToUnit(salt, 3) - 0.5) * spread
        ).addScaledVector(this.#direction, -spread),
      });
    }
  }

  #drawTrail(sinks: SpriteSinks): void {
    const size = this.#size;

    for (const puff of this.#puffs) {
      const age = this.#age - puff.age;

      if (age >= SMOKE_SECONDS) {
        continue;
      }

      const swell = 0.7 + hashToUnit(puff.index, 7) * 0.7;
      const driftX = (hashToUnit(puff.index, 8) - 0.5) * size * 1.4 * age;
      const driftZ = (hashToUnit(puff.index, 9) - 0.5) * size * 1.4 * age;

      const { x, y, z } = puff.position;
      const smoke = 1 - smoothstep(0.3, SMOKE_SECONDS, age);
      const heat = 1 - smoothstep(0, HOT_SECONDS, age);
      const shade = 0.3 + smoothstep(0, 2.5, age) * 0.28;

      sinks.dust.add(
        [x + driftX, y + age * 6, z + driftZ, size * swell * (1.6 + age * 2.6)],
        [shade, shade * 0.95, shade * 0.9, smoke * 0.5]
      );

      if (heat > 0) {
        sinks.glow.add([x, y, z, size * (1.6 + heat * 1.2)], [1, 0.38 + heat * 0.35, 0.1, heat]);
      }
    }
  }

  #drawSparks(seconds: number, sinks: SpriteSinks): void {
    for (const spark of this.#sparks) {
      if (spark.age >= SPARK_SECONDS) {
        continue;
      }

      spark.age += seconds;
      spark.velocity.y -= GRAVITY * seconds;
      spark.position.addScaledVector(spark.velocity, seconds);

      const glow = 1 - smoothstep(0, SPARK_SECONDS, spark.age);

      if (glow > 0) {
        sinks.glow.add([spark.position.x, spark.position.y, spark.position.z, 2.5 + glow * 2], [1, 0.62, 0.22, glow]);
      }
    }
  }
}
