import { Matrix4, Vector3 } from "three/webgpu";
import { describe, expect, it } from "vitest";
import type { BlackHoleInflowEffect } from "../../simulation/effects.ts";
import { BlackHoleDebris } from "./black-hole-debris.ts";

const INFLOW: BlackHoleInflowEffect = {
  durationSeconds: 1.2,
  holeDuration: 6,
  kind: "black-hole-inflow",
  radius: 180,
  sources: [{ isFallen: false, material: "conifer", rotation: 0.2, size: 20, x: 78, y: 57, z: 102 }],
  startedAt: 2.4,
  surfaceY: 82,
  wellId: 3,
  x: 54,
  z: 68,
};

describe("black hole debris", () => {
  it("starts the trunk and crown at their sampled terrain, then lifts, tumbles, and stretches them into the horizon", () => {
    const debris = new BlackHoleDebris(INFLOW);
    const [trunk, crowns] = debris.meshes;
    const matrix = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3();

    expect(trunk.count).toBe(1);
    expect(crowns.count).toBe(2);
    trunk.getMatrixAt(0, matrix);
    position.setFromMatrixPosition(matrix).add(trunk.position);

    expect(position.x).toBeCloseTo(78);
    expect(position.y).toBeCloseTo(57 + 20 * 0.37);
    expect(position.z).toBeCloseTo(102);

    debris.update(0.7);
    trunk.getMatrixAt(0, matrix);
    position.setFromMatrixPosition(matrix).add(trunk.position);
    scale.setFromMatrixScale(matrix);
    expect(position.y).toBeGreaterThan(100);
    expect(position.x).toBeLessThan(INFLOW.x);
    expect(scale.y).toBeGreaterThan(20 * 0.73);

    const restored = new BlackHoleDebris({ ...INFLOW, elapsedSeconds: 0.7 });

    restored.update(0);
    expect(restored.meshes[0].instanceMatrix.array).toEqual(trunk.instanceMatrix.array);

    expect(debris.update(0.5)).toBe(false);
    trunk.getMatrixAt(0, matrix);
    position.setFromMatrixPosition(matrix).add(trunk.position);
    expect(position.x).toBeCloseTo(INFLOW.x);
    expect(position.z).toBeCloseTo(INFLOW.z);
    expect(Math.hypot(...scale.setFromMatrixScale(matrix))).toBe(0);

    debris.finish();
    restored.finish();
  });
});
