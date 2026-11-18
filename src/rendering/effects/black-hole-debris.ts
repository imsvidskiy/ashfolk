import {
  cameraPosition,
  dot,
  length,
  max,
  normalize,
  positionWorld,
  smoothstep as shaderSmoothstep,
  sqrt,
  uniform,
} from "three/tsl";
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  MeshStandardNodeMaterial,
  Quaternion,
  Sphere,
  Vector2,
  Vector3,
} from "three/webgpu";
import { hashToUnit, lerp, saturate, smoothstep } from "../../shared/math.ts";
import type { BlackHoleInflowEffect, InflowSource } from "../../simulation/effects.ts";
import { BLACK_HOLE_CORE_SHARE } from "../../simulation/powers/black-holes.ts";
import type { ActiveEffect } from "./transient-effects.ts";

const UP = new Vector3(0, 1, 0);

type Shape = "board" | "crown" | "needle" | "rock" | "soil" | "spray" | "trunk";

interface Piece {
  readonly color: number;
  readonly heading: number;
  readonly origin: Vector3;
  readonly rotation: number;
  readonly scale: Vector3;
  readonly seed: number;
  readonly shape: Shape;
  readonly tilt: number;
}

function geometryFor(shape: Shape) {
  switch (shape) {
    case "trunk":
      return new CylinderGeometry(0.72, 1, 1, 7);
    case "needle":
      return new LatheGeometry(
        [
          new Vector2(0, -0.5),
          new Vector2(1, -0.46),
          new Vector2(0.62, -0.13),
          new Vector2(0.79, -0.21),
          new Vector2(0.36, 0.13),
          new Vector2(0.52, 0.06),
          new Vector2(0, 0.5),
        ],
        9
      );
    case "board":
      return new BoxGeometry(1, 1, 1);
    default:
      return new IcosahedronGeometry(1, 0);
  }
}

function piecesFrom(effect: BlackHoleInflowEffect, source: InflowSource): Piece[] {
  const pieces: Piece[] = [];
  const { size } = source;
  const tilt = source.isFallen ? Math.PI * 0.46 : 0;
  const pose = new Euler(tilt, source.rotation, 0, "YXZ");

  function add(
    shape: Shape,
    color: number,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    angle = 0
  ): void {
    const seed = hashToUnit(source.x, source.z, pieces.length + 1);
    const origin = new Vector3(x, y, z).multiplyScalar(size).applyEuler(pose);

    origin.x += source.x - effect.x;
    origin.y += source.y - effect.surfaceY;
    origin.z += source.z - effect.z;

    pieces.push({
      color,
      heading: Math.atan2(origin.z, origin.x),
      origin,
      rotation: source.rotation,
      scale: new Vector3(width, height, depth).multiplyScalar(size),
      seed,
      shape,
      tilt: tilt + angle,
    });
  }

  switch (source.material) {
    case "conifer":
      add("trunk", 0x83_54_2e, 0, 0.37, 0, 0.08, 0.73, 0.08);
      add("needle", 0x31_55_39, 0, 0.5, 0, 0.26, 0.5, 0.26);
      add("needle", 0x49_6d_48, 0, 0.77, 0, 0.17, 0.46, 0.17);
      break;
    case "broadleaf":
      add("trunk", 0x92_63_3b, 0, 0.27, 0, 0.1, 0.54, 0.09);
      add("crown", 0x82_9e_4f, -0.11, 0.57, 0.02, 0.33, 0.26, 0.29);
      add("crown", 0x5b_85_46, 0.13, 0.73, 0, 0.24, 0.25, 0.23);
      break;
    case "wood":
      add("trunk", 0xb9_88_59, 0, 0.34, 0, 0.09, 0.68, 0.09);
      add("trunk", 0x84_5e_39, 0.1, 0.58, 0, 0.055, 0.38, 0.055, -0.56);
      break;
    case "roof":
      add("board", 0xcb_a4_68, 0, 0.36, -0.18, 0.97, 0.09, 0.54, -0.54);
      add("board", 0xbd_86_48, 0, 0.36, 0.18, 0.95, 0.09, 0.54, 0.54);
      add("trunk", 0x86_59_36, 0.21, 0.19, 0.18, 0.07, 0.64, 0.07);
      break;
    case "masonry":
      add("board", 0xab_9e_84, -0.19, 0.21, 0, 0.48, 0.4, 0.31);
      add("board", 0xc5_b5_9b, 0.21, 0.37, 0, 0.45, 0.27, 0.35);
      break;
    case "rock":
      add("rock", 0x9c_96_86, -0.15, 0.27, 0, 0.49, 0.45, 0.37);
      add("rock", 0xc1_b7_a3, 0.25, 0.13, 0.1, 0.25, 0.21, 0.18);
      break;
    case "earth":
      add("soil", 0x9b_74_48, 0, 0.12, 0, 0.75, 0.34, 0.55);
      add("rock", 0x88_8d_52, 0, 0.23, 0.01, 0.72, 0.15, 0.54);
      break;
    case "water":
      add("spray", 0x8d_d2_e6, 0, 0.12, 0, 0.47, 0.21, 0.8);
      add("spray", 0xc8_e9_ee, 0.33, 0.17, 0.16, 0.22, 0.19, 0.36);
      break;
    default:
      return source.material satisfies never;
  }

  return pieces;
}

export class BlackHoleDebris implements ActiveEffect {
  readonly isOnGameClock = true;
  readonly meshes: readonly InstancedMesh[];
  readonly #clock: (() => number) | undefined;
  readonly #center = uniform(new Vector3());
  readonly #horizon = uniform(0);
  readonly #batches: { mesh: InstancedMesh; pieces: Piece[] }[] = [];
  readonly #effect: BlackHoleInflowEffect;
  readonly #material = new MeshStandardNodeMaterial({
    depthWrite: false,
    flatShading: true,
    roughness: 0.9,
    transparent: true,
  });
  readonly #matrix = new Matrix4();
  readonly #orientation = new Quaternion();
  readonly #position = new Vector3();
  readonly #rotation = new Euler(0, 0, 0, "YXZ");
  readonly #scale = new Vector3();
  readonly #tangent = new Vector3();
  readonly #toward = new Quaternion();
  #age: number;

  constructor(effect: BlackHoleInflowEffect, clock?: () => number) {
    this.#clock = clock;
    this.#effect = effect;
    this.#age = effect.elapsedSeconds === undefined ? 0 : effect.elapsedSeconds;

    const offset = positionWorld.sub(this.#center);
    const sight = normalize(cameraPosition.sub(this.#center));
    const depth = dot(offset, sight);
    const projected = length(offset.sub(sight.mul(depth)));
    const horizonDepth = sqrt(max(0, this.#horizon.mul(this.#horizon).sub(projected.mul(projected))));
    const outside = shaderSmoothstep(this.#horizon.mul(0.99), this.#horizon.mul(1.02), projected);
    const foreground = shaderSmoothstep(horizonDepth.sub(1), horizonDepth.add(1), depth);

    this.#material.opacityNode = max(outside, foreground);

    const groups = new Map<Shape, Piece[]>();

    for (const source of effect.sources) {
      for (const piece of piecesFrom(effect, source)) {
        const group = groups.get(piece.shape);

        if (group === undefined) {
          groups.set(piece.shape, [piece]);
        } else {
          group.push(piece);
        }
      }
    }

    for (const [shape, pieces] of groups) {
      const mesh = new InstancedMesh(geometryFor(shape), this.#material, pieces.length);

      mesh.position.set(effect.x, effect.surfaceY, effect.z);
      mesh.renderOrder = 5;
      mesh.boundingSphere = new Sphere(
        new Vector3(),
        effect.radius * 2 +
          Math.max(
            ...pieces.map((piece) => {
              return Math.abs(piece.origin.y) + piece.scale.length();
            })
          )
      );

      for (const [index, piece] of pieces.entries()) {
        mesh.setColorAt(index, new Color(piece.color).multiplyScalar(0.88 + piece.seed * 0.3));
      }

      this.#batches.push({ mesh, pieces });
    }

    this.meshes = this.#batches.map(({ mesh }) => {
      return mesh;
    });
    this.#place();
  }

  get wellId(): number {
    return this.#effect.wellId;
  }

  update(seconds: number): boolean {
    const age = this.#clock === undefined ? this.#age + seconds : this.#clock() - this.#effect.startedAt;

    if (this.#age !== age) {
      this.#age = age;
      this.#place();
    }

    return this.#age < this.#effect.durationSeconds;
  }

  finish(): void {
    for (const { mesh } of this.#batches) {
      mesh.dispose();
      mesh.geometry.dispose();
    }

    this.#material.dispose();
  }

  #place(): void {
    const { durationSeconds, holeDuration, radius, startedAt } = this.#effect;
    const age = startedAt + this.#age;
    const opening = 0.08 + smoothstep(0, 0.7, age) * 0.92;
    const closing = 1 - smoothstep(holeDuration - 0.85, holeDuration, age);
    const centerY = radius * 0.47 * opening * closing;
    const phase = lerp(saturate(this.#age / durationSeconds), 1, 1 - closing);

    this.#center.value.set(this.#effect.x, this.#effect.surfaceY + centerY, this.#effect.z);
    this.#horizon.value = Math.max(0.01, radius * opening * closing * BLACK_HOLE_CORE_SHARE);

    for (const { mesh, pieces } of this.#batches) {
      for (const [index, piece] of pieces.entries()) {
        const { origin, seed } = piece;
        const delay = seed * 0.13;
        const travel = saturate((phase - delay) / (1 - delay));
        const fall = smoothstep(0, 1, travel);
        const arch = Math.sin(travel * Math.PI);
        const heading = piece.heading + travel * 0.55 + travel * travel * (4.9 + seed * 1.1);
        const distance = Math.hypot(origin.x, origin.z) * (1 - fall) + radius * arch * closing * (0.26 + seed * 0.18);
        const sine = Math.sin(heading);
        const cosine = Math.cos(heading);
        const shear = smoothstep(0.39, 0.91, travel);
        const shrink = 1 - smoothstep(0.78, 1, travel);

        this.#position.set(
          cosine * distance,
          lerp(origin.y, centerY, fall) + radius * arch * closing * (0.17 + seed * 0.18),
          sine * distance
        );
        this.#rotation.set(
          piece.tilt + travel * (2.4 + seed * 5),
          piece.rotation + travel * 4,
          arch * (0.6 + seed * 2),
          "YXZ"
        );
        this.#orientation.setFromEuler(this.#rotation);
        this.#tangent.set(-sine - cosine * travel, 0.16 - travel * 0.4, cosine - sine * travel).normalize();
        this.#toward.setFromUnitVectors(UP, this.#tangent);
        this.#orientation.slerp(this.#toward, shear * 0.9);
        this.#scale.copy(piece.scale).multiplyScalar(shrink);
        this.#scale.y *= 1 + shear * 2.85;
        this.#matrix.compose(this.#position, this.#orientation, this.#scale);
        mesh.setMatrixAt(index, this.#matrix);
      }

      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
