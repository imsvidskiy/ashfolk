import { describe, expect, it } from "vitest";
import { CameraAxes } from "./billboards.ts";
import { NuclearPlume } from "./nuclear-plume.ts";

function sample(plume: NuclearPlume, age: number, depth = 0) {
  plume.update(age, 100, depth);

  const { geometry } = plume.mesh;
  const placement = geometry.getAttribute("billboardPlacement");
  const look = geometry.getAttribute("billboardLook");

  return Array.from({ length: geometry.instanceCount }, (_, index) => {
    return {
      heat: look.getX(index),
      opacity: look.getZ(index),
      seed: look.getW(index),
      width: placement.getW(index),
      x: placement.getX(index),
      y: placement.getY(index),
    };
  });
}

describe("nuclear plume", () => {
  it("opens, rises from the crater floor, and sheds the column before the last ash drifts away", () => {
    const plume = new NuclearPlume(new CameraAxes());

    try {
      expect(sample(plume, 0)).toHaveLength(0);

      const fire = sample(plume, 0.5, 55);
      const column = sample(plume, 3, 55);
      const ash = sample(plume, 8.4, 55);

      expect(
        fire.some((puff) => {
          return puff.heat > 0.5;
        })
      ).toBe(true);
      expect(
        column.some((puff) => {
          return puff.y < 10;
        })
      ).toBe(true);
      expect(
        Math.max(
          ...column.map((puff) => {
            return puff.y;
          })
        )
      ).toBeGreaterThan(150);
      expect(ash.length).toBeLessThan(column.length);
      expect(ash.length).toBeGreaterThan(0);
      expect(
        ash.every((puff) => {
          return puff.heat === 0 && puff.y > 115;
        })
      ).toBe(true);
      expect(sample(plume, 9.7, 55)).toHaveLength(0);
      expect(plume.mesh.visible).toBe(false);
    } finally {
      plume.dispose();
    }
  });

  it("carries smoke upward while other billows roll down, independent of the number of rendered frames", () => {
    const plume = new NuclearPlume(new CameraAxes());

    try {
      const first = sample(plume, 3);
      const second = sample(plume, 3.6);
      const changes = second.flatMap((later) => {
        const earlier = first.find((puff) => {
          return puff.seed === later.seed;
        });

        return earlier === undefined ? [] : [later.y - earlier.y];
      });

      expect(
        changes.filter((change) => {
          return change > 8;
        }).length
      ).toBeGreaterThan(10);
      expect(
        changes.filter((change) => {
          return change < -2;
        }).length
      ).toBeGreaterThan(2);
      expect(sample(plume, 3)).toEqual(first);
    } finally {
      plume.dispose();
    }
  });
});
