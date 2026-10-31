import {
  BoxGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  QuadMesh,
  RenderTarget,
  Scene,
} from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackgroundPipelines } from "./background-pipelines.ts";
import { createGraphics, type Graphics, webGPUDevice } from "./create-graphics.ts";
import { RENDER_QUALITY } from "./render-quality.ts";

const SETTLE_MILLISECONDS = 10_000;

interface Stage {
  readonly camera: PerspectiveCamera;
  readonly device: GPUDevice;
  readonly emptyDrawCalls: number;
  readonly graphics: Graphics;
  readonly pipelines: BackgroundPipelines;
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
  const camera = new PerspectiveCamera(50, 1, 0.1, 100);

  camera.position.set(0, 0, 5);
  graphics.renderer.render(scene, camera);
  graphics.renderer.info.reset();
  graphics.renderer.render(scene, camera);

  const emptyDrawCalls = graphics.renderer.info.render.drawCalls;

  stage = {
    camera,
    device,
    emptyDrawCalls,
    graphics,
    pipelines: new BackgroundPipelines(graphics.renderer, scene),
    scene,
  };

  return stage;
}

function addBox(scene: Scene): Mesh {
  const box = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial({ color: 0xff_88_00 }));

  scene.add(box);

  return box;
}

function drawnObjects({ camera, emptyDrawCalls, graphics, scene }: Stage): number {
  const { renderer } = graphics;

  renderer.info.reset();
  renderer.render(scene, camera);

  return renderer.info.render.drawCalls - emptyDrawCalls;
}

afterEach(() => {
  stage?.pipelines.dispose();
  stage?.graphics.renderer.dispose();
  stage = null;
});

describe("background pipelines", () => {
  it("compiles a new object in the background and draws it once its pipeline is ready", async () => {
    const created = await createStage();
    const createRenderPipeline = vi.spyOn(created.device, "createRenderPipeline");
    const createRenderPipelineAsync = vi.spyOn(created.device, "createRenderPipelineAsync");

    addBox(created.scene);

    expect(drawnObjects(created)).toBe(0);
    expect(createRenderPipelineAsync).toHaveBeenCalledOnce();
    expect(createRenderPipeline).not.toHaveBeenCalled();
    expect(created.pipelines.pendingCount).toBe(1);

    await created.pipelines.settle(SETTLE_MILLISECONDS);

    expect(created.pipelines.pendingCount).toBe(0);
    expect(drawnObjects(created)).toBe(1);
  });

  it("draws an object at once when another object already compiled its pipeline", async () => {
    const created = await createStage();
    const box = addBox(created.scene);

    drawnObjects(created);
    await created.pipelines.settle(SETTLE_MILLISECONDS);
    created.scene.add(new Mesh(box.geometry, box.material));

    expect(drawnObjects(created)).toBe(2);
  });

  it("keeps one-off renders outside the scene synchronous, so a texture bake draws", async () => {
    const created = await createStage();
    const { renderer } = created.graphics;
    const target = new RenderTarget(4, 4);
    const createRenderPipeline = vi.spyOn(created.device, "createRenderPipeline");

    renderer.info.reset();
    renderer.setRenderTarget(target);
    new QuadMesh(new MeshBasicNodeMaterial({ color: 0x33_66_99 })).render(renderer);
    renderer.setRenderTarget(null);

    expect(createRenderPipeline).toHaveBeenCalledOnce();
    expect(renderer.info.render.drawCalls).toBe(1);

    target.dispose();
  });

  it("stops waiting at the limit", async () => {
    const created = await createStage();

    addBox(created.scene);
    drawnObjects(created);
    vi.spyOn(Promise, "allSettled").mockReturnValueOnce(new Promise(vi.fn()));

    await expect(created.pipelines.settle(10)).resolves.toBeUndefined();
  });

  it("draws new objects synchronously again once disposed", async () => {
    const created = await createStage();

    created.pipelines.dispose();
    addBox(created.scene);

    expect(drawnObjects(created)).toBe(1);
  });
});
