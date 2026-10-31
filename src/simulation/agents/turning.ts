import { wrapAngle } from "../../shared/math.ts";
import type { Mover } from "./movement.ts";

const TURN_RATE = 8;

export function turnTowards(mover: Mover, heading: number, seconds: number): void {
  mover.heading += wrapAngle(heading - mover.heading) * Math.min(1, seconds * TURN_RATE);
}
