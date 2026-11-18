import { lerp } from "../../shared/math.ts";
import type { Waypoint } from "../agents/navigation.ts";

export const TORNADO_STEP_SECONDS = 0.5;

export function tornadoDuration(path: readonly number[]): number {
  return (path.length / 2 - 1) * TORNADO_STEP_SECONDS;
}

export function tornadoPositionAt(path: readonly number[], age: number): Waypoint {
  const steps = path.length / 2 - 1;
  const progress = Math.min(age / TORNADO_STEP_SECONDS, steps);
  const step = Math.min(Math.floor(progress), steps - 1);
  const share = progress - step;

  return {
    x: lerp(path[step * 2], path[step * 2 + 2], share),
    z: lerp(path[step * 2 + 1], path[step * 2 + 3], share),
  };
}
