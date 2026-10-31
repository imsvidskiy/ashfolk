import {
  cameraViewMatrix,
  cos,
  Fn,
  float,
  fract,
  fwidth,
  If,
  int,
  mix,
  normalize,
  normalWorldGeometry,
  positionWorld,
  select,
  sin,
  smoothstep,
  textureLoad,
  uniformArray,
  vec3,
  vec4,
} from "three/tsl";
import { Color, type Node, SRGBColorSpace, Vector3 } from "three/webgpu";
import { CROP_KINDS, type CropKind, FENCED_CROP_OFFSET } from "../../content/crops.ts";
import { FULL_TURN } from "../../shared/math.ts";
import type { WorldGrid } from "../../world/world-grid.ts";
import { FurrowAxis, fieldSharesNode } from "./field-plan.ts";
import { cellAtNode } from "./height-sampling.ts";
import type { TerrainTextures } from "./terrain-textures.ts";

export const FURROW_SPACING = 1;

const BYTE = 255;
const SOIL_EDGE = 0.35;
const BORDER_EDGE = 2.4;
const EDGE_WOBBLE = 0.3;
const RIDGE_HEIGHT = 0.14;
const GROOVE_SHADE = 0.62;
const CREST_SHADE = 1.08;
const BORDER_WEAR = 0.55;
const CROP_COVERAGE = 0.45;

type Tint = readonly [number, number, number];

const GROWING_TINTS: Readonly<Record<CropKind, Tint>> = {
  barley: [0.4, 0.55, 0.25],
  beans: [0.3, 0.48, 0.2],
  carrots: [0.32, 0.52, 0.22],
  flax: [0.4, 0.53, 0.46],
  turnips: [0.34, 0.54, 0.26],
  wheat: [0.36, 0.52, 0.22],
};

const RIPE_TINTS: Readonly<Record<CropKind, Tint>> = {
  barley: [0.8, 0.7, 0.42],
  beans: [0.5, 0.52, 0.27],
  carrots: [0.32, 0.52, 0.22],
  flax: [0.58, 0.5, 0.32],
  turnips: [0.34, 0.54, 0.26],
  wheat: [0.78, 0.64, 0.3],
};

interface FieldGround {
  readonly color: Node<"vec3">;
  readonly normal: Node<"vec3">;
}

function tintTable(tints: Readonly<Record<CropKind, Tint>>) {
  return uniformArray<"vec3">(
    CROP_KINDS.map((kind) => {
      const color = new Color().setRGB(...tints[kind], SRGBColorSpace);

      return new Vector3(color.r, color.g, color.b);
    }),
    "vec3"
  );
}

function cropColor(code: Node<"int">, growth: Node<"float">): Node<"vec4"> {
  const growing = tintTable(GROWING_TINTS);
  const ripe = tintTable(RIPE_TINTS);

  const kind = select(code.greaterThanEqual(int(FENCED_CROP_OFFSET)), code.sub(FENCED_CROP_OFFSET), code).sub(1);
  const isBare = kind.lessThan(int(0));
  const index = select(isBare, int(0), kind);

  const color = mix(growing.element(index), ripe.element(index), smoothstep(0.78, 1, growth));
  const coverage = select(isBare, float(0), smoothstep(0.08, 0.7, growth).mul(CROP_COVERAGE));

  return vec4(color, coverage);
}

export function fieldGroundNode(
  textures: TerrainTextures,
  grid: WorldGrid,
  ground: Node<"vec3">,
  grain: Node<"vec2">
): FieldGround {
  const { earth, soil } = textures.groundAlbedo;

  const point = positionWorld.xz;
  const wobbled = point.add(grain.mul(EDGE_WOBBLE));
  const blur = fwidth(point.x)
    .add(fwidth(point.y))
    .mul(0.5 / grid.cellSize);
  const rowsAcrossX = point.x.add(grid.halfSize).div(FURROW_SPACING);
  const rowsAcrossZ = point.y.add(grid.halfSize).div(FURROW_SPACING);
  const clods = grain.x.mul(0.08).add(grain.y.mul(0.05)).add(1);

  const { axis, shares } = fieldSharesNode(textures.fields.texture, grid, wobbled, [SOIL_EDGE, BORDER_EDGE], blur);
  const cell = cellAtNode(grid, wobbled);

  const isAlongX = axis.equal(int(FurrowAxis.AlongX));

  const across = select(isAlongX, vec3(0, 0, 1), vec3(1, 0, 0));
  const rowBlur = select(isAlongX, fwidth(rowsAcrossZ), fwidth(rowsAcrossX));
  const rows = select(isAlongX, rowsAcrossZ, rowsAcrossX);

  const field = Fn(() => {
    const result = vec4(ground, 0).toVar();

    If(axis.greaterThan(int(FurrowAxis.None)), () => {
      const [tilled, reach] = shares;

      const cellGround = textureLoad(textures.groundAlbedo.cells, cell);
      const phase = fract(rows).sub(0.5).mul(FULL_TURN);
      const relief = smoothstep(0.66, 0.92, reach).mul(float(1).sub(smoothstep(0.3, 0.6, rowBlur)));
      const crop = cropColor(int(cellGround.a.mul(BYTE).add(0.5)), cellGround.g);
      const border = smoothstep(0.1, 0.42, reach).mul(float(1).sub(tilled)).mul(BORDER_WEAR);

      const crest = mix(float(0.5), cos(phase).mul(0.5).add(0.5), relief);
      const slope = sin(phase)
        .mul((Math.PI * RIDGE_HEIGHT) / FURROW_SPACING)
        .mul(relief)
        .mul(tilled);

      const shaded = soil.mul(clods).mul(mix(float(GROOVE_SHADE), float(CREST_SHADE), crest));

      const planted = mix(shaded, crop.rgb, crop.a.mul(mix(float(0.15), float(1), crest)));

      result.assign(vec4(mix(mix(ground, earth, border), planted, tilled), slope));
    });

    return result;
  })();

  const normal = normalize(normalWorldGeometry.add(across.mul(field.w)));

  return { color: field.rgb, normal: cameraViewMatrix.mul(vec4(normal, 0)).xyz };
}

export function fieldClearingNode(textures: TerrainTextures, grid: WorldGrid, point: Node<"vec2">): Node<"float"> {
  const { shares } = fieldSharesNode(textures.fields.texture, grid, point, [BORDER_EDGE], float(0));
  const [reach] = shares;

  return smoothstep(0.08, 0.3, reach);
}
