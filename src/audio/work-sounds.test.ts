import { describe, expect, it } from "vitest";
import { PERSON_STRIDE, PersonField } from "../world/agent-buffers.ts";
import { type PersonPose, personPoseCode } from "../world/agent-poses.ts";
import { SOUNDS } from "./sound-catalog.ts";
import { createTestSoundEngine, flatGroundPoint } from "./testing/test-sound-engine.ts";
import { nearestWorkers, WorkSounds } from "./work-sounds.ts";

const VIEW = { focusX: 0, focusZ: 0, viewDistance: 80 };
const RENDERS_PER_SECOND = 60;
const RENDERS_PER_FRAME = 6;
const CHOP_SECONDS = 1.45;
const LISTENING_SECONDS = 10;

interface Person {
  readonly phase?: number;
  readonly pose: PersonPose;
  readonly x: number;
}

function packPeople(people: readonly Person[]): Float32Array {
  const packed = new Float32Array(people.length * PERSON_STRIDE);

  for (const [index, person] of people.entries()) {
    const offset = index * PERSON_STRIDE;

    packed[offset + PersonField.Id] = index + 1;
    packed[offset + PersonField.Phase] = person.phase === undefined ? 0 : person.phase;
    packed[offset + PersonField.Pose] = personPoseCode(person.pose);
    packed[offset + PersonField.X] = person.x;
  }

  return packed;
}

function chopsHeard(phase: number): number {
  const { engine, play } = createTestSoundEngine();
  const work = new WorkSounds(engine, flatGroundPoint);
  const people = packPeople([{ phase, pose: "chop", x: 1 }]);

  for (let render = 0; render < LISTENING_SECONDS * RENDERS_PER_SECOND; render += 1) {
    if (render % RENDERS_PER_FRAME === 0) {
      work.listen(people, 1, VIEW);
    }

    work.update(1 / RENDERS_PER_SECOND);
  }

  return play.mock.calls.length;
}

describe("work sounds", () => {
  it("listens only to people at work near the view", () => {
    const people = packPeople([
      { pose: "chop", x: 10 },
      { pose: "walk", x: 5 },
      { pose: "mine", x: 500 },
    ]);

    const workers = nearestWorkers(people, 3, VIEW);

    expect(workers).toHaveLength(1);
    expect(workers[0]?.strike.sound).toBe(SOUNDS.workChop);
  });

  it("keeps the closest few workers", () => {
    const people = packPeople(
      [40, 30, 20, 10, 5].map((x) => {
        return { pose: "build", x };
      })
    );

    const workers = nearestWorkers(people, 5, VIEW);

    expect(
      workers.map((worker) => {
        return worker.x;
      })
    ).toEqual([5, 10, 20]);
  });

  it.each([0, 0.3, 0.6, 3.2, 3.6])("strikes once a cycle while the frame phase stays at %s", (phase) => {
    const cycles = LISTENING_SECONDS / CHOP_SECONDS;

    const chops = chopsHeard(phase);

    expect(chops).toBeGreaterThanOrEqual(Math.floor(cycles));
    expect(chops).toBeLessThanOrEqual(Math.ceil(cycles));
  });
});
