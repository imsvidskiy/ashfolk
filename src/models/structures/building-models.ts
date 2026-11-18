import { BUILDING_KINDS, type BuildingKind } from "../../content/buildings.ts";
import { createRandom } from "../../shared/random.ts";
import { MeshBuilder } from "../mesh/mesh-builder.ts";
import type { MeshData } from "../mesh/mesh-data.ts";
import { addCampfire, addTotem } from "./camp-landmarks.ts";
import { addHut, addTent } from "./early-dwellings.ts";
import { addLonghouse, addStoneHouse } from "./era-dwellings.ts";
import { addForge, addGranary, addKiln, addSmelter, addWorkshop } from "./era-workplaces.ts";
import { addStorehouse } from "./storehouse-model.ts";
import { type StructureContext, type StructureLevel, scaledMesh } from "./structure-parts.ts";

export const SINGLE_MODEL_KINDS: readonly SingleModelKind[] = BUILDING_KINDS.filter(hasSingleModel);

const BUILDING_SCALES: Readonly<Partial<Record<SingleModelKind, number>>> = {
  campfire: 1.15,
  hut: 1.4,
  storehouse: 1.25,
  tent: 1.55,
  totem: 1.2,
};

const BUILDERS: Readonly<Record<SingleModelKind, (context: StructureContext) => void>> = {
  campfire: addCampfire,
  forge: addForge,
  granary: addGranary,
  hut: addHut,
  kiln: addKiln,
  longhouse: addLonghouse,
  smelter: addSmelter,
  stoneHouse: addStoneHouse,
  storehouse: addStorehouse,
  tent: addTent,
  totem: addTotem,
  workshop: addWorkshop,
};

export type SingleModelKind = Exclude<BuildingKind, "mine" | "palisade" | "stoneWall">;

function hasSingleModel(kind: BuildingKind): kind is SingleModelKind {
  return kind !== "mine" && kind !== "palisade" && kind !== "stoneWall";
}

export function buildingScale(kind: SingleModelKind): number {
  const scale = BUILDING_SCALES[kind];

  if (scale === undefined) {
    return 1;
  }

  return scale;
}

export function buildBuildingModel(kind: SingleModelKind, level: StructureLevel): MeshData {
  const builder = new MeshBuilder();

  BUILDERS[kind]({ builder, level, random: createRandom(kind.length * 31 + 7) });

  return scaledMesh(builder.build(), buildingScale(kind));
}
