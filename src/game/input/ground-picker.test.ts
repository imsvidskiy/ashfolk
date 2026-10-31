import { describe, expect, it } from "vitest";
import { CENTER, cameraLookingAt, flatGround, VIEWPORT } from "../testing/view-fixtures.ts";
import { GroundPicker } from "./ground-picker.ts";

describe("ground picker", () => {
  it("finds the point under the screen center on flat ground", () => {
    const picker = new GroundPicker(cameraLookingAt(100, -50), flatGround, 2000);

    const hit = picker.pick(CENTER, VIEWPORT);

    expect(hit?.x).toBeCloseTo(100, 0);
    expect(hit?.z).toBeCloseTo(-50, 0);
  });

  it("lands on the slope of uneven ground", () => {
    function heightAt(x: number): number {
      return x * 0.2;
    }

    const picker = new GroundPicker(cameraLookingAt(0, 0), heightAt, 2000);

    const hit = picker.pick(CENTER, VIEWPORT);

    if (hit === null) {
      throw new Error("The ray should hit the slope");
    }

    expect(hit.y).toBeCloseTo(heightAt(hit.x), 3);
  });

  it("misses when the ray leaves the island", () => {
    const picker = new GroundPicker(cameraLookingAt(0, 0), flatGround, 50);

    expect(picker.pick({ x: 0, y: 0 }, VIEWPORT)).toBeNull();
  });
});
