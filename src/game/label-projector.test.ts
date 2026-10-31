import { describe, expect, it } from "vitest";
import { LabelProjector } from "./label-projector.ts";
import { cameraLookingAt, flatGround, VIEWPORT } from "./testing/view-fixtures.ts";

const WORLD_HALF_SIZE = 2000;
const FLAT_GROUND = { heightAt: flatGround, surfaceAt: flatGround };

function ridgeHeight(x: number, z: number): number {
  const isOnRidge = Math.abs(x) < 1000 && Math.abs(z - 150) < 40;

  return isOnRidge ? 500 : 0;
}

function wallAroundCenter(x: number, z: number): number {
  const isOutsideCenter = Math.abs(x) > 100 || Math.abs(z) > 100;

  return isOutsideCenter ? 5000 : 0;
}

describe("label projector", () => {
  it("puts the point under the screen center in the middle of the viewport", () => {
    const projector = new LabelProjector(cameraLookingAt(100, -50), FLAT_GROUND, WORLD_HALF_SIZE);

    const placement = projector.place(100, -50, 0, VIEWPORT);

    expect(placement?.left).toBeCloseTo(400, 3);
    expect(placement?.top).toBeCloseTo(300, 3);
  });

  it("raises a lifted label higher on the screen", () => {
    const projector = new LabelProjector(cameraLookingAt(0, 0), FLAT_GROUND, WORLD_HALF_SIZE);

    const ground = projector.place(0, 0, 0, VIEWPORT);
    const lifted = projector.place(0, 0, 40, VIEWPORT);

    if (ground === null || lifted === null) {
      throw new Error("Both labels should be on screen");
    }

    expect(lifted.top).toBeLessThan(ground.top);
  });

  it("hides points behind the camera", () => {
    const projector = new LabelProjector(cameraLookingAt(0, 0), FLAT_GROUND, WORLD_HALF_SIZE);

    expect(projector.place(0, 900, 0, VIEWPORT)).toBeNull();
  });

  it("hides points far outside the view", () => {
    const projector = new LabelProjector(cameraLookingAt(0, 0), FLAT_GROUND, WORLD_HALF_SIZE);

    expect(projector.place(1500, 0, 0, VIEWPORT)).toBeNull();
  });

  it("hides points behind a hill", () => {
    const projector = new LabelProjector(
      cameraLookingAt(0, 0),
      { heightAt: ridgeHeight, surfaceAt: flatGround },
      WORLD_HALF_SIZE
    );

    expect(projector.place(0, 0, 0, VIEWPORT)).toBeNull();
  });

  it("stands lake labels on the water surface", () => {
    const lake = {
      heightAt: () => {
        return -30;
      },
      surfaceAt: flatGround,
    };

    const onWater = new LabelProjector(cameraLookingAt(0, 0), lake, WORLD_HALF_SIZE).place(0, 0, 0, VIEWPORT);
    const onGround = new LabelProjector(cameraLookingAt(0, 0), FLAT_GROUND, WORLD_HALF_SIZE).place(0, 0, 0, VIEWPORT);

    expect(onWater).toEqual(onGround);
  });

  it("ignores terrain beyond the island edge", () => {
    const projector = new LabelProjector(
      cameraLookingAt(0, 0),
      { heightAt: wallAroundCenter, surfaceAt: flatGround },
      100
    );

    expect(projector.place(0, 0, 0, VIEWPORT)).not.toBeNull();
  });
});
