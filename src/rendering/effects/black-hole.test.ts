import { Texture } from "three/webgpu";
import { describe, expect, it } from "vitest";
import type { BlackHoleEffect } from "../../simulation/effects.ts";
import { BlackHoleLens } from "./black-hole.ts";

const HOLE: BlackHoleEffect = { durationSeconds: 6, kind: "black-hole", radius: 140, surfaceY: 20, x: 30, z: 90 };
describe("black hole lens", () => {
  it("opens above its surface, holds while paused, and restores the final collapse at its saved age", () => {
    const scene = new Texture();
    const active = new BlackHoleLens(HOLE, scene);
    const [lens] = active.meshes;
    const opening = lens.scale.x;

    active.update(0.8);
    expect(lens.scale.x).toBe(HOLE.radius);
    expect(lens.scale.x).toBeGreaterThan(opening);
    expect(lens.position.y).toBeGreaterThan(HOLE.surfaceY);

    active.update(4.8);
    const position = lens.position.clone();
    const scale = lens.scale.x;

    expect(scale).toBeLessThan(HOLE.radius);
    active.update(0);
    expect(lens.position.equals(position)).toBe(true);
    expect(lens.scale.x).toBe(scale);

    const restored = new BlackHoleLens({ ...HOLE, elapsedSeconds: 5.6 }, scene);

    expect(restored.meshes[0].position.y).toBeCloseTo(position.y);
    expect(restored.meshes[0].scale.x).toBeCloseTo(scale);
    expect(restored.update(0.41)).toBe(false);
    expect(restored.meshes[0].scale.x).toBe(0);

    active.finish();
    restored.finish();
    scene.dispose();
  });

  it("waits at a small visible horizon for its simulation collapse and resynchronizes arriving matter", () => {
    const scene = new Texture();
    const active = new BlackHoleLens({ ...HOLE, wellId: 1 }, scene);

    expect(active.update(8)).toBe(true);
    expect(active.meshes[0].scale.x).toBeGreaterThan(0);
    expect(active.meshes[0].scale.x).toBeLessThan(HOLE.radius * 0.25);
    active.synchronize(3);
    expect(active.age).toBe(3);
    expect(active.meshes[0].scale.x).toBe(HOLE.radius);

    active.finish();
    scene.dispose();
  });
});
