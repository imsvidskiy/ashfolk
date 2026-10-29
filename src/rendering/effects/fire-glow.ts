import { float, texture, vec3 } from "three/tsl";
import { type DataTexture, type Node, RedFormat } from "three/webgpu";
import type { LavaView, SimulationFrame } from "../../simulation/frame.ts";
import type { WorldGrid } from "../../world/world-grid.ts";
import { byteTexture } from "../data-textures.ts";
import { mapCoordinatesNode } from "../terrain/height-sampling.ts";

const CELLS_PER_TEXEL = 4;
const BLUR_RADIUS = 3;
const BLUR_GAIN = 1.6;
const FULL_GLOW = 22;
const BYTE = 255;
const GLOW_COLOR = vec3(1, 0.42, 0.12);
const GLOW_STRENGTH = 2.6;
const LAVA_GLOW = 1.4;

export type BurningCells = Pick<SimulationFrame, "burningCells" | "burningIntensity" | "lava">;

function blur(source: Float32Array, target: Float32Array, step: number, resolution: number): void {
  for (let texel = 0; texel < target.length; texel += 1) {
    const along = Math.floor(texel / step) % resolution;

    let sum = 0;
    let count = 0;

    for (let offset = -BLUR_RADIUS; offset <= BLUR_RADIUS; offset += 1) {
      if (along + offset >= 0 && along + offset < resolution) {
        sum += source[texel + offset * step];
        count += 1;
      }
    }

    target[texel] = (sum / count) * BLUR_GAIN;
  }
}

export function fireLightAt(glow: FireGlow, grid: WorldGrid, point: Node<"vec2">): Node<"vec3"> {
  const coordinates = mapCoordinatesNode(grid, point);

  return GLOW_COLOR.mul(texture(glow.texture, coordinates).level(float(0)).r.mul(GLOW_STRENGTH));
}

export class FireGlow {
  readonly texture: DataTexture;
  readonly #accumulated: Float32Array;
  readonly #data: Uint8Array;
  readonly #grid: WorldGrid;
  readonly #resolution: number;
  readonly #scratch: Float32Array;
  #frame: BurningCells | null = null;
  #lava: LavaView = { cells: new Int32Array(0), heat: new Uint8Array(0) };
  #litTexels = 0;

  constructor(grid: WorldGrid) {
    const resolution = Math.ceil(grid.cellsPerSide / CELLS_PER_TEXEL);

    this.#grid = grid;
    this.#resolution = resolution;
    this.#accumulated = new Float32Array(resolution * resolution);
    this.#data = new Uint8Array(resolution * resolution);
    this.#scratch = new Float32Array(resolution * resolution);
    this.texture = byteTexture(this.#data, resolution, RedFormat);
  }

  update(frame: BurningCells): void {
    if (frame === this.#frame) {
      return;
    }

    this.#frame = frame;

    if (frame.lava !== null) {
      this.#lava = frame.lava;
    }

    if (frame.burningCells.length === 0 && this.#lava.cells.length === 0 && this.#litTexels === 0) {
      return;
    }

    const resolution = this.#resolution;

    this.#accumulate(frame);
    blur(this.#accumulated, this.#scratch, 1, resolution);
    blur(this.#scratch, this.#accumulated, resolution, resolution);
    blur(this.#accumulated, this.#scratch, 1, resolution);
    blur(this.#scratch, this.#accumulated, resolution, resolution);
    this.#writeTexture();
  }

  dispose(): void {
    this.texture.dispose();
  }

  #accumulate(frame: BurningCells): void {
    this.#accumulated.fill(0);

    for (const [index, cell] of frame.burningCells.entries()) {
      this.#light(cell, frame.burningIntensity[index] / BYTE);
    }

    for (const [index, cell] of this.#lava.cells.entries()) {
      this.#light(cell, (this.#lava.heat[index] / BYTE) * LAVA_GLOW);
    }
  }

  #light(cell: number, amount: number): void {
    const grid = this.#grid;

    const column = Math.floor(grid.columnOf(cell) / CELLS_PER_TEXEL);
    const row = Math.floor(grid.rowOf(cell) / CELLS_PER_TEXEL);

    this.#accumulated[row * this.#resolution + column] += amount;
  }

  #writeTexture(): void {
    let litTexels = 0;

    for (const [texel, value] of this.#accumulated.entries()) {
      const byte = Math.round(Math.min(1, value / FULL_GLOW) * BYTE);

      this.#data[texel] = byte;

      if (byte > 0) {
        litTexels += 1;
      }
    }

    this.#litTexels = litTexels;
    this.texture.needsUpdate = true;
  }
}
