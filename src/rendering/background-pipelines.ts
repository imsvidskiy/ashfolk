import type { Scene, WebGPURenderer } from "three/webgpu";
import { ignore } from "../shared/ignore.ts";
import { webGPUDevice } from "./create-graphics.ts";

const PIPELINE_METHODS = ["getForRender", "isReady", "updateForRender"] as const;

interface RenderPipelines {
  readonly getForRender: (renderObject: object, promises?: Promise<void>[] | null) => unknown;
  readonly isReady: (renderObject: object) => boolean;
  updateForRender: (renderObject: object) => void;
}

function isRenderPipelines(value: unknown): value is RenderPipelines {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return PIPELINE_METHODS.every((name) => {
    return typeof Reflect.get(value, name) === "function";
  });
}

export function isSoftwareAdapter(info: GPUAdapterInfo | undefined): boolean {
  return info !== undefined && (info.isFallbackAdapter === true || info.architecture === "swiftshader");
}

// Workaround: three.js r186 compiles a pipeline synchronously in the frame that first draws an object, which holds the
// GPU for seconds on a cold shader cache. SwiftShader loses the device on background compiles, so it keeps that path.
export class BackgroundPipelines {
  readonly #pending = new Set<Promise<void>>();
  readonly #restore: () => void;

  constructor(renderer: WebGPURenderer, scene: Scene) {
    const pipelines: unknown = Reflect.get(renderer, "_pipelines");
    const device = webGPUDevice(renderer);

    if (device === null || isSoftwareAdapter(device.adapterInfo) || !isRenderPipelines(pipelines)) {
      this.#restore = ignore;

      return;
    }

    const { updateForRender } = pipelines;

    pipelines.updateForRender = (renderObject) => {
      if (Reflect.get(renderObject, "scene") !== scene || pipelines.isReady(renderObject)) {
        updateForRender.call(pipelines, renderObject);

        return;
      }

      const promises: Promise<void>[] = [];

      pipelines.getForRender(renderObject, promises);

      for (const promise of promises) {
        this.#track(promise);
      }
    };
    this.#restore = () => {
      Reflect.deleteProperty(pipelines, "updateForRender");
    };
  }

  async settle(limitMilliseconds: number): Promise<void> {
    let timer = 0;

    const limit = new Promise<void>((resolve) => {
      timer = window.setTimeout(resolve, limitMilliseconds);
    });

    try {
      await Promise.race([Promise.allSettled(this.#pending), limit]);
    } finally {
      window.clearTimeout(timer);
    }
  }

  dispose(): void {
    this.#restore();
    this.#pending.clear();
  }

  #track(promise: Promise<void>): void {
    this.#pending.add(promise);
    promise.then(
      () => {
        this.#pending.delete(promise);
      },
      () => {
        this.#pending.delete(promise);
      }
    );
  }
}
