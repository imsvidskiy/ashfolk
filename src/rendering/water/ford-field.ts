import {
  abs,
  dot,
  Fn,
  float,
  If,
  ivec2,
  length,
  max,
  min,
  mix,
  mx_noise_float,
  smoothstep,
  textureLoad,
  vec2,
  vec3,
} from "three/tsl";
import { type DataTexture, type Node, RedFormat, RGBAFormat } from "three/webgpu";
import { distanceToSegment } from "../../shared/math.ts";
import { type Crossing, crossingLength, crossingMiddle, type Ford } from "../../world/crossings.ts";
import type { WorldGrid } from "../../world/world-grid.ts";
import { floatDataTexture } from "../data-textures.ts";
import { cellAtNode } from "../terrain/height-sampling.ts";

export const FORD_PATH_REACH = 9;

const FORD_BED_HALF_WIDTH = 2;
const FORD_PATH_HALF_WIDTH = 0.75;
const FORD_SAND = vec3(0.5, 0.42, 0.27);
const FORD_GRAVEL = vec3(0.3, 0.28, 0.24);
const EDGE_WOBBLE = 0.6;
const BED_OVERHANG = 1.5;
const BED_DRY_MARGIN = 0.2;
const BED_WET_DEPTH = 0.05;
const LARGEST_FORD_COUNT = 255;
const MARKED_HALF_WIDTH = FORD_BED_HALF_WIDTH + EDGE_WOBBLE;

interface FordFrame {
  readonly across: Node<"float">;
  readonly along: Node<"float">;
  readonly length: Node<"float">;
}

function isFord(crossing: Crossing): crossing is Ford {
  return crossing.kind === "ford";
}

function edgeWobble(point: Node<"vec2">): Node<"float"> {
  return mx_noise_float(vec3(point.mul(0.45), 2.3)).mul(EDGE_WOBBLE);
}

function beyondFord(frame: FordFrame): Node<"float"> {
  return max(frame.along.negate(), frame.along.sub(frame.length));
}

function bedOf(frame: FordFrame, wobble: Node<"float">): Node<"float"> {
  const width = float(FORD_BED_HALF_WIDTH).add(wobble);

  const across = smoothstep(width, width.mul(0.55), abs(frame.across));
  const along = smoothstep(BED_OVERHANG, 0, beyondFord(frame));

  return across.mul(along);
}

function pathOf(frame: FordFrame, point: Node<"vec2">, wobble: Node<"float">): Node<"float"> {
  const beyond = max(beyondFord(frame), 0);
  const narrowing = min(beyond.div(FORD_PATH_REACH), 1);
  const bend = mx_noise_float(vec3(point.mul(0.08), 5.1))
    .mul(narrowing)
    .mul(1.4);
  const width = float(FORD_PATH_HALF_WIDTH)
    .mul(float(1.25).sub(narrowing.mul(0.55)))
    .add(wobble.mul(0.4));

  const across = smoothstep(width, width.mul(0.35), abs(frame.across.sub(bend)));
  const along = smoothstep(FORD_PATH_REACH, FORD_PATH_REACH * 0.55, beyond);

  return across.mul(along);
}

export function fordBedColorNode(position: Node<"vec3">): Node<"vec3"> {
  const patches = mx_noise_float(position.mul(0.21));
  const pebbles = smoothstep(0.05, 0.4, mx_noise_float(position.mul(1.9)).add(patches.mul(0.3)));

  return mix(FORD_SAND, FORD_GRAVEL, pebbles.mul(0.8)).mul(patches.mul(0.12).add(1));
}

export class FordField {
  readonly cells: DataTexture;
  readonly segments: DataTexture;
  readonly #cellData: Float32Array;
  readonly #grid: WorldGrid;
  readonly #segmentData: Float32Array;

  constructor(grid: WorldGrid, crossings: readonly Crossing[]) {
    this.#grid = grid;
    this.#cellData = new Float32Array(grid.cellCount);
    this.#segmentData = new Float32Array((LARGEST_FORD_COUNT + 1) * 4);
    this.cells = floatDataTexture(this.#cellData, grid.cellsPerSide, grid.cellsPerSide, RedFormat);
    this.segments = floatDataTexture(this.#segmentData, LARGEST_FORD_COUNT + 1, 1, RGBAFormat);
    this.rebuild(crossings);
  }

  rebuild(crossings: readonly Crossing[]): void {
    const grid = this.#grid;
    const fords = crossings.filter(isFord).slice(0, LARGEST_FORD_COUNT);
    const reach = MARKED_HALF_WIDTH + grid.cellSize * Math.SQRT1_2;

    this.#cellData.fill(0);
    this.#segmentData.fill(0);

    for (const [index, ford] of fords.entries()) {
      const slot = index + 1;
      const fordLength = crossingLength(ford);
      const directionX = (ford.endX - ford.startX) / fordLength;
      const directionZ = (ford.endZ - ford.startZ) / fordLength;

      const start: [number, number] = [
        ford.startX - directionX * FORD_PATH_REACH,
        ford.startZ - directionZ * FORD_PATH_REACH,
      ];
      const end: [number, number] = [
        ford.endX + directionX * FORD_PATH_REACH,
        ford.endZ + directionZ * FORD_PATH_REACH,
      ];

      this.#segmentData.set([ford.startX, ford.startZ, ford.endX, ford.endZ], slot * 4);

      const middle = crossingMiddle(ford);

      for (const cell of grid.cellsInRadius(middle.x, middle.z, fordLength / 2 + FORD_PATH_REACH + reach)) {
        if (distanceToSegment(grid.cellCenterX(cell), grid.cellCenterZ(cell), start, end) <= reach) {
          this.#cellData[cell] = slot;
        }
      }
    }

    this.cells.needsUpdate = true;
    this.segments.needsUpdate = true;
  }

  marksNode(point: Node<"vec2">, depth: Node<"float">): Node<"vec2"> {
    const wet = smoothstep(-BED_DRY_MARGIN, BED_WET_DEPTH, depth);

    return this.#marksNear(point, (frame, wobble) => {
      return vec2(bedOf(frame, wobble).mul(wet), pathOf(frame, point, wobble));
    });
  }

  pathNode(point: Node<"vec2">): Node<"float"> {
    return this.#marksNear(point, (frame, wobble) => {
      return vec2(0, pathOf(frame, point, wobble));
    }).y;
  }

  dispose(): void {
    this.cells.dispose();
    this.segments.dispose();
  }

  #marksNear(point: Node<"vec2">, marksOf: (frame: FordFrame, wobble: Node<"float">) => Node<"vec2">): Node<"vec2"> {
    const grid = this.#grid;

    const cell = cellAtNode(grid, point);
    const slot = textureLoad(this.cells, cell).x;

    return Fn(() => {
      const marks = vec2(0, 0).toVar();

      If(slot.greaterThan(0.5), () => {
        const segment = textureLoad(this.segments, ivec2(vec2(slot.add(0.5).floor(), 0)));
        const span = segment.zw.sub(segment.xy);
        const spanLength = max(length(span), 0.001);
        const direction = span.div(spanLength);
        const offset = point.sub(segment.xy);

        const frame: FordFrame = {
          across: offset.y.mul(direction.x).sub(offset.x.mul(direction.y)),
          along: dot(offset, direction),
          length: spanLength,
        };

        const isNear = abs(frame.across).lessThan(MARKED_HALF_WIDTH).and(beyondFord(frame).lessThan(FORD_PATH_REACH));

        If(isNear, () => {
          marks.assign(marksOf(frame, edgeWobble(point)));
        });
      });

      return marks;
    })();
  }
}
