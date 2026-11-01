import { float, mx_fractal_noise_float, screenCoordinate, texture, vec2, vec3, vec4 } from "three/tsl";
import {
  HalfFloatType,
  LinearFilter,
  type Node,
  NodeMaterial,
  QuadMesh,
  RenderTarget,
  RGFormat,
  type WebGPURenderer,
} from "three/webgpu";
import type { WorldGrid } from "../../world/world-grid.ts";
import { mapCoordinatesNode } from "./height-sampling.ts";

const METERS_PER_TEXEL = 2;
const WARP_CELLS = 1;

function warpOffset(point: Node<"vec2">, cellSize: number): Node<"vec2"> {
  const broadWarp = vec2(
    mx_fractal_noise_float(vec3(point.mul(0.011), 0), 3, 2, 0.5),
    mx_fractal_noise_float(vec3(point.mul(0.011), 9.3), 3, 2, 0.5)
  );

  return broadWarp.mul(cellSize * WARP_CELLS);
}

export class GroundWarp {
  readonly #grid: WorldGrid;
  readonly #target: RenderTarget;

  constructor(grid: WorldGrid, renderer: WebGPURenderer) {
    const texels = Math.ceil(grid.worldSize / METERS_PER_TEXEL);

    this.#grid = grid;
    this.#target = new RenderTarget(texels, texels, {
      depthBuffer: false,
      format: RGFormat,
      magFilter: LinearFilter,
      minFilter: LinearFilter,
      type: HalfFloatType,
    });
    this.#bake(renderer);
  }

  offsetAt(point: Node<"vec2">): Node<"vec2"> {
    return texture(this.#target.texture, mapCoordinatesNode(this.#grid, point)).level(float(0)).xy;
  }

  dispose(): void {
    this.#target.dispose();
  }

  #bake(renderer: WebGPURenderer): void {
    const { cellSize, halfSize, worldSize } = this.#grid;

    const material = new NodeMaterial();
    const previousTarget = renderer.getRenderTarget();

    const point = screenCoordinate.mul(worldSize / this.#target.width).sub(halfSize);

    material.fragmentNode = vec4(warpOffset(point, cellSize), 0, 1);
    renderer.setRenderTarget(this.#target);
    new QuadMesh(material).render(renderer);
    renderer.setRenderTarget(previousTarget);
    material.dispose();
  }
}
