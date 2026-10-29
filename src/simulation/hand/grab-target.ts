import { z } from "zod";
import { isShrubSpecies, isTreeSpecies } from "../../content/plants.ts";

export const GRABBABLE_KINDS = ["animal", "person", "plant"] as const;

export const grabTargetSchema = z.object({ id: z.number().int().nonnegative(), kind: z.enum(GRABBABLE_KINDS) });

export type GrabbableKind = (typeof GRABBABLE_KINDS)[number];

export type GrabTarget = z.output<typeof grabTargetSchema>;

export interface HeldView extends GrabTarget {
  readonly isPlaceable: boolean;
  readonly x: number;
  readonly z: number;
}

export function isTarget(target: GrabTarget | null, kind: GrabbableKind, id: number): boolean {
  return target !== null && target.kind === kind && target.id === id;
}

export function isGrabbablePlant(species: number): boolean {
  return isTreeSpecies(species) || isShrubSpecies(species);
}
