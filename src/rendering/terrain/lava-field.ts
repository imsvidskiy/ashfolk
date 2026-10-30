import { abs, Fn, float, If, min, mix, mx_noise_float, smoothstep, texture, time, vec3, vec4 } from "three/tsl";
import { type DataTexture, type Node, RedFormat } from "three/webgpu";
import type { LavaView } from "../../simulation/frame.ts";
import { byteTexture } from "../data-textures.ts";

const CRUST = vec3(0.035, 0.03, 0.028);
const MOLTEN_DEEP = vec3(2.2, 0.32, 0.03);
const MOLTEN_BRIGHT = vec3(4.2, 1.5, 0.25);
const LAVA_THRESHOLD = 0.004;
const CRACK_SCALE = 0.11;
const SWIRL_SCALE = 0.035;
const FLOW_SPEED = 0.18;

interface LavaLook {
  readonly color: Node<"vec3">;
  readonly glow: Node<"vec3">;
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

  look(ground: Node<"vec3">, mapCoordinates: Node<"vec2">, point: Node<"vec2">): LavaLook {
    const heat = texture(this.texture, mapCoordinates).r;

    const lava = Fn(() => {
      const result = vec4(0).toVar();

      If(heat.greaterThan(LAVA_THRESHOLD), () => {
        const swirl = mx_noise_float(vec3(point.mul(SWIRL_SCALE), time.mul(FLOW_SPEED * 0.4)));
        const cracks = mx_noise_float(vec3(point.mul(CRACK_SCALE).add(swirl), time.mul(FLOW_SPEED)));

        const crustCover = smoothstep(0.02, 0.25, heat);
        const crackWidth = heat.mul(heat).mul(0.45).add(0.02);
        const molten = float(1)
          .sub(smoothstep(0, crackWidth, abs(cracks)))
          .mul(smoothstep(0.08, 0.5, heat));
        const pool = smoothstep(0.75, 1, heat)
          .mul(smoothstep(-0.2, 0.5, swirl))
          .mul(0.6);
        const brightness = min(molten.add(pool), 1);

        result.assign(vec4(mix(MOLTEN_DEEP, MOLTEN_BRIGHT, brightness.mul(heat)).mul(brightness), crustCover));
      });

      return result;
    })();

    return { color: mix(ground, CRUST, lava.w), glow: lava.xyz };
  }

  dispose(): void {
    this.texture.dispose();
  }
}
