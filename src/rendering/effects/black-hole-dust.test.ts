import { uniform } from "three/tsl";
import { describe, expect, it } from "vitest";
import type { BlackHoleEffect } from "../../simulation/effects.ts";
import { createBlackHoleDust } from "./black-hole-dust.ts";

const HOLE: BlackHoleEffect = { durationSeconds: 6, kind: "black-hole", radius: 180, surfaceY: 30, x: 100, z: 10 };

function hillside(x: number, z: number): number {
  return 30 + (x - HOLE.x) * 0.4 + (z - HOLE.z) * 0.2;
}

describe("black hole dust", () => {
  it("follows the slope and shoreline while crossing the air over an inlet", () => {
    let crossings = 0;
    const outline = {
      isInside: (x: number, z: number) => {
        const shore = z > HOLE.z + HOLE.radius * 0.3 ? HOLE.x + HOLE.radius * 0.18 : HOLE.x + HOLE.radius;

        const inside = x < shore;

        if (!inside && Math.hypot(x - HOLE.x, z - HOLE.z) < HOLE.radius * 0.9) {
          crossings += 1;
        }

        return inside;
      },
    };
    const surface = {
      isWaterAt: (x: number) => {
        return x < HOLE.x;
      },
      surfaceAt: (x: number, z: number) => {
        expect(outline.isInside(x, z)).toBe(true);

        return hillside(x, z);
      },
    };
    const mesh = createBlackHoleDust({ outline, surface }, HOLE, uniform(0), uniform(1));
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

      expect(outline.isInside(x, z)).toBe(true);
      expect(ground.getX(index) * HOLE.radius + HOLE.surfaceY).toBeCloseTo(hillside(x, z), 3);
      expect(ground.getW(index)).toBe(Number(x < HOLE.x));
      spray += ground.getW(index);
      farthest = Math.max(farthest, reach);
    }

    expect(crossings).toBeGreaterThan(0);
    expect(spray).toBeGreaterThan(0);
    expect(spray).toBeLessThan(geometry.instanceCount);
    expect(farthest).toBeGreaterThan(HOLE.radius * 1.4);
    expect(mesh.position.toArray()).toEqual([HOLE.x, HOLE.surfaceY, HOLE.z]);

    mesh.geometry.dispose();
    mesh.material.dispose();
  });
});
