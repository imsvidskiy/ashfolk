import type { DetailSteps } from "../level-of-detail.ts";
import type { Shape } from "../mesh/shape.ts";
import { torus } from "../mesh/shapes.ts";

const FEWEST_TRIM_SEGMENTS = 4;
const RING_SIDES = 4;

type HumanDetailLevel = "far" | "high" | "low";

export interface HumanDetail extends DetailSteps {
  readonly hasFineDetails: boolean;
  readonly headSegments: number;
  readonly limbSegments: number;
  readonly propSubdivisions: number;
  readonly torsoSegments: number;
  readonly trimShare: number;
}

export const HUMAN_DETAILS: Readonly<Record<HumanDetailLevel, HumanDetail>> = {
  far: {
    curveSteps: 1,
    hasFineDetails: false,
    hasSmallParts: false,
    headSegments: 6,
    limbSegments: 4,
    propSubdivisions: 0,
    torsoSegments: 6,
    trimShare: 0.4,
  },
  high: {
    curveSteps: 2,
    hasFineDetails: true,
    hasSmallParts: true,
    headSegments: 16,
    limbSegments: 10,
    propSubdivisions: 1,
    torsoSegments: 14,
    trimShare: 1,
  },
  low: {
    curveSteps: 1,
    hasFineDetails: false,
    hasSmallParts: true,
    headSegments: 8,
    limbSegments: 5,
    propSubdivisions: 1,
    torsoSegments: 8,
    trimShare: 0.6,
  },
};

export function trimSegments(detail: HumanDetail, segments: number): number {
  return Math.max(FEWEST_TRIM_SEGMENTS, Math.round(segments * detail.trimShare));
}

export function trimmedRing(detail: HumanDetail, radius: number, thickness: number, segments: number): Shape {
  return torus(radius, thickness, trimSegments(detail, segments), RING_SIDES);
}
