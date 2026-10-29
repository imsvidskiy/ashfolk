import { describe, expect, it } from "vitest";
import {
  ANIMAL_STRIDE,
  AnimalField,
  GROUND_CHANNELS,
  GroundChannel,
  PERSON_STRIDE,
  PersonField,
  SURFACE_CHANNELS,
  SurfaceChannel,
} from "./agent-buffers.ts";

function fieldOffsets(fields: Readonly<Record<string, number>>): number[] {
  return Object.values(fields).toSorted((first, second) => {
    return first - second;
  });
}

function strideOffsets(stride: number): number[] {
  return Array.from({ length: stride }, (_, offset) => {
    return offset;
  });
}

describe("agent buffers", () => {
  it("give every field its own slot", () => {
    expect(fieldOffsets(PersonField)).toEqual(strideOffsets(PERSON_STRIDE));
    expect(fieldOffsets(AnimalField)).toEqual(strideOffsets(ANIMAL_STRIDE));
    expect(fieldOffsets(SurfaceChannel)).toEqual(strideOffsets(SURFACE_CHANNELS));
    expect(fieldOffsets(GroundChannel)).toEqual(strideOffsets(GROUND_CHANNELS));
  });
});
