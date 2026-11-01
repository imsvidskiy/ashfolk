import {
  abs,
  cameraPosition,
  distance,
  exp,
  Fn,
  float,
  fract,
  fwidth,
  If,
  length,
  max,
  min,
  mix,
  normalWorldGeometry,
  positionWorld,
  smoothstep,
  texture,
  time,
  vec3,
} from "three/tsl";
import { type DataTexture, type Node, RedFormat } from "three/webgpu";
import type { LavaView } from "../../simulation/frame.ts";
import { byteTexture } from "../data-textures.ts";
import { unitNoise } from "../node-helpers.ts";
import { type LavaPlates, PLATE_EDGE_ERROR, PLATE_FREQUENCY } from "./lava-plates.ts";

const HOT_CRUST = vec3(0.04, 0.03, 0.026);
const GLOW_DEEP = vec3(0.75, 0.09, 0.015);
const GLOW_HOT = vec3(1.6, 0.6, 0.1);
const LAVA_THRESHOLD = 0.004;
const THINNEST_CRACK = 0.03;
const WIDEST_CRACK = 0.25;
const CORE_SHARE = 0.4;
const CRACK_BLUR = 2;
const GLOW_FREQUENCY = 0.05;
const GLOW_CYCLE_SECONDS = 8;
const GLOW_TRAVEL = 10;
const DETAIL_FAR = 1700;
const DETAIL_NEAR = 1100;
const CRACK_COVERAGE = 3;
const FAR_GLOW = 1.2;
const WIDENING_NEAR = 500;
const WIDENING_FAR = 1500;
const FARTHEST_WIDENING = 0.6;

interface LavaLook {
  readonly color: Node<"vec3">;
  readonly glow: Node<"vec3">;
}

function crackAt(edge: Node<"float">, width: Node<"float">, blur: Node<"float">, detail: Node<"float">): Node<"float"> {
  const spread = width.add(blur.mul(0.5));
  const coverage = float(1).sub(exp(spread.mul(-CRACK_COVERAGE)));
  const sharpWidth = max(width, PLATE_EDGE_ERROR);
  const sharp = float(1)
    .sub(smoothstep(sharpWidth, sharpWidth.add(blur), edge))
    .mul(spread.div(sharpWidth.add(blur.mul(0.5))));

  return mix(min(coverage.mul(FAR_GLOW), 1), sharp, detail);
}

export class LavaField {
  readonly texture: DataTexture;
  readonly #data: Uint8Array;
  #applied: LavaView | null = null;
  #lit: Int32Array = new Int32Array(0);

  constructor(cellsPerSide: number) {
    this.#data = new Uint8Array(cellsPerSide * cellsPerSide);
    this.texture = byteTexture(this.#data, cellsPerSide, RedFormat);
  }

  update(lava: LavaView | null): void {
    if (lava === null || lava === this.#applied || (lava.cells.length === 0 && this.#lit.length === 0)) {
      return;
    }

    this.#applied = lava;

    for (const cell of this.#lit) {
      this.#data[cell] = 0;
    }

    for (const [index, cell] of lava.cells.entries()) {
      this.#data[cell] = lava.heat[index];
    }

    this.#lit = lava.cells.slice();
    this.texture.needsUpdate = true;
  }

  look(plates: LavaPlates, ground: Node<"vec3">, mapCoordinates: Node<"vec2">, point: Node<"vec2">): LavaLook {
    const heat = texture(this.texture, mapCoordinates).r;
    const viewDistance = distance(positionWorld, cameraPosition);
    const detail = smoothstep(DETAIL_FAR, DETAIL_NEAR, viewDistance);
    const widening = smoothstep(WIDENING_NEAR, WIDENING_FAR, viewDistance).mul(FARTHEST_WIDENING).add(1);

    const glow = Fn(() => {
      const blur = length(fwidth(point))
        .mul(PLATE_FREQUENCY * CRACK_BLUR)
        .toVar();
      const light = vec3(0).toVar();

      If(heat.greaterThan(LAVA_THRESHOLD), () => {
        const cycle = time.div(GLOW_CYCLE_SECONDS);
        const phase = fract(cycle);
        const otherPhase = fract(cycle.add(0.5));
        const travel = normalWorldGeometry.xz.mul(GLOW_TRAVEL);

        const pulse = mix(
          unitNoise(point.sub(travel.mul(phase)).mul(GLOW_FREQUENCY)),
          unitNoise(point.sub(travel.mul(otherPhase)).mul(GLOW_FREQUENCY).add(7.3)),
          abs(phase.mul(2).sub(1))
        );
        const crackWidth = mix(float(THINNEST_CRACK), float(WIDEST_CRACK), heat.mul(heat))
          .mul(pulse.add(0.5))
          .mul(widening);
        const edge = float(1).toVar();

        If(detail.greaterThan(0), () => {
          edge.assign(plates.edgeAt(point));
        });

        const crack = crackAt(edge, crackWidth, blur, detail);
        const core = crackAt(edge, crackWidth.mul(CORE_SHARE), blur, detail)
          .mul(heat)
          .mul(smoothstep(0.15, 0.85, pulse).mul(0.6).add(0.4));

        light.assign(
          GLOW_DEEP.mul(crack)
            .add(GLOW_HOT.sub(GLOW_DEEP).mul(core))
            .mul(smoothstep(0.08, 0.3, heat))
        );
      });

      return light;
    })();

    return { color: mix(ground, HOT_CRUST, smoothstep(0.1, 0.5, heat).mul(smoothstep(0.02, 0.15, heat))), glow };
  }

  dispose(): void {
    this.texture.dispose();
  }
}
