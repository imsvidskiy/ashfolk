import {
  abs,
  clamp,
  Fn,
  float,
  floor,
  fwidth,
  If,
  int,
  ivec2,
  max,
  mix,
  pow,
  screenCoordinate,
  select,
  smoothstep,
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
  type DataTexture,
  LinearFilter,
  type Node,
  NodeMaterial,
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
import { DEPOSIT_KINDS, DEPOSITS } from "../../content/deposits.ts";
import { GROUNDS, Ground, seasonalGroundColor } from "../../content/grounds.ts";
import type { WorldMirror } from "../../game/world-mirror.ts";
import { lerp, saturate } from "../../shared/math.ts";
import { cellByteTexture, floatDataTexture } from "../data-textures.ts";
import { cornersAt } from "./height-sampling.ts";

const BYTE = 255;
const COVER_REACH = 2;
const SHARPEST_BORDER = 0.06;
const SOFT_BORDER = 0.5;
const SOFT_GROUND_BORDER = 0.2;
const LONE_CORNER_WEIGHT = 0.001;
const SOFT_GROUNDS = DEPOSIT_KINDS.map((kind) => {
  return DEPOSITS[kind].ground;
});

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

function lushnessData(mirror: WorldMirror): Float32Array {
  const { moisture, variation } = mirror.terrain;

  const data = new Float32Array(mirror.grid.cellCount * 2);

  for (let cell = 0; cell < mirror.grid.cellCount; cell += 1) {
    const wetness = saturate(moisture[cell]);
    const lushness = lerp(1.02, 0.95, wetness) * (1 + variation[cell] * 0.04);

    data[cell * 2] = lushness;
    data[cell * 2 + 1] = lushness + wetness * 0.02;
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

function isGroundNode(kind: Node<"float">, ground: number): Node<"bool"> {
  return abs(kind.mul(BYTE).sub(ground)).lessThan(0.5);
}

function isSoftNode(kind: Node<"float">): Node<"bool"> {
  return SOFT_GROUNDS.map((ground) => {
    return isGroundNode(kind, ground);
  }).reduce((either, other) => {
    return either.or(other);
  });
}

function crispGroundNode(
  cells: DataTexture,
  albedo: Texture,
  coordinates: Node<"vec2">,
  blended: Node<"vec3">
): Node<"vec3"> {
  const size = cells.image.width;
  const cellCoordinate = coordinates.mul(size);
  const border = max(fwidth(cellCoordinate.x).add(fwidth(cellCoordinate.y)).mul(0.5), SHARPEST_BORDER);

  return Fn(() => {
    const color = blended.toVar();

    If(border.lessThan(SOFT_BORDER), () => {
      const corners = cornersAt(size, coordinates).map((corner) => {
        const kind = textureLoad(cells, corner.cell).r;

        return { ...corner, color: textureLoad(albedo, corner.cell).rgb, isSoft: isSoftNode(kind), kind };
      });
      const hasSoft = corners
        .map((corner) => {
          return corner.isSoft;
        })
        .reduce((either, other) => {
          return either.or(other);
        });
      const edge = select(hasSoft, max(border, SOFT_GROUND_BORDER), border);

      let sum: Node<"vec3"> = vec3(0);
      let total: Node<"float"> = float(0);

      for (const corner of corners) {
        let share: Node<"float"> = float(0);

        for (const other of corners) {
          const isAlike = abs(other.kind.sub(corner.kind)).lessThan(0.5 / BYTE);

          share = share.add(select(isAlike, other.weight, float(0)));
        }

        const focus = corner.weight.mul(
          smoothstep(float(0.5).sub(edge), float(0.5).add(edge), share).add(LONE_CORNER_WEIGHT)
        );

        sum = sum.add(corner.color.mul(focus));
        total = total.add(focus);
      }

      color.assign(sum.div(total));
    });

    return color;
  })();
}

export class GroundAlbedo {
  readonly earth = uniform(new Color());
  readonly rock = uniform(new Color());
  readonly sand = uniform(new Color());
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

    this.#ground = cellByteTexture(mirror.ground, size, RGBAFormat);
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

  crispColorNode(coordinates: Node<"vec2">, blended: Node<"vec3">): Node<"vec3"> {
    return crispGroundNode(this.#ground, this.#target.texture, coordinates, blended);
  }

  groundChanged(): void {
    this.#ground.needsUpdate = true;
  }

  paint(renderer: WebGPURenderer, season: number): void {
    const previousTarget = renderer.getRenderTarget();

    for (const [index, color] of this.#palette.entries()) {
      const [red, green, blue] = seasonalGroundColor(index === Ground.Snow ? Ground.Rock : index, season);

      color.set(red, green, blue, GROUNDS[index].grass);
    }

    this.soil.value.setRGB(...seasonalGroundColor(Ground.Farm, season), SRGBColorSpace);
    this.earth.value.setRGB(...seasonalGroundColor(Ground.Dirt, season), SRGBColorSpace);
    this.rock.value.setRGB(...seasonalGroundColor(Ground.Rock, season), SRGBColorSpace);
    this.sand.value.setRGB(...seasonalGroundColor(Ground.Sand, season), SRGBColorSpace);

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
