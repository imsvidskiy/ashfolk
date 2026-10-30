import {
  attribute,
  color,
  equal,
  Fn,
  float,
  fract,
  int,
  mix,
  mx_noise_float,
  normalLocal,
  positionLocal,
  positionWorld,
  select,
  smoothstep,
  time,
  varying,
  vec3,
} from "three/tsl";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
import { eraDefinition } from "../../content/eras.ts";
import { MaterialSlot, SLOT_COLOR_TABLE } from "../../models/materials.ts";
import { GLOW_PART } from "../../models/structures/structure-parts.ts";
import type { WorldGrid } from "../../world/world-grid.ts";
import { fadeNearCamera } from "../camera-fade.ts";
import { rotateAroundUp, slotColorTable } from "../node-helpers.ts";
import { markOutlined } from "../outlines.ts";
import { coarseGroundOffsetNode } from "../terrain/height-sampling.ts";
import type { TerrainTextures } from "../terrain/terrain-textures.ts";

const CHARCOAL = vec3(0.04, 0.035, 0.03);
const EARTH = vec3(0.3, 0.23, 0.16);
const PLASTERED_STYLE = eraDefinition("copperAge").index;
const TILED_STYLE = eraDefinition("ironAge").index;
const STONE_FOOTING_STYLE = eraDefinition("neolithic").index;
const STONE_COURSE = 0.42;

function placedOnGround(
  local: Node<"vec3">,
  placement: Node<"vec4">,
  textures: TerrainTextures,
  grid: WorldGrid
): Node<"vec3"> {
  const ground = vec3(0, coarseGroundOffsetNode(textures, grid, placement.xz), 0);

  return Fn(() => {
    normalLocal.assign(rotateAroundUp(normalLocal, placement.w));

    return rotateAroundUp(local, placement.w).add(placement.xyz).add(ground);
  })();
}

export function createBuildingMaterial(textures: TerrainTextures, grid: WorldGrid): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  const placement = attribute("buildingPlacement", "vec4");
  const look = attribute("buildingLook", "vec4");
  const state = attribute("buildingState", "vec4");
  const buildOrder = attribute("buildOrder", "float");
  const slot = int(attribute("slot", "float").add(0.5));
  const shade = attribute("shade", "float");
  const part = int(attribute("part", "float").add(0.5));

  const progress = look.x;
  const isBuilt = buildOrder.lessThanEqual(progress.add(0.001));
  const local = positionLocal.mul(select(isBuilt, float(1), float(0)));

  material.positionNode = placedOnGround(local, placement, textures, grid);

  const slotColors = slotColorTable();
  const accent = look.yzw;
  const damage = state.x;
  const style = state.z;

  const base = select(equal(slot, int(MaterialSlot.Accent)), accent, slotColors.element(slot));

  const isPlastered = equal(slot, int(MaterialSlot.Daub)).and(style.greaterThanEqual(PLASTERED_STYLE - 0.5));
  const isTiled = equal(slot, int(MaterialSlot.Thatch)).and(style.greaterThanEqual(TILED_STYLE - 0.5));

  const plastered = select(isPlastered, mix(base, slotColors.element(int(MaterialSlot.Plaster)), 0.7), base);
  const styled = select(isTiled, slotColors.element(int(MaterialSlot.Tile)), plastered);

  material.colorNode = varying(mix(styled.mul(shade), CHARCOAL, damage.mul(0.85)), "buildingColor");

  const isGlow = equal(part, int(GLOW_PART));
  const flicker = mx_noise_float(vec3(placement.x, time.mul(4), placement.z))
    .mul(0.4)
    .add(0.8);

  const glow = select(isGlow, state.y.mul(flicker).mul(5), float(0));

  material.emissiveNode = vec3(1, 0.42, 0.12).mul(glow);
  material.roughnessNode = float(0.86);

  fadeNearCamera(material, state.w);

  return material;
}

export function createPlinthMaterial(textures: TerrainTextures, grid: WorldGrid): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  const placement = attribute("plinthPlacement", "vec4");
  const box = attribute("plinthBox", "vec4");
  const look = attribute("plinthLook", "vec4");

  const depth = look.x;
  const damage = look.y;
  const style = look.z;

  const local = vec3(
    positionLocal.x.mul(box.z).add(box.x),
    positionLocal.y.mul(depth),
    positionLocal.z.mul(box.w).add(box.y)
  );

  material.positionNode = placedOnGround(local, placement, textures, grid);

  const grain = mx_noise_float(positionWorld.mul(1.3)).mul(0.22).add(0.86);
  const mortar = smoothstep(0, 0.1, fract(positionWorld.y.div(STONE_COURSE)))
    .mul(0.45)
    .add(0.55);
  const stone = color(SLOT_COLOR_TABLE[MaterialSlot.Stone]).mul(mortar);
  const footing = select(style.greaterThanEqual(STONE_FOOTING_STYLE - 0.5), stone, EARTH);

  material.colorNode = mix(footing.mul(grain), CHARCOAL, damage.mul(0.6));
  material.roughnessNode = float(0.92);

  markOutlined(material);

  return material;
}
