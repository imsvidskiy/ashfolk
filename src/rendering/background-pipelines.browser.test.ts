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
import { BackgroundPipelines, isSoftwareAdapter } from "./background-pipelines.ts";
import { createGraphics, type Graphics, webGPUDevice } from "./create-graphics.ts";
import { RENDER_QUALITY } from "./render-quality.ts";

const SETTLE_MILLISECONDS = 10_000;

const HARDWARE_ADAPTER: GPUAdapterInfo = {
  architecture: "metal-3",
  description: "",
  device: "",
  isFallbackAdapter: false,
  subgroupMaxSize: 64,
  subgroupMinSize: 4,
  vendor: "apple",
};

const SOFTWARE_ADAPTER: GPUAdapterInfo = {
  architecture: "swiftshader",
  description: "",
  device: "",
  isFallbackAdapter: true,
  subgroupMaxSize: 4,
  subgroupMinSize: 4,
  vendor: "google",
};

// The tests render with SwiftShader and pass it off as a GPU to reach the background path. SwiftShader on Linux, as in
// CI, loses the device on a background compile, so those tests run only on other systems.
const LOSES_DEVICE_ON_BACKGROUND_COMPILES =
  navigator.userAgent.includes("Linux") && isSoftwareAdapter((await navigator.gpu.requestAdapter())?.info);
const BACKGROUND_COMPILES_SKIPPED = "SwiftShader on Linux loses the device on background compiles";

interface Stage {
  readonly camera: PerspectiveCamera;
  readonly device: GPUDevice;
  readonly emptyDrawCalls: number;
  readonly graphics: Graphics;
  readonly pipelines: BackgroundPipelines;
  readonly scene: Scene;
}

let stage: Stage | null = null;

async function createStage(adapter = HARDWARE_ADAPTER): Promise<Stage> {
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

  vi.spyOn(device, "adapterInfo", "get").mockReturnValue(adapter);
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
  it("compiles a new object in the background and draws it once its pipeline is ready", async ({ skip }) => {
    skip(LOSES_DEVICE_ON_BACKGROUND_COMPILES, BACKGROUND_COMPILES_SKIPPED);

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

  it("draws an object at once when another object already compiled its pipeline", async ({ skip }) => {
    skip(LOSES_DEVICE_ON_BACKGROUND_COMPILES, BACKGROUND_COMPILES_SKIPPED);

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

    vi.spyOn(Promise, "allSettled").mockReturnValueOnce(new Promise(vi.fn()));

    await expect(created.pipelines.settle(10)).resolves.toBeUndefined();
  });

  it("compiles synchronously on a software adapter", async () => {
    const created = await createStage(SOFTWARE_ADAPTER);
    const createRenderPipelineAsync = vi.spyOn(created.device, "createRenderPipelineAsync");

    addBox(created.scene);

    expect(drawnObjects(created)).toBe(1);
    expect(createRenderPipelineAsync).not.toHaveBeenCalled();
  });

  it("tells SwiftShader from a hardware adapter", () => {
    expect(isSoftwareAdapter(SOFTWARE_ADAPTER)).toBe(true);
    expect(isSoftwareAdapter({ ...SOFTWARE_ADAPTER, isFallbackAdapter: false })).toBe(true);
    expect(
      isSoftwareAdapter({ ...SOFTWARE_ADAPTER, architecture: "metal-3", isFallbackAdapter: false, vendor: "apple" })
    ).toBe(false);
    expect(isSoftwareAdapter(undefined)).toBe(false);
  });

  it("draws new objects synchronously again once disposed", async () => {
    const created = await createStage();

    created.pipelines.dispose();
    addBox(created.scene);

    expect(drawnObjects(created)).toBe(1);
  });
});
