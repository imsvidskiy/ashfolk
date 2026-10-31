import { describe, expect, it, onTestFinished, vi } from "vitest";
import { startTestEngine } from "../testing/engine-fixtures.ts";
import { createFrame, createTribe } from "../testing/world-fixtures.ts";
import { MinimapPainter } from "./minimap-painter.ts";

const FRAME_MILLISECONDS = 16;
const CAMP_COLOR = [32, 80, 224, 255];

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

  it("paints again only once a new frame arrives", async () => {
    const { clearRect, engine } = await startPainter();

    vi.advanceTimersByTime(40 * FRAME_MILLISECONDS);

    expect(clearRect).toHaveBeenCalledOnce();

    engine.session.mirror.frame = createFrame();
    vi.advanceTimersByTime(10 * FRAME_MILLISECONDS);

    expect(clearRect).toHaveBeenCalledTimes(2);
  });
});
