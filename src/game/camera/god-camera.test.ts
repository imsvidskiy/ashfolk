import { PerspectiveCamera } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { GodCamera, type GroundPoint } from "./god-camera.ts";

const HALF_SIZE = 2560;
const REACH = 10_000;

function flatGround(): number {
  return 0;
}

function createCamera(heightAt: (x: number, z: number) => number = flatGround): GodCamera {
  return new GodCamera(new PerspectiveCamera(50, 1.6, 1, 50_000), heightAt, HALF_SIZE);
}

function settle(camera: GodCamera): void {
  for (let step = 0; step < 600; step += 1) {
    camera.update(0.05);
  }
}

function panDistance(pitch: number): number {
  const camera = createCamera();

  camera.jumpTo({ distance: 1000, pitch, targetX: 0, targetZ: 0, yaw: 0 });
  camera.pan(0, 40, 900);
  settle(camera);

  return Math.abs(camera.state.targetZ);
}

describe("god camera", () => {
  it("keeps the view within the island and its distance and pitch limits", () => {
    const camera = createCamera();

    camera.jumpTo({ distance: 1e9, pitch: 3, targetX: 1e9, targetZ: -1e9 });

    expect(camera.state).toMatchObject({ distance: HALF_SIZE * 3.5, pitch: 1.48 });
    expect(camera.state.targetX).toBeCloseTo(HALF_SIZE * 1.05);
    expect(camera.state.targetZ).toBeCloseTo(-HALF_SIZE * 1.05);

    camera.jumpTo({ distance: 0, pitch: -1 });

    expect(camera.state).toMatchObject({ distance: 4, pitch: 0.08 });
  });

  it("zooms toward the ground under the pointer", () => {
    const camera = createCamera();

    camera.jumpTo({ distance: 1000, targetX: 0, targetZ: 0 });
    camera.zoom(0.5, { x: 400, z: -200 });
    settle(camera);

    expect(camera.state.distance).toBeCloseTo(500);
    expect(camera.state.targetX).toBeCloseTo(200);
    expect(camera.state.targetZ).toBeCloseTo(-100);
  });

  it("pans farther across the ground in a low view than from above", () => {
    expect(panDistance(0.2)).toBeGreaterThan(panDistance(1.4) * 1.5);
  });

  it("lifts the eye over higher ground behind it", () => {
    const camera = createCamera((_x, z) => {
      return z > 100 ? 500 : 0;
    });

    camera.jumpTo({ distance: 300, pitch: 0.1, targetX: 0, targetZ: 0, yaw: 0 });

    expect(camera.camera.position.y).toBeCloseTo(500 + 1.2 + 300 * 0.02);
  });

  it("arrives from straight above and settles into the opening view", () => {
    const camera = createCamera();

    camera.arriveFromAbove();

    expect(camera.state).toMatchObject({ pitch: 1.48, yaw: 0 });

    settle(camera);

    expect(camera.state.pitch).toBeCloseTo(0.82);
    expect(camera.state.yaw).toBeCloseTo(0.6);
    expect(camera.state.distance).toBeCloseTo(HALF_SIZE * 1.6);
  });

  it("frames the ground around the target when looking down", () => {
    const camera = createCamera();

    camera.jumpTo({ distance: 1000, pitch: 1.48, targetX: 300, targetZ: -200, yaw: 0 });

    const footprint = camera.groundFootprint(REACH);

    const centerX =
      footprint.reduce((sum, point) => {
        return sum + point.x;
      }, 0) / footprint.length;
    const centerZ =
      footprint.reduce((sum, point) => {
        return sum + point.z;
      }, 0) / footprint.length;

    expect(footprint).toHaveLength(4);
    expect(centerX).toBeCloseTo(300, -1);
    expect(centerZ).toBeCloseTo(-200, -2);
  });

  it("reaches toward the horizon in the direction the camera faces", () => {
    const camera = createCamera();

    camera.jumpTo({ distance: 2000, pitch: 0.2, targetX: 0, targetZ: 0, yaw: 0 });

    const footprint = camera.groundFootprint(REACH);

    const nearest = Math.max(
      ...footprint.map((point) => {
        return point.z;
      })
    );
    const farthest = Math.min(
      ...footprint.map((point) => {
        return point.z;
      })
    );

    expect(nearest).toBeGreaterThan(0);
    expect(farthest).toBeLessThan(-REACH / 2);
  });

  it("follows a target until it goes away", () => {
    const camera = createCamera();

    let target: GroundPoint | null = { x: 120, z: -80 };

    camera.follow(() => {
      return target;
    });
    camera.update(1);

    expect(camera.isFollowing).toBe(true);

    target = null;
    camera.update(1);

    expect(camera.isFollowing).toBe(false);
  });

  it.each([
    {
      move: (camera: GodCamera) => {
        camera.flyTo({ targetX: 300, targetZ: 300 });
      },
      name: "flying",
    },
    {
      move: (camera: GodCamera) => {
        camera.pan(40, 20, 900);
      },
      name: "panning",
    },
    {
      move: (camera: GodCamera) => {
        camera.moveBy(30, 10);
      },
      name: "moving",
    },
  ])("stops following when $name somewhere else", ({ move }) => {
    const camera = createCamera();

    camera.follow(() => {
      return { x: 0, z: 0 };
    });
    move(camera);

    expect(camera.isFollowing).toBe(false);
  });
});
