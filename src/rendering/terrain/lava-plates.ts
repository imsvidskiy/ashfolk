import {
  cos,
  dot,
  Fn,
  float,
  floor,
  fract,
  max,
  min,
  mix,
  screenCoordinate,
  sin,
  sqrt,
  texture,
  vec2,
  vec4,
} from "three/tsl";
import {
  HalfFloatType,
  LinearFilter,
  type Node,
  NodeMaterial,
  QuadMesh,
  RedFormat,
  RenderTarget,
  RepeatWrapping,
  type WebGPURenderer,
} from "three/webgpu";
import { cellKey, unitHash } from "../node-helpers.ts";

export const PLATE_FREQUENCY = 0.07;

const TILE_SIZE = 400;
const TILE_TEXELS = 2048;
const PLATE_BEND = 12;
const PLATE_BEND_FREQUENCY = 0.04;
const PLATES_PER_TILE = Math.round(TILE_SIZE * PLATE_FREQUENCY);
const BENDS_PER_TILE = Math.round(TILE_SIZE * PLATE_BEND_FREQUENCY);
const FARTHEST_PLATE = 8;
const FULL_TURN = Math.PI * 2;
const NEIGHBORS = [-1, 0, 1];
const SALT_BEND_ACROSS = 0x3c_6e_f3_72;
const SALT_BEND_ALONG = 0xa5_4f_f5_3a;
const SALT_PLATE_ACROSS = 0x51_0e_52_7f;
const SALT_PLATE_ALONG = 0x9b_05_68_8c;

function tiledNoise(point: Node<"vec2">, period: number, salt: number): Node<"float"> {
  const cell = floor(point);
  const local = fract(point);
  const fade = local
    .mul(local)
    .mul(local)
    .mul(local.mul(local.mul(6).sub(15)).add(10));

  function cornerShare(column: number, row: number): Node<"float"> {
    const corner = vec2(column, row);
    const angle = unitHash(cellKey(cell.add(corner).mod(period)), salt).mul(FULL_TURN);

    return dot(vec2(cos(angle), sin(angle)), local.sub(corner));
  }

  return mix(
    mix(cornerShare(0, 0), cornerShare(1, 0), fade.x),
    mix(cornerShare(0, 1), cornerShare(1, 1), fade.x),
    fade.y
  )
    .mul(0.5)
    .add(0.5);
}

function plateEdge(point: Node<"vec2">): Node<"float"> {
  const bendSpot = point.mul(BENDS_PER_TILE / TILE_SIZE);
  const bend = vec2(
    tiledNoise(bendSpot, BENDS_PER_TILE, SALT_BEND_ACROSS),
    tiledNoise(bendSpot, BENDS_PER_TILE, SALT_BEND_ALONG)
  );
  const spot = point.add(bend.sub(0.5).mul(PLATE_BEND)).mul(PLATES_PER_TILE / TILE_SIZE);
  const cell = floor(spot);

  return Fn(() => {
    const nearest = float(FARTHEST_PLATE).toVar();
    const second = float(FARTHEST_PLATE).toVar();

    for (const row of NEIGHBORS) {
      for (const column of NEIGHBORS) {
        const neighbor = cell.add(vec2(column, row));
        const key = cellKey(neighbor.add(PLATES_PER_TILE).mod(PLATES_PER_TILE));
        const reach = spot.sub(neighbor.add(vec2(unitHash(key, SALT_PLATE_ACROSS), unitHash(key, SALT_PLATE_ALONG))));
        const squared = dot(reach, reach);

        second.assign(min(second, max(nearest, squared)));
        nearest.assign(min(nearest, squared));
      }
    }

    return sqrt(second).sub(sqrt(nearest));
  })();
}

export class LavaPlates {
  readonly #target: RenderTarget;

  constructor(renderer: WebGPURenderer) {
    this.#target = new RenderTarget(TILE_TEXELS, TILE_TEXELS, {
      depthBuffer: false,
      format: RedFormat,
      magFilter: LinearFilter,
      minFilter: LinearFilter,
      type: HalfFloatType,
      wrapS: RepeatWrapping,
      wrapT: RepeatWrapping,
    });
    this.#bake(renderer);
  }

  edgeAt(point: Node<"vec2">): Node<"float"> {
    return texture(this.#target.texture, point.div(TILE_SIZE)).level(float(0)).r;
  }

  dispose(): void {
    this.#target.dispose();
  }

  #bake(renderer: WebGPURenderer): void {
    const material = new NodeMaterial();
    const previousTarget = renderer.getRenderTarget();

    material.fragmentNode = vec4(plateEdge(screenCoordinate.mul(TILE_SIZE / TILE_TEXELS)), 0, 0, 1);
    renderer.setRenderTarget(this.#target);
    new QuadMesh(material).render(renderer);
    renderer.setRenderTarget(previousTarget);
    material.dispose();
  }
}
