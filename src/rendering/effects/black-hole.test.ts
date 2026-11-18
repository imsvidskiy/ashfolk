import { Texture } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import type { BlackHoleEffect } from "../../simulation/effects.ts";
import { BlackHoleLens } from "./black-hole.ts";

const HOLE: BlackHoleEffect = { durationSeconds: 6, kind: "black-hole", radius: 140, surfaceY: 20, x: 30, z: 90 };
const SURFACE = {
  isWaterAt: (x: number) => {
    return x > HOLE.x;
  },
  surfaceAt: (x: number) => {
    return x > HOLE.x ? 20 : 14;
  },
};

describe("black hole lens", () => {
  it("opens above its surface, holds while paused, and restores the final collapse at its saved age", () => {
    const scene = new Texture();
    const active = new BlackHoleLens(HOLE, scene, SURFACE);
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

    const restored = new BlackHoleLens({ ...HOLE, elapsedSeconds: 5.6 }, scene, SURFACE);

    expect(restored.meshes[0].position.y).toBeCloseTo(position.y);
    expect(restored.meshes[0].scale.x).toBeCloseTo(scale);
    expect(restored.update(0.41)).toBe(false);
    expect(restored.meshes[0].scale.x).toBe(0);

    active.finish();
    restored.finish();
    scene.dispose();
  });

  it("sources each stream from its land or water surface only once", () => {
    const surface = { isWaterAt: vi.fn(SURFACE.isWaterAt), surfaceAt: vi.fn(SURFACE.surfaceAt) };
    const scene = new Texture();
    const active = new BlackHoleLens(HOLE, scene, surface);
    const [, debris] = active.meshes;
    const pieces = debris.geometry.getAttribute("inflowPiece");

    for (const [index, [x]] of surface.surfaceAt.mock.calls.entries()) {
      expect(pieces.getX(index)).toBeCloseTo((SURFACE.surfaceAt(x) - HOLE.surfaceY) / HOLE.radius);
      expect(pieces.getW(index)).toBe(Number(SURFACE.isWaterAt(x)));
    }

    active.update(2);
    active.update(1);
    expect(surface.surfaceAt).toHaveBeenCalledTimes(pieces.count);
    expect(surface.isWaterAt).toHaveBeenCalledTimes(pieces.count);
    expect(
      surface.surfaceAt.mock.calls.some(([x]) => {
        return SURFACE.isWaterAt(x);
      })
    ).toBe(true);
    expect(
      surface.surfaceAt.mock.calls.some(([x]) => {
        return !SURFACE.isWaterAt(x);
      })
    ).toBe(true);

    active.finish();
    scene.dispose();
  });
});
