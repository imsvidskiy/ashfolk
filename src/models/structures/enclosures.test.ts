import { Vector3 } from "three";
import { describe, expect, it as test } from "vitest";
import { MaterialSlot } from "../materials.ts";
import { type MeshData, triangleCount } from "../mesh/mesh-data.ts";
import { outermostHit } from "../mesh/surface-probe.ts";
import { orderProblems, soundnessProblems } from "../testing/structure-checks.ts";
import { buildEnclosurePiece, ENCLOSURE_SEGMENT_LENGTH, type EnclosureKind } from "./enclosures.ts";
import type { StructureLevel } from "./structure-parts.ts";

const END_TOLERANCE = 0.02;
const LEVELS: readonly StructureLevel[] = ["high", "low"];
const ENCLOSURES: readonly EnclosureKind[] = ["palisade", "stoneWall"];

function enclosurePieces(kind: EnclosureKind, level: StructureLevel): MeshData[] {
  return [buildEnclosurePiece(kind, "gate", level), buildEnclosurePiece(kind, "segment", level)];
}

describe.each(ENCLOSURES)("%s pieces", (kind) => {
  test.each(LEVELS)("butt their %s ends at half a segment either side", (level) => {
    for (const piece of enclosurePieces(kind, level)) {
      expect(Math.abs(piece.bounds.minimum[0] + ENCLOSURE_SEGMENT_LENGTH / 2)).toBeLessThan(END_TOLERANCE);
      expect(Math.abs(piece.bounds.maximum[0] - ENCLOSURE_SEGMENT_LENGTH / 2)).toBeLessThan(END_TOLERANCE);
    }
  });

  test.each(LEVELS)("stand clean and grounded at %s detail", (level) => {
    for (const piece of enclosurePieces(kind, level)) {
      expect(soundnessProblems(piece)).toEqual([]);
      expect(orderProblems(piece)).toEqual([]);
      expect(piece.bounds.minimum[1]).toBeLessThan(0);
    }
  });

  test("keep fewer triangles far away", () => {
    for (const piece of ["gate", "segment"] as const) {
      expect(triangleCount(buildEnclosurePiece(kind, piece, "low"))).toBeLessThan(
        triangleCount(buildEnclosurePiece(kind, piece, "high"))
      );
    }
  });

  test("leave a way through the gate but not through the wall", () => {
    const gate = buildEnclosurePiece(kind, "gate", "high");
    const segment = buildEnclosurePiece(kind, "segment", "high");

    const origin = new Vector3(0, 1.1, -3);
    const ahead = new Vector3(0, 0, 1);

    expect(outermostHit(gate, origin, ahead)).toBeNull();
    expect(outermostHit(segment, origin, ahead)).not.toBeNull();
    expect(gate.channels.slot).toContain(MaterialSlot.Accent);
  });
});
