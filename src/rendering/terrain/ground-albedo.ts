import {
  clamp,
  float,
  floor,
  int,
  ivec2,
  max,
  mix,
  pow,
  screenCoordinate,
  select,
  step,
  textureLoad,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  Color,
  DataTexture,
  LinearFilter,
  NearestFilter,
  type Node,
  NodeMaterial,
  type PixelFormat,
  QuadMesh,
  RenderTarget,
  RGBAFormat,
  RGFormat,
  SRGBColorSpace,
  type Texture,
  UnsignedByteType,
  Vector4,
  type WebGPURenderer,
} from "three/webgpu";
import { GROUNDS, Ground, seasonalGroundColor } from "../../content/grounds.ts";
import type { WorldMirror } from "../../game/world-mirror.ts";
import { lerp, saturate } from "../../shared/math.ts";
import { floatDataTexture } from "../data-textures.ts";

const BYTE = 255;
const COVER_REACH = 2;

interface AlbedoSources {
  readonly ground: DataTexture;
  readonly lushness: DataTexture;
  readonly palette: Vector4[];
  readonly size: number;
}

interface CellLook {
  readonly color: Node<"vec4">;
  readonly isOpen: Node<"float">;
}

function cellTexture(data: Uint8Array, size: number, format: PixelFormat): DataTexture {
  const texture = new DataTexture(data, size, size, format, UnsignedByteType);

  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;

  return texture;
}

function lushnessData(mirror: WorldMirror): Float32Array {
  const { moisture, variation } = mirror.terrain;

  const data = new Float32Array(mirror.grid.cellCount * 2);

  for (let cell = 0; cell < mirror.grid.cellCount; cell += 1) {
    const wetness = saturate(moisture[cell]);
    const lushness = lerp(1.04, 0.9, wetness) * (1 + variation[cell] * 0.09);

    data[cell * 2] = lushness;
    data[cell * 2 + 1] = lushness + wetness * 0.04;
  }

  return data;
}

function linearFromSrgb(color: Node<"vec3">): Node<"vec3"> {
  const curve = pow(color.mul(0.947_867_298_6).add(0.052_132_701_4), vec3(2.4));

  return mix(curve, color.mul(0.077_399_380_8), step(color, vec3(0.040_45)));
}

function albedoNode({ ground, lushness, palette, size }: AlbedoSources): Node<"vec4"> {
  const cell = floor(screenCoordinate);
  const colors = uniformArray<"vec4">(palette, "vec4");
  const earth = colors.element(int(Ground.Dirt));
  const last = size - 1;

  function lookAt(column: number, row: number): CellLook {
    const neighbor = ivec2(clamp(cell.add(vec2(column, row)), vec2(0, 0), vec2(last, last)));
    const cellGround = textureLoad(ground, neighbor);
    const cellLushness = textureLoad(lushness, neighbor);

    const groundIndex = int(cellGround.r.mul(BYTE).add(0.5));
    const trodden = cellGround.b;
    const seasonal = colors.element(groundIndex);

    const worn = mix(seasonal.rgb, earth.rgb, trodden);
    const color = clamp(worn.mul(vec3(cellLushness.r, cellLushness.g, cellLushness.r)), 0, 1);
    const cover = seasonal.a.mul(float(1).sub(trodden));

    return { color: vec4(color, cover), isOpen: select(groundIndex.equal(int(Ground.Farm)), float(0), float(1)) };
  }

  const own = lookAt(0, 0);

  let around: Node<"vec4"> = vec4(0);
  let weight: Node<"float"> = float(0);

  for (let row = -COVER_REACH; row <= COVER_REACH; row += 1) {
    for (let column = -COVER_REACH; column <= COVER_REACH; column += 1) {
      const neighbor = column === 0 && row === 0 ? own : lookAt(column, row);

      around = around.add(neighbor.color.mul(neighbor.isOpen));
      weight = weight.add(neighbor.isOpen);
    }
  }

  const borrowed = select(weight.greaterThan(0), around.div(max(weight, 1)), own.color);
  const result = select(own.isOpen.greaterThan(0), own.color, borrowed);
  const levels = floor(result.mul(BYTE).add(0.5)).div(BYTE);

  return vec4(linearFromSrgb(levels.rgb), levels.a);
}

export class GroundAlbedo {
  readonly earth = uniform(new Color());
  readonly soil = uniform(new Color());
  readonly #ground: DataTexture;
  readonly #lushness: DataTexture;
  readonly #material = new NodeMaterial();
  readonly #palette = GROUNDS.map(() => {
    return new Vector4();
  });
  readonly #quad = new QuadMesh(this.#material);
  readonly #target: RenderTarget;

  constructor(mirror: WorldMirror) {
    const size = mirror.grid.cellsPerSide;

    this.#ground = cellTexture(mirror.ground, size, RGBAFormat);
    this.#lushness = floatDataTexture(lushnessData(mirror), size, size, RGFormat);
    this.#target = new RenderTarget(size, size, {
      colorSpace: SRGBColorSpace,
      depthBuffer: false,
      magFilter: LinearFilter,
      minFilter: LinearFilter,
      type: UnsignedByteType,
    });
    this.#material.fragmentNode = albedoNode({
      ground: this.#ground,
      lushness: this.#lushness,
      palette: this.#palette,
      size,
    });
  }

  get cells(): DataTexture {
    return this.#ground;
  }

  get texture(): Texture {
    return this.#target.texture;
  }

  groundChanged(): void {
    this.#ground.needsUpdate = true;
  }

  paint(renderer: WebGPURenderer, season: number): void {
    const previousTarget = renderer.getRenderTarget();

    for (const [index, color] of this.#palette.entries()) {
      const [red, green, blue] = seasonalGroundColor(index, season);

      color.set(red, green, blue, GROUNDS[index].grass);
    }

    this.soil.value.setRGB(...seasonalGroundColor(Ground.Farm, season), SRGBColorSpace);
    this.earth.value.setRGB(...seasonalGroundColor(Ground.Dirt, season), SRGBColorSpace);

    renderer.setRenderTarget(this.#target);
    this.#quad.render(renderer);
    renderer.setRenderTarget(previousTarget);
  }

  dispose(): void {
    this.#target.dispose();
    this.#material.dispose();
    this.#ground.dispose();
    this.#lushness.dispose();
  }
}
