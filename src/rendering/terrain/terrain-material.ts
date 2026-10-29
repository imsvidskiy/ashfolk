import {
  attribute,
  cameraPosition,
  clamp,
  dot,
  Fn,
  float,
  fwidth,
  If,
  ivec2,
  max,
  min,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalize,
  normalLocal,
  normalWorldGeometry,
  positionWorld,
  pow,
  select,
  sin,
  smoothstep,
  texture,
  textureLoad,
  time,
  transformNormalToView,
  vec2,
  vec3,
} from "three/tsl";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
import type { WorldGrid } from "../../world/world-grid.ts";
import { type FireGlow, fireLightAt } from "../effects/fire-glow.ts";
import { unitNoise } from "../node-helpers.ts";
import { fordBedColorNode } from "../water/ford-field.ts";
import { POOL_BANK, poolReachNode } from "./bog-pools.ts";
import { fieldGroundNode } from "./field-ground.ts";
import { FIREWEED, fireweedNode } from "./fireweed.ts";
import type { GroundWarp } from "./ground-warp.ts";
import { cellAtNode, mapCoordinatesNode, sampleCellsNode } from "./height-sampling.ts";
import { PATCH_CELLS } from "./terrain-patches.ts";
import type { TerrainTextures } from "./terrain-textures.ts";

const SKIRT_DROP_PER_STEP = 25;
const EDGE_SKIRT_INSET = 3;
const CHARCOAL = vec3(0.012, 0.011, 0.01);
const ASH = vec3(0.13, 0.12, 0.11);
const EMBER_DEEP = vec3(1.2, 0.24, 0.03);
const EMBER_BRIGHT = vec3(1.3, 0.42, 0.06);
const GROUND_FIRE_LIGHT = 0.6;
const STONE = vec3(0.19, 0.155, 0.12);
const DARK_STONE = 0.04;
const GRAY_STONE = 0.82;
const STRATA_FREQUENCY = 0.45;
const STRATA_CONTRAST = 0.035;
const STRATA_BEND = 6;
const STRATA_WOBBLE = 1.5;
const STRATA_LENSES = vec3(0.035, 0.12, 0.035);
const STEEP_FACE_SHADE = 0.82;
const EMBER_THRESHOLD = 0.004;
const TRODDEN_EARTH = vec3(0.3, 0.22, 0.14);
const FORD_BED_DEPTH = 0.6;
const POOL_WATER = vec3(0.034, 0.038, 0.022);
const POOL_SCUM = vec3(0.11, 0.14, 0.04);
const POOL_RIM = 0.45;
const POOL_SHORE = 0.04;
const POOL_WOBBLE = 0.2;
const MARSH_MUD = 0.62;
const POOL_ROUGHNESS = 0.1;
const MARSH_ROUGHNESS = 0.72;

interface Marsh {
  readonly pool: Node<"float">;
  readonly soak: Node<"float">;
}

interface TerrainMaterialOptions {
  readonly glow: FireGlow;
  readonly grid: WorldGrid;
  readonly plinth: number;
  readonly shouldCutAtCoast: boolean;
  readonly textures: TerrainTextures;
  readonly warp: GroundWarp;
}

function marshAt(textures: TerrainTextures, grid: WorldGrid, wobble: Node<"float">): Marsh {
  const wetland = texture(textures.wetland, mapCoordinatesNode(grid, positionWorld.xz));
  const bank = float(1).sub(wobble).mul(POOL_WOBBLE).add(POOL_BANK);

  return {
    pool: smoothstep(bank, bank.add(POOL_SHORE), poolReachNode(textures, grid, positionWorld.xz)),
    soak: wetland.r.mul(smoothstep(0.1, 0.6, wetland.g).mul(0.6).add(0.4)),
  };
}

function marshGround(ground: Node<"vec3">, marsh: Marsh, mottle: Node<"float">): Node<"vec3"> {
  const mud = ground.mul(mix(float(1), float(MARSH_MUD), marsh.soak.mul(smoothstep(-0.4, 0.4, mottle))));
  const rim = mud.mul(mix(float(1), float(POOL_RIM), smoothstep(0, 0.4, marsh.pool)));
  const water = mix(POOL_WATER, POOL_SCUM, smoothstep(0.35, 0.85, mottle).mul(0.6));

  return mix(rim, water, smoothstep(0.35, 1, marsh.pool));
}

function poolGlint(textures: TerrainTextures, pool: Node<"float">): Node<"vec3"> {
  const toCamera = normalize(cameraPosition.sub(positionWorld));
  const fresnel = pow(float(1).sub(max(dot(vec3(0, 1, 0), toCamera), 0)), 5)
    .mul(0.6)
    .add(0.035);

  return textures.skyColor.mul(fresnel).mul(textures.daylight.mul(0.5).add(0.03)).mul(pool);
}

function burningGlow(fire: Node<"float">, point: Node<"vec2">, grain: Node<"float">): Node<"vec3"> {
  const flicker = unitNoise(point.mul(0.35).add(vec2(time.mul(1.3), time.mul(-0.9))))
    .mul(0.4)
    .add(0.6);
  const embers = smoothstep(0.35, 0.8, unitNoise(point.mul(0.6)).mul(0.6).add(grain.mul(0.4)));

  const smolder = smoothstep(0.02, 0.35, fire).mul(embers.mul(1.1).add(0.08)).mul(flicker);
  const blaze = fire.mul(fire).mul(embers.mul(0.8).add(0.2));

  return EMBER_DEEP.mul(smolder).add(EMBER_BRIGHT.mul(blaze));
}

function emberGlow(fire: Node<"float">, point: Node<"vec2">, grain: Node<"float">): Node<"vec3"> {
  return Fn(() => {
    const glow = vec3(0).toVar();

    If(fire.greaterThan(EMBER_THRESHOLD), () => {
      glow.assign(burningGlow(fire, point, grain));
    });

    return glow;
  })();
}

function edgeSide(coordinate: Node<"float">, lastCell: number): Node<"float"> {
  return select(
    coordinate.lessThan(0.5),
    float(-1),
    select(coordinate.greaterThan(lastCell - 0.5), float(1), float(0))
  );
}

function terrainPosition(textures: TerrainTextures, grid: WorldGrid, plinth: number): Node<"vec3"> {
  const cellSize = float(grid.cellSize);
  const halfSize = float(grid.halfSize);
  const lastCell = grid.cellsPerSide - 1;

  const origin = attribute("origin", "vec2");
  const localCell = attribute("cell", "vec2");
  const isCenter = attribute("quadCenter", "float").greaterThan(0.5);
  const step = attribute("patchStep", "float");
  const skirt = attribute("skirt", "float");
  const skirtAxis = attribute("skirtAxis", "float");

  function heightAt(cell: Node<"vec2">, column: number, row: number): Node<"float"> {
    return textureLoad(textures.height, ivec2(clamp(cell.add(vec2(column, row)), vec2(0, 0), vec2(lastCell, lastCell))))
      .x;
  }

  function slopeAt(cell: Node<"vec2">): Node<"vec3"> {
    const slopeX = heightAt(cell, -1, 0).sub(heightAt(cell, 1, 0));
    const slopeZ = heightAt(cell, 0, -1).sub(heightAt(cell, 0, 1));

    return normalize(vec3(slopeX, cellSize.mul(2), slopeZ));
  }

  function cornerOf(cell: Node<"vec2">, column: number, row: number): Node<"vec2"> {
    return clamp(cell.add(vec2(column, row).mul(step)), vec2(0, 0), vec2(lastCell, lastCell));
  }

  return Fn(() => {
    const cell = clamp(origin.add(localCell), vec2(0, 0), vec2(lastCell, lastCell)).toVar();
    const height = heightAt(cell, 0, 0).toVar();
    const normal = slopeAt(cell).toVar();

    If(isCenter, () => {
      const [first, right, below, diagonal] = [
        cornerOf(cell, 0, 0),
        cornerOf(cell, 1, 0),
        cornerOf(cell, 0, 1),
        cornerOf(cell, 1, 1),
      ];

      height.assign(
        heightAt(first, 0, 0)
          .add(heightAt(right, 0, 0))
          .add(heightAt(below, 0, 0))
          .add(heightAt(diagonal, 0, 0))
          .mul(0.25)
      );
      normal.assign(slopeAt(first).add(slopeAt(right)).add(slopeAt(below)).add(slopeAt(diagonal)));
      cell.assign(first.add(diagonal).mul(0.5));
    });

    normalLocal.assign(normalize(normal));

    const border = origin.add(localCell);
    const hangs = skirt.greaterThan(0).and(mix(border.x, border.y, skirtAxis).mod(PATCH_CELLS).equal(0));
    const drop = select(hangs, skirt.mul(SKIRT_DROP_PER_STEP), float(0));
    const outward = vec2(edgeSide(cell.x, lastCell), edgeSide(cell.y, lastCell));
    const inset = outward.mul(select(hangs, float(EDGE_SKIRT_INSET), float(0)));

    return vec3(
      cell.x.add(0.5).mul(cellSize).sub(halfSize).sub(inset.x),
      max(height.sub(drop), min(height, plinth)),
      cell.y.add(0.5).mul(cellSize).sub(halfSize).sub(inset.y)
    );
  })();
}

function warpedMapCoordinates(warp: GroundWarp, grid: WorldGrid): Node<"vec2"> {
  const point = positionWorld.xz;

  return mapCoordinatesNode(grid, point.add(warp.offsetAt(point)));
}

function underwaterDepth(textures: TerrainTextures, grid: WorldGrid): Node<"float"> {
  const cell = cellAtNode(grid, positionWorld.xz);
  const reach = textureLoad(textures.shore, cell).w;

  return Fn(() => {
    const depth = float(0).toVar();

    If(reach.lessThan(1.5), () => {
      depth.assign(max(sampleCellsNode(textures.shore, grid, positionWorld.xz).x, 0));
    });

    return depth;
  })();
}

function fordGround(ground: Node<"vec3">, marks: Node<"vec2">, rock: Node<"float">): Node<"vec3"> {
  return Fn(() => {
    const color = ground.toVar();

    If(marks.x.add(marks.y).greaterThan(0.001), () => {
      const patches = mx_noise_float(positionWorld.mul(0.21));
      const trodden = mix(ground, TRODDEN_EARTH.mul(patches.mul(0.15).add(1)), marks.y.mul(0.8));

      color.assign(mix(trodden, fordBedColorNode(positionWorld), marks.x.mul(float(1).sub(rock))));
    });

    return color;
  })();
}

export function createTerrainMaterial({
  glow,
  grid,
  plinth,
  shouldCutAtCoast,
  textures,
  warp,
}: TerrainMaterialOptions): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();

  material.positionNode = terrainPosition(textures, grid, plinth);

  if (shouldCutAtCoast) {
    material.maskNode = textures.outline.insideNode(positionWorld.xz);
  }

  const mapCoordinates = warpedMapCoordinates(warp, grid);
  const broad = mx_fractal_noise_float(positionWorld.mul(0.012), 3, 2, 0.5);
  const patches = mx_noise_float(positionWorld.mul(0.07));
  const fine = mx_noise_float(positionWorld.mul(0.42));
  const steepness = float(1).sub(normalWorldGeometry.y);
  const strataFade = smoothstep(1.2, 0.4, fwidth(positionWorld.y).mul(0.32));

  const surface = texture(textures.surface, mapCoordinates);
  const albedo = texture(textures.groundAlbedo.texture, mapCoordinates).rgb;
  const layer = positionWorld.y.mul(STRATA_FREQUENCY).add(broad.mul(STRATA_BEND)).add(patches.mul(STRATA_WOBBLE));
  const bands = sin(layer)
    .mul(0.6)
    .add(sin(layer.mul(2.37).add(1.7)).mul(0.4));
  const lenses = smoothstep(0.05, 0.45, mx_noise_float(positionWorld.mul(STRATA_LENSES)));
  const strata = bands.mul(lenses).mul(strataFade.mul(STRATA_CONTRAST)).add(1);

  const depth = underwaterDepth(textures, grid);
  const snowCover = smoothstep(0.08, 0.42, surface.r);
  const field = fieldGroundNode(
    textures,
    grid,
    albedo.mul(broad.mul(0.1).add(patches.mul(0.07)).add(fine.mul(0.035)).add(1)),
    vec2(fine, patches)
  );
  const mottled = field.color;
  const redStone = smoothstep(0.6, 0.45, albedo.g.div(max(albedo.r, 0.001)));
  const darkStone = smoothstep(DARK_STONE, DARK_STONE * 0.5, albedo.r).mul(
    smoothstep(GRAY_STONE - 0.1, GRAY_STONE, albedo.b.div(max(albedo.g, 0.001)))
  );
  const faceShade = mix(float(1), float(STEEP_FACE_SHADE), smoothstep(0.3, 0.7, steepness));
  const rockColor = mix(STONE, albedo.mul(0.85), max(redStone, darkStone))
    .mul(strata)
    .mul(broad.mul(0.06).add(patches.mul(0.04)).add(1))
    .mul(faceShade);

  const rockStart = mix(float(0.24), float(0.16), snowCover);
  const rockBand = mix(float(0.07), float(0.14), snowCover);
  const edgeGrain = fine.mul(float(0.025).mul(float(1).sub(snowCover)));
  const rock = smoothstep(rockStart, rockStart.add(rockBand), steepness.add(broad.mul(0.07)).add(edgeGrain));
  const ground = mix(mottled, rockColor, rock);

  const marsh = marshAt(textures, grid, patches.mul(0.35).add(fine.mul(0.15)).add(0.5));
  const openPool = marsh.pool.mul(float(1).sub(snowCover));
  const marshy = marshGround(ground, marsh, patches.mul(0.6).add(fine.mul(0.4)));

  const fordMarks = textures.fords.marksNode(positionWorld.xz);
  const forded = fordGround(marshy, fordMarks, rock);

  const snowy = mix(forded, vec3(0.9, 0.93, 0.97), snowCover.mul(float(1).sub(rock.mul(0.6))));
  const wetness = max(surface.g, smoothstep(0, 0.6, depth));
  const damp = snowy.mul(float(1).sub(wetness.mul(0.32)));
  const shallowDepth = mix(depth, min(depth, FORD_BED_DEPTH), fordMarks.x);
  const underwater = mix(damp, damp.mul(vec3(0.5, 0.68, 0.7)), smoothstep(0.1, 3, shallowDepth));

  const ash = mix(CHARCOAL, ASH, smoothstep(0.5, 0.85, patches.mul(0.35).add(fine.mul(0.15)).add(0.5)));
  const scorched = mix(underwater, ash, surface.b.mul(0.95));
  const petals = smoothstep(0.55, 0.85, fine.mul(0.65).add(patches.mul(0.35)).add(0.5));
  const flowering = mix(scorched, FIREWEED, fireweedNode(surface.b, textures.bloom).mul(petals).mul(0.42));

  const lava = textures.lava.look(flowering, mapCoordinates, positionWorld.xz);
  const fireLight = fireLightAt(glow, grid, positionWorld.xz);
  const roughness = mix(mix(float(0.95), float(MARSH_ROUGHNESS), marsh.soak), float(0.5), wetness);

  material.colorNode = lava.color;
  material.roughnessNode = mix(roughness, float(POOL_ROUGHNESS), openPool);
  material.normalNode = normalize(mix(field.normal, transformNormalToView(vec3(0, 1, 0)), openPool));
  material.emissiveNode = emberGlow(surface.a, positionWorld.xz, fine.mul(0.5).add(0.5))
    .add(lava.glow)
    .add(lava.color.mul(fireLight).mul(GROUND_FIRE_LIGHT))
    .add(poolGlint(textures, openPool));

  return material;
}
