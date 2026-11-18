import {
  Color,
  Float32BufferAttribute,
  LatheGeometry,
  Mesh,
  MeshStandardNodeMaterial,
  Vector2,
  Vector3,
} from "three/webgpu";
import { FULL_TURN, saturate, smoothstep } from "../../shared/math.ts";
import { type NuclearFallEffect, SKY_ENTRY_HEIGHT } from "../../simulation/effects.ts";
import type { ActiveEffect, GroundRings, SpriteSinks } from "./effect-context.ts";
import type { GroundRing } from "./ground-ring.ts";

const TRAIL_STEPS = 21;
const TRAIL_SECONDS = 0.48;
const APPROACH_HEIGHT = 310;
const LAUNCH_OFFSET = new Vector3(-0.89, 1, 0.24);

const BODY_PROFILE = [
  new Vector2(0, -1),
  new Vector2(0.3, -0.85),
  new Vector2(0.43, -0.52),
  new Vector2(0.46, -0.32),
  new Vector2(0.46, -0.17),
  new Vector2(0.41, 0.22),
  new Vector2(0.27, 0.48),
  new Vector2(0.23, 0.55),
  new Vector2(0.24, 0.92),
  new Vector2(0, 0.92),
];

function flightHeight(time: number): number {
  const entry = 1 - smoothstep(0, 0.72, time);
  const approach = 1 - time * (0.35 + 0.65 * time);

  return (SKY_ENTRY_HEIGHT - APPROACH_HEIGHT) * entry * entry + APPROACH_HEIGHT * approach;
}

function createBodyGeometry(): LatheGeometry {
  const geometry = new LatheGeometry(BODY_PROFILE, 32);
  const positions = geometry.getAttribute("position");
  const colors: number[] = [];
  const graphite = new Color(0x34_48_56);
  const enamel = new Color(0xf3_ac_40);
  const copper = new Color(0xb8_65_32);
  const palette = [copper, graphite, graphite, enamel, enamel, graphite, graphite, graphite, enamel, graphite];

  for (let index = 0; index < positions.count; index += 1) {
    const section = index % BODY_PROFILE.length;
    const angle = (Math.floor(index / BODY_PROFILE.length) * FULL_TURN) / 32;
    const vane = Math.max(0, Math.cos(angle * 4)) ** 4;

    if (section === 6 || section === 8) {
      const reach = section === 8 ? 0.42 : 0.08;

      positions.setX(index, positions.getX(index) + Math.sin(angle) * reach * vane);
      positions.setZ(index, positions.getZ(index) + Math.cos(angle) * reach * vane);
    }

    const color = palette[section];

    colors.push(color.r, color.g, color.b);
  }

  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  return geometry;
}

export class NuclearFall implements ActiveEffect {
  readonly dropId: number;
  readonly isOnGameClock = true;
  readonly meshes: readonly Mesh[];
  readonly #body: Mesh<LatheGeometry, MeshStandardNodeMaterial>;
  readonly #rings: GroundRings;
  readonly #effect: NuclearFallEffect;
  readonly #ring: GroundRing;
  readonly #size: number;
  #age: number;

  constructor(rings: GroundRings, effect: NuclearFallEffect) {
    this.dropId = effect.dropId;
    this.#rings = rings;
    this.#effect = effect;
    this.#age = effect.elapsedSeconds === undefined ? 0 : effect.elapsedSeconds;
    this.#size = Math.max(7, effect.radius * 0.14);
    this.#ring = rings.takeRing();
    this.#body = new Mesh(createBodyGeometry(), new MeshStandardNodeMaterial({ roughness: 0.67, vertexColors: true }));
    this.#body.name = "Falling bomb";
    this.#body.castShadow = true;
    this.#body.scale.setScalar(this.#size);
    this.#body.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), LAUNCH_OFFSET.clone().normalize());
    this.meshes = [this.#body, this.#ring.mesh];
    this.#place(saturate(this.#age / effect.durationSeconds));
  }

  update(seconds: number, sinks: SpriteSinks): boolean {
    this.#age += seconds;

    const time = saturate(this.#age / this.#effect.durationSeconds);

    if (time >= 1) {
      return false;
    }

    const height = this.#place(time);
    const { x, y, z } = this.#body.position;
    const tailHeight = this.#size * 0.87;
    const trailTime = Math.min(time, TRAIL_SECONDS / this.#effect.durationSeconds);

    for (let index = 0; index < TRAIL_STEPS; index += 1) {
      const share = (index + 0.5) / TRAIL_STEPS;
      const behind = tailHeight + flightHeight(time - share * trailTime) - height;
      const curl = Math.sin(share * 10 + time * 4) * this.#size * share * 0.32;
      const trailX = x + LAUNCH_OFFSET.x * behind + curl;
      const trailZ = z + LAUNCH_OFFSET.z * behind;
      const size = this.#size * (0.42 + share * 1.15);

      sinks.dust.add([trailX, y + behind, trailZ, size], [0.68, 0.58, 0.4, (1 - share) * 0.72]);
    }

    sinks.glow.add(
      [x + LAUNCH_OFFSET.x * tailHeight, y + tailHeight, z + LAUNCH_OFFSET.z * tailHeight, this.#size * 0.95],
      [1, 0.46, 0.08, 0.8]
    );

    return true;
  }

  finish(): void {
    this.#rings.releaseRing(this.#ring);
    this.#body.material.dispose();
    this.#body.geometry.dispose();
  }

  #place(time: number): number {
    const { radius, surfaceY, x, z } = this.#effect;
    const remaining = 1 - time * (0.42 + 0.58 * time);
    const height = flightHeight(time);
    const warningRadius = Math.max(6, radius * (0.16 + 0.53 * remaining));

    this.#body.position.set(
      x + LAUNCH_OFFSET.x * height,
      surfaceY + this.#size * 0.8 + height,
      z + LAUNCH_OFFSET.z * height
    );
    this.#ring.show(x, z, warningRadius, 0xff_c6_60, 0.75 + time * 0.25, surfaceY, Math.max(1, radius * 0.024));

    return height;
  }
}
