import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { GroundPoint } from "../../game/camera/god-camera.ts";
import { paintMinimapTerrain } from "../../rendering/minimap-image.ts";
import { startTestEngine } from "../testing/engine-fixtures.ts";
import { createFrame, createTribe } from "../testing/world-fixtures.ts";
import { MinimapPainter } from "./minimap-painter.ts";

const FRAME_MILLISECONDS = 16;
const CAMP_COLOR = [32, 80, 224, 255];
const OPAQUE = 255;
const BOTTOM_MARGIN = 4;
const VIEW: readonly GroundPoint[] = [
  { x: -50, z: -50 },
  { x: 50, z: -50 },
  { x: 50, z: 50 },
  { x: -50, z: 50 },
];

async function startPainter() {
  const { engine } = await startTestEngine();

  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  engine.session.mirror.frame = createFrame({ tribes: [createTribe({ campX: 0, campZ: 0, color: "#2050e0" })] });

  const canvas = document.createElement("canvas");
  const painter = new MinimapPainter(canvas, engine);
  const context = canvas.getContext("2d");

  if (context === null) {
    throw new Error("Expected a 2D canvas");
  }

  const clearRect = vi.spyOn(context, "clearRect");

  painter.start();
  onTestFinished(() => {
    painter.stop();
  });

  return { canvas, clearRect, context, engine };
}

describe("minimap painter", () => {
  it("marks each tribe camp in its color", async () => {
    const { canvas, context } = await startPainter();

    vi.advanceTimersByTime(10 * FRAME_MILLISECONDS);

    const center = Math.floor(canvas.width / 2);

    expect([...context.getImageData(center, center, 1, 1).data]).toEqual(CAMP_COLOR);
  });

  it("paints the terrain down to the bottom rows", async () => {
    const { canvas, context, engine } = await startPainter();

    vi.advanceTimersByTime(10 * FRAME_MILLISECONDS);

    const { height, width } = canvas;
    const row = height - BOTTOM_MARGIN;
    const offset = (row * width + BOTTOM_MARGIN) * 4;
    const land = [...paintMinimapTerrain(engine.session.mirror, width).data.subarray(offset, offset + 4)];

    expect(land[3]).toBe(OPAQUE);
    expect([...context.getImageData(BOTTOM_MARGIN, row, 1, 1).data]).toEqual(land);
  });

  it("paints again only once a new frame arrives", async () => {
    const { clearRect, engine } = await startPainter();

    vi.advanceTimersByTime(40 * FRAME_MILLISECONDS);

    expect(clearRect).toHaveBeenCalledOnce();

    engine.session.mirror.frame = createFrame();
    vi.advanceTimersByTime(10 * FRAME_MILLISECONDS);

    expect(clearRect).toHaveBeenCalledTimes(2);
  });

  it("paints again once the camera moves", async () => {
    const { clearRect, engine } = await startPainter();

    const groundFootprint = vi.spyOn(engine.camera, "groundFootprint");

    vi.advanceTimersByTime(40 * FRAME_MILLISECONDS);

    expect(clearRect).toHaveBeenCalledOnce();

    groundFootprint.mockReturnValue(VIEW);
    vi.advanceTimersByTime(10 * FRAME_MILLISECONDS);

    expect(clearRect).toHaveBeenCalledTimes(2);
  });

  it("paints the terrain again once the land changes", async () => {
    const { clearRect, engine } = await startPainter();

    vi.advanceTimersByTime(40 * FRAME_MILLISECONDS);

    expect(clearRect).toHaveBeenCalledOnce();

    engine.session.mirror.landVersion += 1;
    vi.advanceTimersByTime(70 * FRAME_MILLISECONDS);

    expect(clearRect).toHaveBeenCalledTimes(2);
  });
});
