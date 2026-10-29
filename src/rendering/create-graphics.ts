import { ACESFilmicToneMapping, PCFShadowMap, WebGPUBackend, WebGPURenderer } from "three/webgpu";
import type { RenderQuality } from "./render-quality.ts";

const GRAPHICS_UNAVAILABLE = "This browser can't run the island's WebGPU graphics. Try the latest Chrome or Safari.";

export function webGPUDevice(renderer: WebGPURenderer): GPUDevice | null {
  const { backend } = renderer;

  if (!(backend instanceof WebGPUBackend)) {
    return null;
  }

  const device: unknown = Reflect.get(backend, "device");

  return device instanceof GPUDevice ? device : null;
}

export interface Graphics {
  readonly lost: Promise<void>;
  readonly renderer: WebGPURenderer;
}

function quietErrorScopes(device: GPUDevice): void {
  const popErrorScope = device.popErrorScope.bind(device);

  device.popErrorScope = () => {
    return popErrorScope().catch(() => {
      return null;
    });
  };
}

export async function createGraphics(canvas: HTMLCanvasElement, quality: RenderQuality): Promise<Graphics> {
  const renderer = new WebGPURenderer({
    alpha: false,
    antialias: quality.hasAntialias,
    canvas,
    depth: !quality.hasBloom,
    powerPreference: "high-performance",
    reversedDepthBuffer: true,
  });

  const lost = new Promise<void>((resolve) => {
    renderer.onDeviceLost = (info) => {
      console.error(`The graphics device was lost (${info.reason ?? "unknown"}): ${info.message}`);
      resolve();
    };
  });

  await renderer.init();

  const device = webGPUDevice(renderer);

  if (device === null) {
    renderer.dispose();

    throw new Error(GRAPHICS_UNAVAILABLE);
  }

  quietErrorScopes(device);

  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  return { lost, renderer };
}
