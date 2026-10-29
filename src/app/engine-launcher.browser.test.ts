import { describe, expect, it } from "vitest";
import { worldSourceFor } from "./engine-launcher.ts";
import { createWorldId } from "./launch-options.ts";

describe("engine launcher", () => {
  it("grows a new world on the grid of the chosen size", async () => {
    const source = await worldSourceFor(
      {
        camera: {},
        hours: null,
        isPaused: false,
        name: "Mossholm",
        quality: "low",
        seed: 7,
        shape: "round",
        size: "large",
      },
      createWorldId()
    );

    expect(source).toMatchObject({
      kind: "new",
      request: { options: { dimensions: { cellSize: 10, cellsPerSide: 768 }, shape: "round" }, seed: 7 },
    });
  });
});
