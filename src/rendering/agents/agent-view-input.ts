import type { WorldMirror } from "../../game/world-mirror.ts";
import type { GrabTarget } from "../../simulation/hand/grab-target.ts";
import type { Inspection } from "../../simulation/inspection.ts";
import { footingOn } from "../../world/crossings.ts";
import type { HandMotion, HandPose } from "../hand-motion.ts";
import { HIDDEN_LEVEL, type ViewInput } from "../view-input.ts";
import type { AgentMarkers } from "./agent-markers.ts";
import type { AgentPalette } from "./agent-palette.ts";

export const NO_SELECTION = -1;

const ANKLE_DEPTH = 0.18;

export interface AgentViewInput extends ViewInput {
  readonly gameSeconds: number;
  readonly hand: HandMotion;
  readonly highlighted: GrabTarget | null;
  readonly markers: AgentMarkers;
  readonly realSeconds: number;
  readonly secondsSinceTick: number;
}

export interface LevelDistances {
  readonly far: number;
  readonly high: number;
  readonly low: number;
}

export function detailLevel(distance: number, limits: LevelDistances, detail: number): number {
  if (distance < limits.high * detail) {
    return 0;
  }

  if (distance < limits.low * detail) {
    return 1;
  }

  if (distance < farthestFigure(limits, detail)) {
    return 2;
  }

  return HIDDEN_LEVEL;
}

export function selectedAgentId(inspection: Inspection | null, kind: "animal" | "person"): number {
  if (inspection?.kind !== kind) {
    return NO_SELECTION;
  }

  return inspection.id;
}

export function liftOf(pose: HandPose | null): number {
  if (pose === null) {
    return 0;
  }

  return pose.lift;
}

export function holdFigure(
  palette: AgentPalette,
  row: number,
  heading: number,
  pose: HandPose | null,
  isHighlighted: boolean
): void {
  if (pose !== null) {
    palette.tiltToward(row, heading, pose.tiltX, pose.tiltZ);
  }

  if (isHighlighted) {
    palette.highlightRow.value = row;
  }
}

export function forgetUnseen<Visual>(visuals: Map<number, Visual>, seen: ReadonlySet<number>): void {
  for (const id of visuals.keys()) {
    if (!seen.has(id)) {
      visuals.delete(id);
    }
  }
}

export function farthestFigure(limits: LevelDistances, detail: number): number {
  return limits.far * detail;
}

export function slopeLean(mirror: WorldMirror, x: number, z: number, heading: number, reach: number): number {
  const stepX = Math.sin(heading) * reach;
  const stepZ = Math.cos(heading) * reach;

  const rise = mirror.heightAt(x + stepX, z + stepZ) - mirror.heightAt(x - stepX, z - stepZ);

  return Math.atan2(rise, reach * 2);
}

export function standingHeight(mirror: WorldMirror, x: number, z: number, wadingDepth: number): number {
  const ground = mirror.heightAt(x, z);
  const crossing = mirror.crossingAt(x, z);

  if (crossing !== null) {
    return footingOn(crossing, x, z, ground, mirror.waterLevelAt(x, z));
  }

  if (mirror.isBrookAt(x, z)) {
    return Math.max(ground, mirror.surfaceAt(x, z) - ANKLE_DEPTH);
  }

  return Math.max(ground, mirror.surfaceAt(x, z) - wadingDepth);
}
