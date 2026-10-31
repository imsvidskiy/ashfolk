import { describe, expect, it } from "vitest";
import type { ChronicleCategory, ChronicleEntry } from "../simulation/chronicle.ts";
import { SOUNDS } from "./sound-catalog.ts";
import { loudestStory, StorySounds } from "./story-sounds.ts";
import { createTestSoundEngine, flatGroundPoint } from "./testing/test-sound-engine.ts";

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

  it("leaves a gap between jingles but places every finished building", () => {
    const { engine, play } = createTestSoundEngine();
    const story = new StorySounds(engine, flatGroundPoint);

    story.hear([entry("era")], VIEW, 0);
    story.hear([entry("raid")], VIEW, 2);
    story.hear([entry("building", 10, 20)], VIEW, 3);
    story.hear([entry("raid")], VIEW, 4);

    expect(play.mock.calls).toEqual([
      [SOUNDS.eventEra, null],
      [SOUNDS.buildingDone, { x: 10, y: 0, z: 20 }],
      [SOUNDS.eventRaid, null],
    ]);
  });
});
