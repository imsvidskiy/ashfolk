import type { DetailSteps } from "../level-of-detail.ts";

export type AnimalDetailLevel = "far" | "high" | "low";

export interface AnimalDetail extends DetailSteps {
  readonly segments: number;
}

export const ANIMAL_DETAILS: Readonly<Record<AnimalDetailLevel, AnimalDetail>> = {
  far: { hasSmallParts: false, segments: 4 },
  high: { hasSmallParts: true, segments: 8 },
  low: { hasSmallParts: true, segments: 5 },
};
