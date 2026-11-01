export interface DetailSteps {
  readonly hasSmallParts: boolean;
}

function mostSegments(detail: DetailSteps): number {
  return detail.hasSmallParts ? 8 : 4;
}

export function segmentsAtLeast(detail: DetailSteps, least: number, segments: number): number {
  return Math.max(Math.min(least, mostSegments(detail)), segments);
}

export function segmentsUpTo(detail: DetailSteps, segments: number): number {
  return Math.min(segments, mostSegments(detail));
}

export function thinned<Point>(points: readonly Point[]): Point[] {
  return points.filter((_point, index) => {
    return index % 2 === 0 || index === points.length - 1;
  });
}

export function alongPath<Point>(points: readonly Point[], detail: DetailSteps): Point[] {
  return detail.hasSmallParts ? [...points] : thinned(points);
}
