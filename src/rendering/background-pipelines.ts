import type { Scene, WebGPURenderer } from "three/webgpu";
import { ignore } from "../shared/ignore.ts";

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

// Workaround: three.js r186 creates a render pipeline synchronously in the frame that first draws an object, and the
// GPU holds that frame while the driver compiles it, for seconds on a cold shader cache. Objects of the scene without a
// pipeline get one from createRenderPipelineAsync instead, and three skips drawing them until it is ready. Objects that
// already draw, and one-off renders such as texture bakes, keep the synchronous path.
export class BackgroundPipelines {
  readonly #pending = new Set<Promise<void>>();
  readonly #restore: () => void;

  constructor(renderer: WebGPURenderer, scene: Scene) {
    const pipelines: unknown = Reflect.get(renderer, "_pipelines");

    if (!isRenderPipelines(pipelines)) {
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

  get pendingCount(): number {
    return this.#pending.size;
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
