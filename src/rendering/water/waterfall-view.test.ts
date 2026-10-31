import { describe, expect, it, vi } from "vitest";
import { WaterfallView } from "./waterfall-view.ts";

describe("waterfall view", () => {
  it("frees its material with the mesh", () => {
    const view = new WaterfallView();
    const disposal = vi.spyOn(view.mesh.material, "dispose");

    view.dispose();

    expect(disposal).toHaveBeenCalledOnce();
  });
});
