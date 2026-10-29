import { WebGPUBackend, WebGPURenderer } from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ignore } from "../shared/ignore.ts";
import { createGraphics, type Graphics, webGPUDevice } from "./create-graphics.ts";
import { RENDER_QUALITY } from "./render-quality.ts";

let graphics: Graphics | null = null;

async function startGraphics(): Promise<Graphics> {
  graphics = await createGraphics(document.createElement("canvas"), RENDER_QUALITY.low);

  return graphics;
}

function deviceOf({ renderer }: Graphics): GPUDevice {
  const device = webGPUDevice(renderer);

  if (device === null) {
    throw new Error("The renderer has no WebGPU device");
  }

  return device;
}

afterEach(() => {
  graphics?.renderer.dispose();
  graphics = null;
});

describe("graphics", () => {
  it("runs on WebGPU", async () => {
    const { renderer } = await startGraphics();

    expect(renderer.backend).toBeInstanceOf(WebGPUBackend);
  });

  it("keeps a failing error scope from rejecting", async () => {
    const device = deviceOf(await startGraphics());

    // An empty scope stack rejects like a lost device does in Safari.
    await expect(device.popErrorScope()).resolves.toBeNull();
  });

  it("reports a lost device", async () => {
    vi.spyOn(console, "error").mockImplementation(ignore);

    const { lost, renderer } = await startGraphics();

    renderer.onDeviceLost({ api: "WebGPU", message: "Unknown reason", originalEvent: null, reason: "unknown" });

    await expect(lost).resolves.toBeUndefined();
    expect(Reflect.get(renderer, "_isDeviceLost")).toBe(true);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Unknown reason"));
  });

  it("has no WebGPU device on the WebGL2 backend", async () => {
    const renderer = new WebGPURenderer({ forceWebGL: true });

    try {
      await renderer.init();

      expect(webGPUDevice(renderer)).toBeNull();
    } finally {
      renderer.dispose();
    }
  });

  it("refuses to fall back to WebGL2 without WebGPU", async () => {
    vi.spyOn(console, "warn").mockImplementation(ignore);
    vi.spyOn(navigator, "gpu", "get").mockReturnValue(undefined as unknown as GPU);

    await expect(startGraphics()).rejects.toThrow("can't run the island's WebGPU graphics");
  });
});
