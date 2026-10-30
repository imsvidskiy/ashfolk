import { describe, expect, it } from "vitest";
import type { WorldMirror } from "../../game/world-mirror.ts";
import { HUMAN_PARTS, humanPartIndex } from "../../models/people/human-model.ts";
import { PersonField } from "../../world/agent-buffers.ts";
import { personPoseCode } from "../../world/agent-poses.ts";
import { gearCode, weaponCode } from "../../world/gear.ts";
import { agentInputAbove, createPopulatedMirror } from "../testing/agent-scene.ts";
import { TribeLooks } from "../tribe-looks.ts";
import type { AgentViewInput } from "./agent-view-input.ts";
import { PeopleView } from "./people-view.ts";

const VIEWPORT_HEIGHT = 900;

function inputFrom(mirror: WorldMirror, height: number): AgentViewInput {
  return agentInputAbove(mirror, mirror.frame.people[PersonField.X], mirror.frame.people[PersonField.Z], height);
}

function drawPeople(input: AgentViewInput): PeopleView {
  const tribes = new TribeLooks();

  tribes.remember(input.mirror.frame.tribes);

  const people = new PeopleView(tribes);

  input.markers.begin(input.camera, input.frustum, VIEWPORT_HEIGHT);
  people.update(input);
  input.markers.commit();

  return people;
}

describe("people view", () => {
  it("marks people that are too far to draw with markers", () => {
    const mirror = createPopulatedMirror();

    const input = inputFrom(mirror, 2200);

    const people = drawPeople(input);

    expect(people.figureCount).toBe(0);
    expect(input.markers.count).toBeGreaterThan(0);
  });

  it("draws nearby people as figures without markers", () => {
    const mirror = createPopulatedMirror();

    const input = inputFrom(mirror, 30);

    const people = drawPeople(input);

    expect(people.figureCount).toBeGreaterThan(0);
    expect(input.markers.count).toBe(0);
  });

  it("draws a hunter drawing a bow with a quiver on the back", () => {
    const mirror = createPopulatedMirror();

    const { people } = mirror.frame;

    people[PersonField.Pose] = personPoseCode("shoot");
    people[PersonField.Weapon] = weaponCode("bow");
    people[PersonField.Gear] = gearCode("iron");
    people[PersonField.Era] = 5;

    const view = drawPeople(inputFrom(mirror, 6));

    const highLevel = view.group.children.slice(0, HUMAN_PARTS.length);

    expect(highLevel[humanPartIndex("drawnBow")]?.visible).toBe(true);
    expect(highLevel[humanPartIndex("quiver")]?.visible).toBe(true);
  });

  it("rings the hovered person where the hand draws them, and stops once nobody is hovered", () => {
    const mirror = createPopulatedMirror();
    const input = inputFrom(mirror, 30);
    const id = mirror.frame.people[PersonField.Id];
    const held = {
      id,
      isPlaceable: true,
      kind: "person" as const,
      x: mirror.frame.people[PersonField.X] + 3,
      z: mirror.frame.people[PersonField.Z] - 2,
    };

    input.hand.update(held, 1 / 60);

    const people = drawPeople({ ...input, highlighted: { id, kind: "person" } });

    expect(people.hoveredSpot).toEqual({ x: held.x, z: held.z });

    people.update(input);

    expect(people.hoveredSpot).toBeNull();
  });
});
