import {
  abs,
  attribute,
  distance,
  dot,
  Fn,
  float,
  fract,
  int,
  mix,
  normalLocal,
  normalWorld,
  positionLocal,
  sin,
  smoothstep,
  step,
  textureLoad,
  time,
  uniform,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import { Color, MeshStandardNodeMaterial, type Node, type UniformNode, Vector2, type Vector3 } from "three/webgpu";
import { MaterialSlot } from "../../models/materials.ts";
import { BERRY_PART } from "../../models/plants/berries.ts";
import { clamp as clampNumber } from "../../shared/math.ts";
import type { WorldGrid } from "../../world/world-grid.ts";
import { columnVisibilityNode, fadeNearCamera, type ObjectExtent } from "../camera-fade.ts";
import { type FireGlow, fireLightAt } from "../effects/fire-glow.ts";
import { brightenHighlighted } from "../highlight.ts";
import { styleModel } from "../model-style.ts";
import { rotateAroundUp, SNOW_COLOR, slotColorTable, snowCoverNode } from "../node-helpers.ts";
import { markOutlined } from "../outlines.ts";
import { cellAtNode, coarseGroundOffsetNode } from "../terrain/height-sampling.ts";
import type { TerrainTextures } from "../terrain/terrain-textures.ts";
import { burnGlow, charredColor, plantBurn } from "./plant-burning.ts";

const CALM_GUST = 0.12;
const STRONGEST_GUST = 2;
const METERS_PER_SECOND_PER_GUST = 7;
const SLOWEST_GUST_FRONT = 1.5;
const GUST_FRONT_SPEEDUP = 2;
const CROWN_FIRE_LIGHT = 0.45;
const CROWN_BURN_SHRINK = 0.6;
const TIER_BURN_SHRINK = 0.85;
const CROWN_LEFT_FLOOR = 0.06;
const STRICTLY_ABOVE = 0.0001;
const HIGHLIGHT_MATCH = 0.05;
const FALLEN_TILT = Math.PI / 2 - 0.06;
const FALLEN_CHARRING = 0.85;

interface CrownShape {
  readonly hasTiers: boolean;
  readonly middle: number;
}

interface PlantMaterialOptions {
  readonly crown: CrownShape;
  readonly detailFade: UniformNode<"vec2", Vector2>;
  readonly fadingExtent: ObjectExtent | null;
  readonly glow: FireGlow;
  readonly grid: WorldGrid;
  readonly highlight: UniformNode<"vec3", Vector3>;
  readonly isFlammable: boolean;
  readonly look: SpeciesLook;
  readonly textures: TerrainTextures;
  readonly weather: PlantWeather;
}

export function gustAt(weather: PlantWeather, point: Node<"vec2">): Node<"float"> {
  const front = dot(point, weather.wind).sub(weather.gustTravel);
  const across = dot(point, vec2(weather.wind.y.negate(), weather.wind.x));

  const rolling = sin(front.mul(0.045).add(sin(across.mul(0.013)).mul(2.2)))
    .mul(0.5)
    .add(0.5);
  const ripple = sin(front.mul(0.19).add(across.mul(0.05)))
    .mul(0.5)
    .add(0.5);

  return rolling.mul(0.7).add(ripple.mul(0.3));
}

function slotWeight(slot: Node<"float">, value: number): Node<"float"> {
  return float(1).sub(step(0.5, abs(slot.sub(value))));
}

function burntCrown(position: Node<"vec3">, burningAway: Node<"float">, crown: CrownShape): Node<"vec3"> {
  if (crown.hasTiers) {
    const narrowing = float(1).sub(burningAway.mul(TIER_BURN_SHRINK));

    return position.mul(vec3(narrowing, 1, narrowing));
  }

  const middle = vec3(0, crown.middle, 0);

  return position
    .sub(middle)
    .mul(float(1).sub(burningAway.mul(CROWN_BURN_SHRINK)))
    .add(middle);
}

function tiltOver(vector: Node<"vec3">): Node<"vec3"> {
  const cosine = Math.cos(FALLEN_TILT);
  const sine = Math.sin(FALLEN_TILT);

  return vec3(vector.x, vector.y.mul(cosine).sub(vector.z.mul(sine)), vector.y.mul(sine).add(vector.z.mul(cosine)));
}

export function createPlantMaterial({
  crown,
  detailFade,
  fadingExtent,
  glow,
  grid,
  highlight,
  isFlammable,
  look,
  textures,
  weather,
}: PlantMaterialOptions): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  const placement = attribute("plantPlacement", "vec4");
  const appearance = attribute("plantLook", "vec4");
  const slot = attribute("slot", "float");
  const sway = attribute("sway", "float");
  const flutter = attribute("flutter", "float");
  const shade = attribute("shade", "float");
  const part = attribute("part", "float");

  const scale = appearance.x;
  const tint = appearance.y;
  const state = appearance.z;
  const fruit = appearance.w;

  const alive = float(1).sub(step(0.5, state));
  const burnt = step(0.5, state).sub(step(1.5, state));
  const fallen = step(2.5, state);
  const dead = burnt.add(fallen);
  const foliage = slotWeight(slot, MaterialSlot.Leaf).add(slotWeight(slot, MaterialSlot.Needle));
  const blossom = slotWeight(slot, MaterialSlot.Blossom);
  const berry = step(BERRY_PART, part);
  const treeThreshold = fract(tint.mul(13.7)).mul(0.9).add(0.05);
  const ripening = fract(part.add(tint));

  const cell = cellAtNode(grid, placement.xz);
  const surface = textureLoad(textures.surface, cell);

  const burn = plantBurn({
    alive,
    burnt,
    fallen,
    fire: isFlammable ? surface.a : float(0),
    foliage,
    height: positionLocal.y.mul(scale),
    scorch: isFlammable ? surface.b : float(0),
  });

  const hasCrown = float(1)
    .sub(dead)
    .add(burnt.mul(step(CROWN_LEFT_FLOOR, burn.crownLeft)));
  const hasFoliage = step(treeThreshold.add(STRICTLY_ABOVE), look.foliageCoverage).mul(hasCrown);
  const hasBerry = step(ripening.add(STRICTLY_ABOVE), fruit).mul(hasFoliage).mul(float(1).sub(dead));
  const hasPart = mix(float(1).sub(blossom.mul(dead)), hasBerry, berry);
  const keep = mix(hasPart, hasFoliage, foliage);
  const burningAway = foliage.mul(burnt).mul(float(1).sub(burn.crownLeft));

  const kept = burntCrown(positionLocal, burningAway, crown).mul(scale).mul(keep);
  const local = mix(kept, tiltOver(kept), fallen);

  const phase = placement.x.mul(0.047).add(placement.z.mul(0.031));
  const swaySquared = sway.mul(sway);

  const gusting = gustAt(weather, placement.xz)
    .mul(0.5)
    .add(0.35)
    .add(sin(time.mul(1.6).add(phase)).mul(0.12));

  const bend = swaySquared.mul(scale.mul(0.55).add(0.25)).mul(gusting.mul(weather.gust));
  const shiver = sin(time.mul(9).add(positionLocal.x.mul(3)).add(phase.mul(7)))
    .mul(flutter)
    .mul(0.04)
    .mul(weather.gust.add(0.2));

  const windOffset = vec3(weather.wind.x, 0, weather.wind.y)
    .mul(bend)
    .add(vec3(shiver, shiver.mul(0.5), shiver.negate()))
    .mul(float(1).sub(fallen));

  const ground = vec3(0, coarseGroundOffsetNode(textures, grid, placement.xz), 0);

  material.positionNode = Fn(() => {
    normalLocal.assign(rotateAroundUp(mix(normalLocal, tiltOver(normalLocal), fallen), placement.w));

    return rotateAroundUp(local, placement.w).add(windOffset).add(placement.xyz).add(ground);
  })();

  const snow = varying(snowCoverNode(surface), "plantSnow");
  const embers = varying(burn.embers, "plantEmbers");
  const flames = varying(burn.flames, "plantFlames");
  const smolder = varying(burn.smolder, "plantSmolder");
  const charring = burn.charring.add(fallen.mul(surface.b).mul(FALLEN_CHARRING));

  const slotColors = slotColorTable();
  const variation = tint.mul(0.3).add(0.85);
  const baseColor = mix(slotColors.element(int(slot.add(0.5))), look.foliageColor.rgb, foliage);
  const shaded = baseColor.mul(shade).mul(variation);

  const vertexColor = varying(charredColor(shaded, charring), "plantColor");
  const snowOnTop = snow.mul(smoothstep(0.25, 0.75, normalWorld.y));
  const fireLight = varying(fireLightAt(glow, grid, placement.xz), "plantFireLight");
  const burning = burnGlow({ detailFade, embers, flames, phase: placement.x.mul(0.37).fract().mul(6), smolder });

  const highlighted = float(1)
    .sub(step(HIGHLIGHT_MATCH, distance(placement.xz, highlight.xy)))
    .mul(highlight.z);

  material.colorNode = brightenHighlighted(
    mix(vertexColor, SNOW_COLOR, snowOnTop),
    varying(highlighted, "plantHighlight")
  );
  material.emissiveNode = vertexColor.mul(fireLight).mul(CROWN_FIRE_LIGHT).add(burning);
  styleModel(material);

  if (fadingExtent === null) {
    markOutlined(material);

    return material;
  }

  const { height, radius } = fadingExtent;
  const reach = mix(float(radius), float(Math.max(radius, height)), fallen).mul(scale);
  const top = mix(float(height), float(radius), fallen).mul(scale);

  fadeNearCamera(material, varying(columnVisibilityNode(placement.xyz.add(ground), reach, top), "plantVisibility"));

  return material;
}

export class PlantWeather {
  readonly gust = uniform(0.5);
  readonly gustTravel = uniform(0);
  readonly wind = uniform(new Vector2(1, 0));

  blow(directionX: number, directionZ: number, metersPerSecond: number, realSeconds: number): void {
    const frontSpeed = Math.max(metersPerSecond, SLOWEST_GUST_FRONT) * GUST_FRONT_SPEEDUP;

    this.gust.value = clampNumber(metersPerSecond / METERS_PER_SECOND_PER_GUST, CALM_GUST, STRONGEST_GUST);
    this.gustTravel.value += frontSpeed * realSeconds;
    this.wind.value.set(directionX, directionZ);
  }
}

export class SpeciesLook {
  readonly foliageColor = uniform(new Color(0x4e_8c_32));
  readonly foliageCoverage = uniform(1);
}
