import { describe, expect, it } from "vitest";
import type { ChronicleCategory, ChronicleEntry } from "../simulation/chronicle.ts";
import { SOUNDS } from "./sound-catalog.ts";
import { loudestStory } from "./story-sounds.ts";

const VIEW = { focusX: 0, focusZ: 0, viewDistance: 100 };

function entry(category: ChronicleCategory, x = 0, z = 0): ChronicleEntry {
  return { category, day: 1, id: 1, text: "", tribeId: null, x, z };
}

describe("story sounds", () => {
  it("plays the most important news of a frame", () => {
    const heard = loudestStory([entry("birth"), entry("era"), entry("raid")], VIEW);

    expect(heard?.cue.sound).toBe(SOUNDS.eventEra);
  });

  it("keeps births far from the view quiet", () => {
    expect(loudestStory([entry("birth", 2000, 0)], VIEW)).toBeNull();
  });

  it("stays silent for everyday news", () => {
    expect(loudestStory([entry("food"), entry("hunt")], VIEW)).toBeNull();
  });
});
