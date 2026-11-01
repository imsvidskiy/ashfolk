import {
  attribute,
  dot,
  Fn,
  float,
  int,
  ivec2,
  max,
  mix,
  normalize,
  normalLocal,
  positionLocal,
  select,
  step,
  uniformArray,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
import { SLOT_COLOR_TABLE } from "../../models/materials.ts";
import { brightenHighlighted } from "../highlight.ts";
import { type ModelShading, styleModel } from "../model-style.ts";
import { rotateAroundUp, slotColorTable } from "../node-helpers.ts";
import { markOutlined } from "../outlines.ts";
import type { AgentPalette } from "./agent-palette.ts";
import { colorIndexBySlot, colorTexel, type PaletteLayout, rootTexel, TEXELS_PER_BONE } from "./palette-layout.ts";

type BoneRows = readonly [Node<"vec4">, Node<"vec4">, Node<"vec4">];

function skin(rows: BoneRows, vector: Node<"vec4">): Node<"vec3"> {
  return vec3(dot(rows[0], vector), dot(rows[1], vector), dot(rows[2], vector));
}

export function createSkinnedMaterial(
  palette: AgentPalette,
  layout: PaletteLayout,
  shading?: ModelShading
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  const rowNumber = attribute("agentRow", "float");
  const row = int(rowNumber);
  const boneA = int(attribute("boneA", "float").add(0.5));
  const boneB = int(attribute("boneB", "float").add(0.5));
  const weight = attribute("boneWeight", "float");
  const slot = int(attribute("slot", "float").add(0.5));
  const shade = attribute("shade", "float");

  function texelAt(texel: Node<"int">): Node<"vec4"> {
    const texelLoad = palette.node.load(ivec2(texel, row));

    // three.js r186 clones a load from a node without uv coordinates with its uv matrix still applied.
    texelLoad.updateMatrix = false;

    return texelLoad;
  }

  function boneRows(bone: Node<"int">): BoneRows {
    const first = bone.mul(TEXELS_PER_BONE);

    return [texelAt(first), texelAt(first.add(1)), texelAt(first.add(2))];
  }

  const rowsA = boneRows(boneA);
  const rowsB = boneRows(boneB);
  const point = vec4(positionLocal, 1);
  const root = texelAt(int(rootTexel(layout)));

  const skinned = mix(skin(rowsA, point), skin(rowsB, point), weight);

  material.positionNode = Fn(() => {
    const direction = vec4(normalLocal, 0);

    const skinnedNormal = normalize(mix(skin(rowsA, direction), skin(rowsB, direction), weight));

    normalLocal.assign(rotateAroundUp(skinnedNormal, root.w));

    return rotateAroundUp(skinned, root.w).add(root.xyz);
  })();

  const slotColors = slotColorTable();
  const colorIndices = uniformArray<"float">(colorIndexBySlot(layout, SLOT_COLOR_TABLE.length), "float");

  const colorIndex = colorIndices.element(slot);

  const paletteColor = texelAt(int(colorTexel(layout, 0)).add(int(max(colorIndex, 0)))).xyz;

  const color = select(colorIndex.greaterThanEqual(0), paletteColor, slotColors.element(slot));

  const highlighted = varying(float(1).sub(step(0.5, rowNumber.sub(palette.highlightRow).abs())), "agentHighlight");

  material.colorNode = brightenHighlighted(varying(color.mul(shade), "agentColor"), highlighted);
  styleModel(material, shading);

  markOutlined(material);

  return material;
}
