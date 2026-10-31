import { describe, expect, it } from "vitest";
import { formIndexOf, isMonumentPiece, jitterOf, PIECE_FORMS, pieceSeed, seedOfForm } from "./monuments.ts";
import { PlantSpecies } from "./plants.ts";

const PIECES = Object.keys(PIECE_FORMS).map(Number).filter(isMonumentPiece);

describe("monument pieces", () => {
  it("read the form and the jitter back from a seed", () => {
    const seed = pieceSeed(PlantSpecies.Menhir, "broken", 0.3);

    expect(formIndexOf(PlantSpecies.Menhir, seed)).toBe(2);
    expect(jitterOf(PlantSpecies.Menhir, seed)).toBeCloseTo(0.3);
  });

  it("keep every form apart at both ends of the jitter", () => {
    for (const piece of PIECES) {
      for (const formIndex of PIECE_FORMS[piece].keys()) {
        for (const jitter of [0, 1]) {
          const seed = seedOfForm(piece, formIndex, jitter);

          expect(formIndexOf(piece, seed)).toBe(formIndex);
          expect(jitterOf(piece, seed)).toBeCloseTo(jitter);
        }
      }
    }
  });

  it("read the highest seed as the last form", () => {
    for (const piece of PIECES) {
      expect(formIndexOf(piece, 1)).toBe(PIECE_FORMS[piece].length - 1);
    }
  });
});
