import { attribute, float, int, varying } from "three/tsl";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  Uint32BufferAttribute,
} from "three/webgpu";
import { Biome } from "../../content/biomes.ts";
import type { WorldMirror } from "../../game/world-mirror.ts";
import { MaterialSlot } from "../../models/materials.ts";
import { MeshBuilder } from "../../models/mesh/mesh-builder.ts";
import type { MeshData } from "../../models/mesh/mesh-data.ts";
import { type CaveLook, meshCaveMouth } from "../../models/structures/cave-mouth.ts";
import { clamp, FULL_TURN, lerp } from "../../shared/math.ts";
import { type CellRegion, regionsOverlap } from "../../world/change-tracking.ts";
import type { Spring } from "../../world/water.ts";
import { slotColorTable } from "../node-helpers.ts";
import { caveMouthWidth } from "./cave-outlets.ts";

const FOOTPRINT_SAMPLES = 5;
const FOOTPRINT_SHOULDER = 1.9;
const FOOTPRINT_FRONT = 1;
const FOOTPRINT_BACK = -12;
const BURY_MARGIN = 1;
const SHALLOWEST_BURY = 1.6;
const DEEPEST_BURY = 14;
const RISE_REACHES = [6, 10, 14] as const;
const LAND_REACHES = [20, 40] as const;
const LAND_SAMPLES = 8;

const COLD_BIOMES: ReadonlySet<number> = new Set([Biome.Alpine, Biome.Glacier, Biome.Tundra]);
const DRY_BIOMES: ReadonlySet<number> = new Set([Biome.Desert, Biome.Mesa]);
const WOODED_BIOMES: ReadonlySet<number> = new Set([Biome.Forest, Biome.Swamp, Biome.Taiga]);
const SHORE_BIOMES: ReadonlySet<number> = new Set([Biome.Beach, Biome.Water]);

function landBiomeNear(mirror: WorldMirror, spring: Spring): number {
  for (const reach of LAND_REACHES) {
    for (let sample = 0; sample < LAND_SAMPLES; sample += 1) {
      const angle = (sample / LAND_SAMPLES) * FULL_TURN;
      const cell = mirror.grid.cellAt(
        spring.x + Math.cos(angle) * (spring.radius + reach),
        spring.z + Math.sin(angle) * (spring.radius + reach)
      );

      if (cell >= 0 && !SHORE_BIOMES.has(mirror.terrain.biome[cell])) {
        return mirror.terrain.biome[cell];
      }
    }
  }

  return Biome.Meadow;
}

function riseBehind(mirror: WorldMirror, spring: Spring): number {
  let highest = 0;

  for (const reach of RISE_REACHES) {
    const ground = mirror.heightAt(spring.x - spring.directionX * reach, spring.z - spring.directionZ * reach);

    highest = Math.max(highest, ground - spring.level);
  }

  return highest;
}

function caveLookFor(biome: number): CaveLook {
  if (COLD_BIOMES.has(biome)) {
    return { base: MaterialSlot.Basalt, frost: 0.3, moss: 0.05 };
  }

  if (DRY_BIOMES.has(biome)) {
    return { base: MaterialSlot.Sandstone, frost: 0, moss: 0 };
  }

  return { base: MaterialSlot.Stone, frost: 0, moss: WOODED_BIOMES.has(biome) ? 0.5 : 0.25 };
}

function createSpringMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  const slot = int(attribute("slot", "float").add(0.5));
  const shade = attribute("shade", "float");

  material.colorNode = varying(slotColorTable().element(slot).mul(shade), "springColor");
  material.roughnessNode = float(0.92);

  return material;
}

function headingOf(spring: Spring): Matrix4 {
  return new Matrix4().makeRotationY(Math.atan2(spring.directionX, spring.directionZ));
}

function lowestGroundUnder(mirror: WorldMirror, spring: Spring): number {
  const reach = (caveMouthWidth(spring) / 2) * FOOTPRINT_SHOULDER + 1;

  let lowest = Number.POSITIVE_INFINITY;

  for (let across = 0; across < FOOTPRINT_SAMPLES; across += 1) {
    for (let along = 0; along < FOOTPRINT_SAMPLES; along += 1) {
      const side = lerp(-reach, reach, across / (FOOTPRINT_SAMPLES - 1));
      const ahead = lerp(FOOTPRINT_BACK, FOOTPRINT_FRONT, along / (FOOTPRINT_SAMPLES - 1));

      const x = spring.x + side * spring.directionZ + ahead * spring.directionX;
      const z = spring.z - side * spring.directionX + ahead * spring.directionZ;

      lowest = Math.min(lowest, mirror.heightAt(x, z));
    }
  }

  return lowest;
}

function groundReach(spring: Spring): number {
  return Math.max(...RISE_REACHES, -FOOTPRINT_BACK) + (caveMouthWidth(spring) / 2) * FOOTPRINT_SHOULDER + 1;
}

function addCave(builder: MeshBuilder, mirror: WorldMirror, spring: Spring, models: ModelCache): void {
  const biome = landBiomeNear(mirror, spring);
  const rise = Math.round(riseBehind(mirror, spring) * 2) / 2;
  const sinking = spring.level - lowestGroundUnder(mirror, spring) + BURY_MARGIN;
  const bury = Math.round(clamp(sinking, SHALLOWEST_BURY, DEEPEST_BURY) * 2) / 2;

  const width = caveMouthWidth(spring);
  const cave = models.model(`cave ${spring.seed} ${width} ${rise} ${bury} ${biome}`, () => {
    return meshCaveMouth({ bury, look: caveLookFor(biome), rise, seed: spring.seed, width });
  });

  const placement = new Matrix4().makeTranslation(spring.x, spring.level, spring.z).multiply(headingOf(spring));

  builder.addMesh(cave, { transform: placement });
}

export function areSpringsShapedBy(mirror: WorldMirror, region: CellRegion | null): boolean {
  if (region === null) {
    return false;
  }

  const { grid } = mirror;

  return mirror.water.springs.some((spring) => {
    return (
      spring.kind === "cave" &&
      regionsOverlap(region, grid.circleBounds(spring.x, spring.z, groundReach(spring) + grid.cellSize))
    );
  });
}

class ModelCache {
  #kept = new Map<string, MeshData>();
  #used = new Map<string, MeshData>();

  model(key: string, build: () => MeshData): MeshData {
    const known = this.#used.get(key);
    const kept = known === undefined ? this.#kept.get(key) : known;
    const model = kept === undefined ? build() : kept;

    this.#used.set(key, model);

    return model;
  }

  keepUsed(): void {
    this.#kept = this.#used;
    this.#used = new Map();
  }
}

export class SpringView {
  readonly mesh: Mesh<BufferGeometry, MeshStandardNodeMaterial>;
  readonly #models = new ModelCache();

  constructor() {
    this.mesh = new Mesh(new BufferGeometry(), createSpringMaterial());
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  rebuild(mirror: WorldMirror): void {
    const builder = new MeshBuilder();

    for (const spring of mirror.water.springs) {
      if (spring.kind === "cave") {
        addCave(builder, mirror, spring, this.#models);
      }
    }

    this.#models.keepUsed();

    const data = builder.build();
    const geometry = new BufferGeometry();

    geometry.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute("normal", new Float32BufferAttribute(data.normals, 3));
    geometry.setAttribute("slot", new Float32BufferAttribute(data.channels.slot, 1));
    geometry.setAttribute("shade", new Float32BufferAttribute(data.channels.shade, 1));
    geometry.setIndex(new Uint32BufferAttribute(data.indices, 1));

    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;
    this.mesh.visible = data.indices.length > 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
