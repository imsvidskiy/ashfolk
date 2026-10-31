import { Scene } from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ignore } from "../shared/ignore.ts";
import { BackgroundPipelines } from "./background-pipelines.ts";
import { createGraphics, type Graphics, webGPUDevice } from "./create-graphics.ts";
import { RENDER_QUALITY } from "./render-quality.ts";
import { HARDWARE_ADAPTER } from "./testing/hardware-adapter.ts";

const SETTLE_LIMIT_MILLISECONDS = 1000;

interface Stage {
  readonly backgroundPipelines: BackgroundPipelines;
  readonly graphics: Graphics;
  readonly originalPipelines: unknown;
  readonly pipelines: FakePipelines;
  readonly scene: Scene;
}

let stage: Stage | null = null;

async function createStage(): Promise<Stage> {
  const graphics = await createGraphics(document.createElement("canvas"), RENDER_QUALITY.low);
  const device = webGPUDevice(graphics.renderer);

  if (device === null) {
    throw new Error("The renderer has no WebGPU device");
  }

  const scene = new Scene();
  const pipelines = new FakePipelines();
  const originalPipelines: unknown = Reflect.get(graphics.renderer, "_pipelines");

  vi.spyOn(device, "adapterInfo", "get").mockReturnValue(HARDWARE_ADAPTER);
  Reflect.set(graphics.renderer, "_pipelines", pipelines);
  stage = {
    backgroundPipelines: new BackgroundPipelines(graphics.renderer, scene),
    graphics,
    originalPipelines,
    pipelines,
    scene,
  };

  return stage;
}

class FakePipelines {
  readonly backgroundCompiles: object[] = [];
  readonly compiles: Promise<void>[] = [];
  readonly readyObjects = new Set<object>();
  readonly updates: object[] = [];

  getForRender(renderObject: object, promises: Promise<void>[]): void {
    this.backgroundCompiles.push(renderObject);
    promises.push(...this.compiles);
  }

  isReady(renderObject: object): boolean {
    return this.readyObjects.has(renderObject);
  }

  updateForRender(renderObject: object): void {
    this.updates.push(renderObject);
  }
}

afterEach(() => {
  if (stage === null) {
    return;
  }

  stage.backgroundPipelines.dispose();
  Reflect.set(stage.graphics.renderer, "_pipelines", stage.originalPipelines);
  stage.graphics.renderer.dispose();
  stage = null;
});

describe("background pipelines", () => {
  it("compiles a new object of the scene in the background", async () => {
    const { pipelines, scene } = await createStage();
    const renderObject = { scene };

    pipelines.updateForRender(renderObject);

    expect(pipelines.backgroundCompiles).toContain(renderObject);
    expect(pipelines.updates).not.toContain(renderObject);
  });

  it("keeps one-off renders outside the scene, such as a texture bake, on three's path", async () => {
    const { pipelines } = await createStage();
    const renderObject = { scene: new Scene() };

    pipelines.updateForRender(renderObject);

    expect(pipelines.updates).toContain(renderObject);
    expect(pipelines.backgroundCompiles).not.toContain(renderObject);
  });

  it("keeps an object whose pipeline is ready on three's path", async () => {
    const { pipelines, scene } = await createStage();
    const renderObject = { scene };

    pipelines.readyObjects.add(renderObject);
    pipelines.updateForRender(renderObject);

    expect(pipelines.updates).toContain(renderObject);
    expect(pipelines.backgroundCompiles).not.toContain(renderObject);
  });

  it("stops waiting at the limit and lets a failed compile go", async () => {
    const { backgroundPipelines, pipelines, scene } = await createStage();
    const onSettled = vi.fn();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    pipelines.compiles.push(new Promise(ignore), Promise.reject(new Error("The pipeline failed to compile")));
    pipelines.updateForRender({ scene });

    const settling = backgroundPipelines.settle(SETTLE_LIMIT_MILLISECONDS);

    settling.then(onSettled, ignore);
    await vi.advanceTimersByTimeAsync(SETTLE_LIMIT_MILLISECONDS - 1);

    expect(onSettled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    await expect(settling).resolves.toBeUndefined();
  });
});
