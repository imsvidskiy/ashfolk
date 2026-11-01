import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  distance,
  Fn,
  float,
  If,
  length,
  max,
  mix,
  positionLocal,
  positionWorld,
  smoothstep,
  time,
  transformNormalToView,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import { BufferGeometry, Float32BufferAttribute, MeshStandardNodeMaterial, type Node } from "three/webgpu";
import type { WorldGrid } from "../../world/world-grid.ts";
import { rotateAroundUp, unitNoise3 } from "../node-helpers.ts";
import { groundOffsetNode } from "../terrain/height-sampling.ts";
import type { TerrainTextures } from "../terrain/terrain-textures.ts";
import { fordBedColorNode } from "../water/ford-field.ts";
import { drawnWaterDepthNode } from "../water/water-material.ts";
import type { BarPoint } from "./ford-layout.ts";

export const FOAM_FIELDS = [
  { name: "foamPlacement", size: 4 },
  { name: "foamShape", size: 4 },
] as const;

const FOAM_LIFT = 0.03;
const FOAM_REACH = 1.7;
const FOAM_FAR = 220;

export function createFoamMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ depthWrite: false, transparent: true });
  const placement = attribute("foamPlacement", "vec4");
  const shape = attribute("foamShape", "vec4");

  const radius = shape.x;
  const wake = shape.y;
  const extent = radius.mul(FOAM_REACH).add(wake.mul(0.5));
  const local = positionLocal.xz.mul(extent.mul(2)).add(vec2(0, wake.mul(0.5)));

  material.positionNode = rotateAroundUp(vec3(local.x, FOAM_LIFT, local.y), placement.w).add(placement.xyz);

  const point = varying(local, "foamPoint");
  const reach = length(point);
  const facing = point.y.div(max(reach, 0.001));
  const behind = max(point.y, 0);

  const pillow = smoothstep(radius.mul(1.4), radius.mul(0.95), reach).mul(smoothstep(0.35, -0.6, facing));
  const collar = smoothstep(radius.mul(1.15), radius.mul(0.95), reach).mul(0.35);
  const wakeWidth = radius.mul(behind.div(max(wake, 0.01)).mul(0.7).add(0.65));
  const wakeBody = smoothstep(wakeWidth, wakeWidth.mul(0.2), abs(point.x))
    .mul(smoothstep(wake.add(radius), radius, behind))
    .mul(smoothstep(radius.mul(0.4), radius.mul(1.1), point.y));
  const around = max(pillow, collar);

  const foam = Fn(() => {
    const amount = float(0).toVar();

    If(around.add(wakeBody).greaterThan(0.01), () => {
      const flowing = point.mul(vec2(1, 0.45)).sub(vec2(0, time.mul(0.9)));
      const churn = unitNoise3(vec3(flowing.mul(2.2), shape.z));

      amount.assign(around.mul(smoothstep(0.3, 0.6, churn)).add(wakeBody.mul(smoothstep(0.5, 0.78, churn)).mul(0.6)));
    });

    return amount;
  })();

  const fade = smoothstep(FOAM_FAR, FOAM_FAR * 0.5, distance(positionWorld, cameraPosition));

  material.colorNode = vec3(0.9, 0.94, 0.95);
  material.roughnessNode = float(0.75);
  material.opacityNode = clamp(foam, 0, 1).mul(shape.w).mul(fade);

  return material;
}

export function sunkenBedColorNode(depth: Node<"float">): Node<"vec3"> {
  const bed = fordBedColorNode(positionWorld).mul(mix(float(1), float(0.72), smoothstep(-0.05, 0.3, depth)));

  return mix(bed, bed.mul(vec3(0.5, 0.68, 0.7)), smoothstep(0.1, 3, depth));
}

export function createBarMaterial(textures: TerrainTextures, grid: WorldGrid): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  const grounding = attribute("grounding", "float");
  const waterLevel = attribute("barWater", "float");

  material.positionNode = positionLocal.add(
    vec3(0, groundOffsetNode(textures, grid, positionLocal.xz).mul(grounding), 0)
  );
  material.maskNode = drawnWaterDepthNode(textures, grid).greaterThan(0);
  material.colorNode = sunkenBedColorNode(max(waterLevel.sub(positionWorld.y), 0));
  material.normalNode = transformNormalToView(vec3(0, 1, 0));
  material.roughnessNode = float(0.6);

  return material;
}

export function createBarGeometry(bars: readonly (readonly (readonly BarPoint[])[])[]): BufferGeometry {
  const positions: number[] = [];
  const grounding: number[] = [];
  const waterLevels: number[] = [];
  const indices: number[] = [];

  for (const bar of bars) {
    const columns = bar[0].length;

    for (const [row, points] of bar.entries()) {
      const first = positions.length / 3;

      for (const point of points) {
        positions.push(point.x, point.y, point.z);
        grounding.push(point.grounding);
        waterLevels.push(point.waterLevel);
      }

      if (row === 0) {
        continue;
      }

      for (let column = 0; column < columns - 1; column += 1) {
        const here = first + column;
        const before = here - columns;

        indices.push(before, here, before + 1, before + 1, here, here + 1);
      }
    }
  }

  const geometry = new BufferGeometry();

  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("grounding", new Float32BufferAttribute(grounding, 1));
  geometry.setAttribute("barWater", new Float32BufferAttribute(waterLevels, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return geometry;
}
