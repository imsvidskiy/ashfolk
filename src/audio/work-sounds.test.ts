import { describe, expect, it } from "vitest";
import { PERSON_STRIDE, PersonField } from "../world/agent-buffers.ts";
import { type PersonPose, personPoseCode } from "../world/agent-poses.ts";
import { SOUNDS } from "./sound-catalog.ts";
import { nearestWorkers } from "./work-sounds.ts";

const VIEW = { focusX: 0, focusZ: 0, viewDistance: 80 };

interface Person {
  readonly pose: PersonPose;
  readonly x: number;
}

function packPeople(people: readonly Person[]): Float32Array {
  const packed = new Float32Array(people.length * PERSON_STRIDE);

  for (const [index, person] of people.entries()) {
    const offset = index * PERSON_STRIDE;

    packed[offset + PersonField.Id] = index + 1;
    packed[offset + PersonField.Pose] = personPoseCode(person.pose);
    packed[offset + PersonField.X] = person.x;
  }

  return packed;
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
});
