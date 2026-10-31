import { describe, expect, it } from "vitest";
import { ANGLES_PER_BONE, Pose, RotationAxis } from "./pose.ts";

const SECOND_PITCH = ANGLES_PER_BONE + RotationAxis.Pitch;
const SECOND_ROLL = ANGLES_PER_BONE + RotationAxis.Roll;

describe("pose", () => {
  it("blends the angles and the height between two poses", () => {
    const from = new Pose(2);
    const to = new Pose(2);
    const blended = new Pose(2);

    from.rotate(1, 0.2, 0, 0);
    to.rotate(1, 0.6, -0.4, 0);
    to.height = 0.5;
    blended.blendBetween(from, to, 0.25);

    expect(blended.angles[SECOND_PITCH]).toBeCloseTo(0.3);
    expect(blended.angles[SECOND_ROLL]).toBeCloseTo(-0.1);
    expect(blended.height).toBeCloseTo(0.125);
  });

  it("rests a blend on the body while either pose lies on it", () => {
    const standing = new Pose(1);
    const lying = new Pose(1);
    const blended = new Pose(1);

    lying.grounding = "body";

    blended.blendBetween(standing, lying, 0.1);
    expect(blended.grounding).toBe("body");

    blended.blendBetween(lying, standing, 0.9);
    expect(blended.grounding).toBe("body");

    blended.blendBetween(standing, standing, 0.5);
    expect(blended.grounding).toBe("feet");
  });
});
