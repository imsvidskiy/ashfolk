import { describe, expect, it, vi } from "vitest";
import { SpringView } from "./spring-view.ts";

describe("spring view", () => {
  it("frees its material with the mesh", () => {
    const view = new SpringView();
    const disposal = vi.spyOn(view.mesh.material, "dispose");

    view.dispose();

    expect(disposal).toHaveBeenCalledOnce();
  });
});
