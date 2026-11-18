import type { RenderTarget } from "three/webgpu";
import { expect, it as test, vi } from "vitest";
import { Ground } from "../../content/grounds.ts";
import { GROUND_CHANNELS, GroundChannel } from "../../world/agent-buffers.ts";
import { createGraphics } from "../create-graphics.ts";
import { RENDER_QUALITY } from "../render-quality.ts";
import { createVegetatedMirror } from "../testing/vegetated-mirror.ts";
import { GroundAlbedo } from "./ground-albedo.ts";

test("repaints the dirty rows and their farm neighbors while preserving the rest of the island", async () => {
  const mirror = createVegetatedMirror();
  const { cellsPerSide } = mirror.grid;
  const { renderer } = await createGraphics(document.createElement("canvas"), RENDER_QUALITY.low);
  const local = new GroundAlbedo(mirror);
  const whole = new GroundAlbedo(mirror);
  const targets = vi.spyOn(renderer, "setRenderTarget");

  function targetOf(albedo: GroundAlbedo): RenderTarget {
    for (const [target] of targets.mock.calls) {
      if (target?.texture === albedo.texture) {
        return target;
      }
    }

    throw new Error("The ground was not painted");
  }

  async function pixels(albedo: GroundAlbedo): Promise<Uint8Array> {
    const read = await renderer.readRenderTargetPixelsAsync(targetOf(albedo), 0, 0, cellsPerSide, cellsPerSide);

    return new Uint8Array(read.buffer, read.byteOffset, read.byteLength);
  }

  function paintCell(column: number, row: number, ground: number): void {
    const cell = mirror.grid.index(column, row);

    mirror.ground[cell * GROUND_CHANNELS + GroundChannel.Ground] = ground;
  }

  try {
    for (let row = 14; row <= 18; row += 1) {
      paintCell(10, row, Ground.Farm);
    }

    local.paint(renderer, 0.2, []);
    const initial = await pixels(local);

    paintCell(10, 16, Ground.Snow);
    local.groundChanged();
    local.paint(renderer, 0.2, [{ firstRow: 16, rowCount: 1 }]);
    whole.paint(renderer, 0.2, []);

    const partial = await pixels(local);
    expect(partial).toEqual(await pixels(whole));
    expect(partial).not.toEqual(initial);
    expect(renderer.getRenderTarget()).toBeNull();
    expect(renderer.autoClear).toBe(true);

    local.paint(renderer, 1.8, [{ firstRow: 63, rowCount: 1 }]);
    whole.paint(renderer, 1.8, []);
    const seasonal = await pixels(local);

    expect(seasonal).toEqual(await pixels(whole));
    expect(seasonal).not.toEqual(partial);
  } finally {
    local.dispose();
    whole.dispose();
    renderer.dispose();
  }
});
