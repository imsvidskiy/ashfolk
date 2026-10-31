import { BoxGeometry, Group, Mesh, MeshBasicNodeMaterial, Scene } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { ignore } from "../shared/ignore.ts";
import {
  FIRST_WARM_UP_BATCH,
  SLOW_WARM_UP_FRAME_MILLISECONDS,
  type WarmUpClock,
  warmUpScene,
} from "./scene-warm-up.ts";

interface WarmedScene {
  readonly group: Group;
  readonly meshes: readonly Mesh[];
  readonly scene: Scene;
}

function createScene(meshCount: number): WarmedScene {
  const scene = new Scene();
  const group = new Group();
  const geometry = new BoxGeometry();
  const material = new MeshBasicNodeMaterial();

  const meshes = Array.from({ length: meshCount }, () => {
    const mesh = new Mesh(geometry, material);

    mesh.visible = false;

    return mesh;
  });

  group.visible = false;
  group.add(...meshes);
  scene.add(group);

  return { group, meshes, scene };
}

function shownMeshes(meshes: readonly Mesh[]): Mesh[] {
  return meshes.filter((mesh) => {
    return mesh.visible && !mesh.frustumCulled;
  });
}

function clockWithRenders(millisecondsPerRender: number): WarmUpClock {
  let time = 0;

  return {
    nextFrame: () => {
      return Promise.resolve();
    },
    now: () => {
      time += millisecondsPerRender;

      return time;
    },
  };
}

async function shownPerRender(meshCount: number, millisecondsPerRender: number): Promise<number[]> {
  const { group, meshes, scene } = createScene(meshCount);
  const shown: number[] = [];

  await warmUpScene(
    scene,
    () => {
      shown.push(group.visible ? shownMeshes(meshes).length : 0);
    },
    clockWithRenders(millisecondsPerRender)
  );

  return shown;
}

describe("scene warm-up", () => {
  it("shows hidden meshes inside hidden groups and without culling, twice as many each quick frame", async () => {
    await expect(shownPerRender(FIRST_WARM_UP_BATCH * 5, 0)).resolves.toEqual([
      FIRST_WARM_UP_BATCH,
      FIRST_WARM_UP_BATCH * 3,
      FIRST_WARM_UP_BATCH * 5,
    ]);
  });

  it("shows half as many after a slow frame", async () => {
    await expect(shownPerRender(FIRST_WARM_UP_BATCH * 2, SLOW_WARM_UP_FRAME_MILLISECONDS + 1)).resolves.toEqual([
      FIRST_WARM_UP_BATCH,
      FIRST_WARM_UP_BATCH * 1.5,
      FIRST_WARM_UP_BATCH * 1.75,
      FIRST_WARM_UP_BATCH * 1.875,
      FIRST_WARM_UP_BATCH * 2,
    ]);
  });

  it("waits for a frame after each render", async () => {
    const { scene } = createScene(FIRST_WARM_UP_BATCH + 1);
    const steps: string[] = [];

    await warmUpScene(
      scene,
      () => {
        steps.push("render");
      },
      {
        nextFrame: () => {
          steps.push("frame");

          return Promise.resolve();
        },
        now: () => {
          return 0;
        },
      }
    );

    expect(steps).toEqual(["render", "frame", "render", "frame"]);
  });

  it("puts back what was shown and culled", async () => {
    const { group, scene } = createScene(0);
    const shown = new Mesh();
    const unculled = new Mesh();
    const hidden = new Mesh();
    const meshes = [shown, unculled, hidden];

    shown.visible = true;
    unculled.visible = false;
    unculled.frustumCulled = false;
    hidden.visible = false;
    group.add(...meshes);

    await warmUpScene(scene, ignore, clockWithRenders(0));

    expect(group.visible).toBe(false);
    expect(
      meshes.map((mesh) => {
        return [mesh.visible, mesh.frustumCulled];
      })
    ).toEqual([
      [true, true],
      [false, false],
      [false, true],
    ]);
  });

  it("puts back what was shown when a render fails", async () => {
    const { group, meshes, scene } = createScene(2);

    await expect(
      warmUpScene(
        scene,
        () => {
          throw new Error("The device is lost");
        },
        clockWithRenders(0)
      )
    ).rejects.toThrow("The device is lost");
    expect(group.visible).toBe(false);
    expect(shownMeshes(meshes)).toEqual([]);
  });
});
