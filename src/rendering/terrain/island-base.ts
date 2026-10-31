import {
  attribute,
  Fn,
  float,
  fwidth,
  max,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalLocal,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  vec3,
} from "three/tsl";
import { type BufferGeometry, Mesh, MeshLambertNodeMaterial, MeshStandardNodeMaterial, type Node } from "three/webgpu";
import type { WorldMirror } from "../../game/world-mirror.ts";
import type { WorldGrid } from "../../world/world-grid.ts";
import { renderedHeightNode } from "./height-sampling.ts";
import { buildIslandBaseGeometry } from "./island-base-geometry.ts";
import type { TerrainTextures } from "./terrain-textures.ts";

const CLIFF_GRAIN_OCTAVES = 4;
const UNDERSIDE_GRAIN_OCTAVES = 2;
const RIM_LIFT = 0.1;

function rockColor(plinth: number, grainOctaves: number): Node<"vec3"> {
  const grain = mx_fractal_noise_float(positionWorld.mul(0.018), grainOctaves, 2, 0.5);
  const streaks = mx_noise_float(
    vec3(positionWorld.x.mul(0.05), positionWorld.y.mul(0.004), positionWorld.z.mul(0.05))
  );
  const belowPlinth = float(plinth).sub(positionWorld.y);
  const strataFade = smoothstep(1.2, 0.4, fwidth(positionWorld.y).mul(0.11));

  const strata = sin(positionWorld.y.mul(0.11).add(grain.mul(4)))
    .mul(strataFade.mul(0.5))
    .add(0.5);

  const rock = mix(vec3(0.3, 0.28, 0.27), vec3(0.47, 0.4, 0.33), strata.mul(0.65).add(grain.mul(0.3)));
  const soil = vec3(0.32, 0.24, 0.17).mul(grain.mul(0.2).add(0.9));

  const soilBand = smoothstep(90, 0, belowPlinth).mul(smoothstep(-40, 10, belowPlinth));
  const moss = smoothstep(0.25, 0.7, grain.add(streaks.mul(0.4))).mul(smoothstep(260, 40, belowPlinth));
  const depthShade = smoothstep(1700, 0, belowPlinth).mul(0.5).add(0.5);

  const layered = mix(mix(rock, soil, soilBand.mul(0.8)), vec3(0.26, 0.34, 0.17), moss.mul(0.55));

  return layered.mul(depthShade).mul(streaks.mul(0.08).add(0.96));
}

function createCliffMaterial(textures: TerrainTextures, grid: WorldGrid, plinth: number): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  const topPoint = attribute("topPoint", "vec2");
  const cliffAmount = attribute("cliffAmount", "float");
  const outward = attribute("outward", "vec2");

  material.positionNode = Fn(() => {
    const surface = max(
      renderedHeightNode(textures, grid, topPoint),
      renderedHeightNode(textures, grid, positionLocal.xz)
    ).add(RIM_LIFT);

    normalLocal.assign(vec3(outward.x, 0, outward.y));

    return vec3(positionLocal.x, mix(positionLocal.y, surface, cliffAmount), positionLocal.z);
  })();

  material.colorNode = rockColor(plinth, CLIFF_GRAIN_OCTAVES);
  material.roughnessNode = float(0.97);

  return material;
}

function createUndersideMaterial(plinth: number): MeshLambertNodeMaterial {
  const material = new MeshLambertNodeMaterial();

  material.colorNode = rockColor(plinth, UNDERSIDE_GRAIN_OCTAVES);

  return material;
}

export class IslandBase {
  readonly mesh: Mesh<BufferGeometry, MeshStandardNodeMaterial>;
  readonly #underside: Mesh<BufferGeometry, MeshLambertNodeMaterial>;

  constructor(mirror: WorldMirror, textures: TerrainTextures, plinth: number) {
    const geometry = buildIslandBaseGeometry(mirror, textures.outline, plinth);

    this.mesh = new Mesh(geometry.cliff, createCliffMaterial(textures, mirror.grid, plinth));
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;

    this.#underside = new Mesh(geometry.underside, createUndersideMaterial(plinth));
    this.#underside.frustumCulled = false;
    this.mesh.add(this.#underside);
  }

  dispose(): void {
    for (const mesh of [this.mesh, this.#underside]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}
