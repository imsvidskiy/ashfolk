import type { GroundPoint } from "../../game/camera/god-camera.ts";
import type { EngineHandle } from "../../game/engine-handle.ts";
import { MarkerShape, type MarkerShapeCode } from "../../rendering/agents/marker-look.ts";
import { paintMinimapTerrain } from "../../rendering/minimap-image.ts";
import { herdMarks, personMarks } from "../../rendering/minimap-marks.ts";
import type { SimulationFrame } from "../../simulation/frame.ts";

const MAP_PIXELS = 176;
const LARGEST_PIXEL_RATIO = 2;
const TERRAIN_REFRESH_MILLISECONDS = 1000;
const SEASON_STEP = 0.05;
const OVERLAY_INTERVAL_MILLISECONDS = 100;
const FIRE_COLOR = "rgb(230 82 40)";
const SMALLEST_FIRE_PIXELS = 1.5;
const TRIBE_RADIUS = 4.5;
const TRIBE_OUTLINE = "white";
const VIEW_FILL = "rgb(255 255 255 / 0.32)";
const OUTLINE = "rgb(255 255 255 / 0.9)";
const OUTLINE_WIDTH = 1.5;
const FOOTPRINT_REACH_IN_WORLDS = 2;
const TRIANGLE_HALF_WIDTH = Math.sqrt(3) / 2;

const MARK_RADII: Readonly<Record<MarkerShapeCode, number>> = {
  [MarkerShape.Circle]: 1.6,
  [MarkerShape.Diamond]: 2.6,
  [MarkerShape.Triangle]: 2.6,
};

function traceMark(
  context: CanvasRenderingContext2D,
  shape: MarkerShapeCode,
  x: number,
  y: number,
  radius: number
): void {
  context.beginPath();

  if (shape === MarkerShape.Circle) {
    context.arc(x, y, radius, 0, Math.PI * 2);

    return;
  }

  if (shape === MarkerShape.Diamond) {
    context.moveTo(x, y - radius);
    context.lineTo(x + radius, y);
    context.lineTo(x, y + radius);
    context.lineTo(x - radius, y);
    context.closePath();

    return;
  }

  context.moveTo(x, y - radius);
  context.lineTo(x + radius * TRIANGLE_HALF_WIDTH, y + radius / 2);
  context.lineTo(x - radius * TRIANGLE_HALF_WIDTH, y + radius / 2);
  context.closePath();
}

function isSameFootprint(first: readonly GroundPoint[], second: readonly GroundPoint[]): boolean {
  return (
    first.length === second.length &&
    first.every((point, index) => {
      return point.x === second[index]?.x && point.z === second[index]?.z;
    })
  );
}

export class MinimapPainter {
  readonly #canvas: HTMLCanvasElement;
  readonly #engine: EngineHandle;
  readonly #scale: number;
  readonly #size: number;
  readonly #terrain: HTMLCanvasElement;
  #frameRequest = 0;
  #lastOverlay = 0;
  #lastTerrain = Number.NEGATIVE_INFINITY;
  #paintedFootprint: readonly GroundPoint[] = [];
  #paintedFrame: SimulationFrame | null = null;
  #paintedLandVersion = -1;
  #paintedSeason = Number.NEGATIVE_INFINITY;

  constructor(canvas: HTMLCanvasElement, engine: EngineHandle) {
    this.#canvas = canvas;
    this.#engine = engine;
    this.#size = Math.round(MAP_PIXELS * Math.min(LARGEST_PIXEL_RATIO, window.devicePixelRatio));
    this.#scale = this.#size / MAP_PIXELS;
    this.#terrain = document.createElement("canvas");

    canvas.width = this.#size;
    canvas.height = this.#size;
    this.#terrain.width = this.#size;
    this.#terrain.height = this.#size;
  }

  start(): void {
    this.#frameRequest = requestAnimationFrame((time) => {
      this.#loop(time);
    });
  }

  stop(): void {
    cancelAnimationFrame(this.#frameRequest);
  }

  #loop(time: number): void {
    this.#draw(time);
    this.#frameRequest = requestAnimationFrame((next) => {
      this.#loop(next);
    });
  }

  #draw(time: number): void {
    if (time - this.#lastOverlay < OVERLAY_INTERVAL_MILLISECONDS) {
      return;
    }

    this.#lastOverlay = time;

    const context = this.#canvas.getContext("2d");

    if (context === null) {
      return;
    }

    const { frame, grid } = this.#engine.session.mirror;

    const footprint = this.#engine.camera.groundFootprint(grid.worldSize * FOOTPRINT_REACH_IN_WORLDS);

    const isTerrainStale = this.#isTerrainStale(time);
    const isOverlayCurrent = frame === this.#paintedFrame && isSameFootprint(footprint, this.#paintedFootprint);

    if (!isTerrainStale && isOverlayCurrent) {
      return;
    }

    if (isTerrainStale) {
      this.#refreshTerrain();
      this.#lastTerrain = time;
    }

    this.#paintedFrame = frame;
    this.#paintedFootprint = footprint;

    context.clearRect(0, 0, this.#size, this.#size);
    context.drawImage(this.#terrain, 0, 0);
    this.#drawFires(context, frame);
    this.#drawAgents(context, frame);
    this.#drawTribes(context, frame);
    this.#drawView(context, footprint);
  }

  #isTerrainStale(time: number): boolean {
    if (time - this.#lastTerrain < TERRAIN_REFRESH_MILLISECONDS) {
      return false;
    }

    const { mirror } = this.#engine.session;

    const hasLandChanged = mirror.landVersion !== this.#paintedLandVersion;
    const hasSeasonTurned = Math.abs(mirror.frame.calendar.season - this.#paintedSeason) >= SEASON_STEP;

    return hasLandChanged || hasSeasonTurned;
  }

  #refreshTerrain(): void {
    const { mirror } = this.#engine.session;

    this.#paintedLandVersion = mirror.landVersion;
    this.#paintedSeason = mirror.frame.calendar.season;

    const context = this.#terrain.getContext("2d");

    if (context !== null) {
      context.putImageData(paintMinimapTerrain(mirror, this.#size), 0, 0);
    }
  }

  #toMap(x: number, z: number): [number, number] {
    const { grid } = this.#engine.session.mirror;

    return [((x + grid.halfSize) / grid.worldSize) * this.#size, ((z + grid.halfSize) / grid.worldSize) * this.#size];
  }

  #drawFires(context: CanvasRenderingContext2D, frame: SimulationFrame): void {
    const { grid } = this.#engine.session.mirror;

    const pixel = Math.max(SMALLEST_FIRE_PIXELS, this.#size / grid.cellsPerSide);

    context.fillStyle = FIRE_COLOR;

    for (const cell of frame.burningCells) {
      const [x, y] = this.#toMap(grid.cellCenterX(cell), grid.cellCenterZ(cell));

      context.fillRect(x - pixel / 2, y - pixel / 2, pixel, pixel);
    }
  }

  #drawAgents(context: CanvasRenderingContext2D, frame: SimulationFrame): void {
    context.lineWidth = this.#scale;
    context.strokeStyle = OUTLINE;

    for (const mark of [...herdMarks(frame), ...personMarks(frame)]) {
      const [x, y] = this.#toMap(mark.x, mark.z);

      traceMark(context, mark.shape, x, y, MARK_RADII[mark.shape] * mark.scale * this.#scale);
      context.fillStyle = mark.color;
      context.fill();
      context.stroke();
    }
  }

  #drawTribes(context: CanvasRenderingContext2D, frame: SimulationFrame): void {
    for (const tribe of frame.tribes) {
      const [x, y] = this.#toMap(tribe.campX, tribe.campZ);

      context.beginPath();
      context.arc(x, y, TRIBE_RADIUS * this.#scale, 0, Math.PI * 2);
      context.fillStyle = tribe.color;
      context.fill();
      context.lineWidth = OUTLINE_WIDTH * this.#scale;
      context.strokeStyle = TRIBE_OUTLINE;
      context.stroke();
    }
  }

  #drawView(context: CanvasRenderingContext2D, footprint: readonly GroundPoint[]): void {
    if (footprint.length === 0) {
      return;
    }

    context.beginPath();

    for (const point of footprint) {
      const [x, y] = this.#toMap(point.x, point.z);

      context.lineTo(x, y);
    }

    context.closePath();
    context.fillStyle = VIEW_FILL;
    context.fill();
    context.lineWidth = OUTLINE_WIDTH * this.#scale;
    context.strokeStyle = OUTLINE;
    context.stroke();
  }
}
