import type { PowerId, PowerParameters } from "../../content/powers.ts";
import type { EmberSystem } from "../nature/embers.ts";
import type { SocietyContext } from "../society/society-context.ts";
import type { BlackHoleSystem } from "./black-holes.ts";
import type { FallingBombs } from "./falling-bombs.ts";
import type { TornadoSystem } from "./tornadoes.ts";
import type { VolcanoSystem } from "./volcanoes.ts";

export interface PowerTarget {
  seconds: number;
  strokeStartHeight: number;
  x: number;
  z: number;
}

export interface PowerServices extends SocietyContext {
  blackHoles: BlackHoleSystem;
  embers: EmberSystem;
  fallingBombs: FallingBombs;
  schedule: (delaySeconds: number, task: () => void) => void;
  tornadoes: TornadoSystem;
  volcanoes: VolcanoSystem;
}

export type PowerOutcome = { kind: "applied" } | { kind: "refused"; reason: string };

export type PowerHandler<Id extends PowerId> = (
  target: PowerTarget,
  parameters: PowerParameters<Id>,
  services: PowerServices
) => PowerOutcome;

export const APPLIED: PowerOutcome = { kind: "applied" };

export function refused(reason: string): PowerOutcome {
  return { kind: "refused", reason };
}

export function percent(value: number): number {
  return value / 100;
}
