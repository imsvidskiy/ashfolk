import type { TechnologyId } from "./technologies.ts";

const ERA_IDS = ["wanderers", "stoneAge", "neolithic", "copperAge", "bronzeAge", "ironAge"] as const;

type EraId = (typeof ERA_IDS)[number];

interface EraDefinition {
  id: EraId;
  index: number;
  name: string;
  unlockedBy: TechnologyId | null;
}

const ERA_LIST: readonly Omit<EraDefinition, "index">[] = [
  {
    id: "wanderers",
    name: "Wanderers",
    unlockedBy: null,
  },
  {
    id: "stoneAge",
    name: "Stone Age",
    unlockedBy: "fire",
  },
  {
    id: "neolithic",
    name: "Neolithic",
    unlockedBy: "farming",
  },
  {
    id: "copperAge",
    name: "Copper Age",
    unlockedBy: "copper",
  },
  {
    id: "bronzeAge",
    name: "Bronze Age",
    unlockedBy: "bronze",
  },
  {
    id: "ironAge",
    name: "Iron Age",
    unlockedBy: "iron",
  },
];

export const ERAS: readonly EraDefinition[] = ERA_LIST.map((era, index) => {
  return { ...era, index };
});

export const ERA_COUNT = ERAS.length;

export function eraDefinition(id: EraId): EraDefinition {
  const definition = ERAS.find((era) => {
    return era.id === id;
  });

  if (definition === undefined) {
    throw new RangeError(`Unknown era ${id}`);
  }

  return definition;
}

export function currentEra(known: ReadonlySet<TechnologyId>): EraDefinition {
  let [era] = ERAS;

  for (const candidate of ERAS) {
    if (candidate.unlockedBy === null || known.has(candidate.unlockedBy)) {
      era = candidate;
    }
  }

  return era;
}

export function nextEra(era: EraDefinition): EraDefinition | null {
  const following = ERAS[era.index + 1];

  if (following === undefined) {
    return null;
  }

  return following;
}
