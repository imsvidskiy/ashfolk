import { clamp, smoothstep } from "../shared/math.ts";
import type { Waterfall } from "../world/water.ts";
import type { Emitter } from "./emitters.ts";
import type { HearingView } from "./hearing-view.ts";

const MINIMUM_VOLUME = 0.02;
const FULL_WIDTH = 36;
const FULL_REACH = 180;
const FARTHEST_REACH = 600;

const CLOSE_VIEW = 400;
const FARTHEST_VIEW = 1800;

export function waterfallEmitter(waterfalls: readonly Waterfall[], view: HearingView): Emitter[] {
  if (view.viewDistance >= FARTHEST_VIEW) {
    return [];
  }

  let closest: Waterfall | null = null;
  let nearestSquared = FARTHEST_REACH * FARTHEST_REACH;

  for (const waterfall of waterfalls) {
    const squared = (waterfall.x - view.focusX) ** 2 + (waterfall.z - view.focusZ) ** 2;

    if (squared < nearestSquared) {
      closest = waterfall;
      nearestSquared = squared;
    }
  }

  if (closest === null) {
    return [];
  }

  const width = clamp(closest.width / FULL_WIDTH, 0.25, 1);
  const near = 1 - smoothstep(FULL_REACH, FARTHEST_REACH, Math.sqrt(nearestSquared));
  const zoom = 1 - smoothstep(CLOSE_VIEW, FARTHEST_VIEW, view.viewDistance);

  const volume = width * near * zoom;

  if (volume < MINIMUM_VOLUME) {
    return [];
  }

  return [{ key: "waterfall", volume, x: closest.x, y: closest.top, z: closest.z }];
}
