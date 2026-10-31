import { Line, Mesh, type Object3D, Points, type Scene, Sprite } from "three/webgpu";

export const FIRST_WARM_UP_BATCH = 8;
export const SLOW_WARM_UP_FRAME_MILLISECONDS = 40;

const WARM_UP_FRAME_BUDGET_MILLISECONDS = 12;

export interface WarmUpClock {
  readonly nextFrame: () => Promise<void>;
  readonly now: () => number;
}

interface ObjectState {
  readonly isCulled: boolean;
  readonly isVisible: boolean;
  readonly object: Object3D;
}

function isDrawable(object: Object3D): boolean {
  return object instanceof Mesh || object instanceof Points || object instanceof Line || object instanceof Sprite;
}

function nextBatchSize(size: number, spentMilliseconds: number): number {
  if (spentMilliseconds < WARM_UP_FRAME_BUDGET_MILLISECONDS) {
    return size * 2;
  }

  if (spentMilliseconds > SLOW_WARM_UP_FRAME_MILLISECONDS) {
    return Math.max(1, Math.floor(size / 2));
  }

  return size;
}

export async function warmUpScene(scene: Scene, render: () => void, clock: WarmUpClock): Promise<void> {
  const states: ObjectState[] = [];
  const drawables: Object3D[] = [];

  scene.traverse((object) => {
    states.push({ isCulled: object.frustumCulled, isVisible: object.visible, object });
    object.frustumCulled = false;
    object.visible = !isDrawable(object);

    if (isDrawable(object)) {
      drawables.push(object);
    }
  });

  try {
    let shown = 0;
    let batchSize = FIRST_WARM_UP_BATCH;

    while (shown < drawables.length) {
      for (const drawable of drawables.slice(shown, shown + batchSize)) {
        drawable.visible = true;
      }

      shown += batchSize;

      const began = clock.now();

      render();
      batchSize = nextBatchSize(batchSize, clock.now() - began);
      // biome-ignore lint/performance/noAwaitInLoops: each batch renders in its own frame
      await clock.nextFrame();
    }
  } finally {
    for (const { isCulled, isVisible, object } of states) {
      object.frustumCulled = isCulled;
      object.visible = isVisible;
    }
  }
}
