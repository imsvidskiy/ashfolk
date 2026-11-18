import { uniform } from "three/tsl";
import { describe, expect, it, vi } from "vitest";
import type { BlackHoleEffect } from "../../simulation/effects.ts";
import { createBlackHoleDust } from "./black-hole-dust.ts";

const HOLE: BlackHoleEffect = { durationSeconds: 6, kind: "black-hole", radius: 180, surfaceY: 30, x: 100, z: 10 };

function hillside(x: number, z: number): number {
  return 30 + (x - HOLE.x) * 0.4 + (z - HOLE.z) * 0.2;
}

describe("black hole dust", () => {
  it("takes off on the local slope and switches to spray at water sources", () => {
    const surface = {
      heightAt: hillside,
      isWaterAt: (x: number) => {
        return x < HOLE.x;
      },
      surfaceAt: vi.fn(hillside),
    };
    const mesh = createBlackHoleDust(surface, HOLE, uniform(0), uniform(1));
    const { geometry } = mesh;
    const routes = geometry.getAttribute("dustRoute");
    const ground = geometry.getAttribute("dustGround");
    let spray = 0;
    let farthest = 0;

    for (let index = 0; index < geometry.instanceCount; index += 1) {
      const angle = routes.getX(index);
      const reach = routes.getY(index) * HOLE.radius;
      const x = HOLE.x + reach * Math.cos(angle);
      const z = HOLE.z + reach * Math.sin(angle);

      expect(ground.getX(index) * HOLE.radius + HOLE.surfaceY).toBeCloseTo(hillside(x, z), 3);
      expect(ground.getW(index)).toBe(Number(x < HOLE.x));
      spray += ground.getW(index);
      farthest = Math.max(farthest, reach);
    }

    expect(spray).toBeGreaterThan(0);
    expect(spray).toBeLessThan(geometry.instanceCount);
    expect(farthest).toBeGreaterThan(HOLE.radius * 1.4);
    expect(mesh.position.toArray()).toEqual([HOLE.x, HOLE.surfaceY, HOLE.z]);

    mesh.geometry.dispose();
    mesh.material.dispose();
  });
});
