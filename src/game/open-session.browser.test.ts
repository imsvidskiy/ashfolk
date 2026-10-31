import { describe, expect, it, onTestFinished, vi } from "vitest";
import { ignore } from "../shared/ignore.ts";
import { openSession, type WorldSource } from "./open-session.ts";

const SMALL_WORLD: WorldSource = {
  kind: "new",
  request: { options: { dimensions: { cellSize: 10, cellsPerSide: 96 }, erosionStrength: 1, shape: "round" }, seed: 3 },
};

describe("opening a session", () => {
  it("grows a new world in a worker", async () => {
    const session = await openSession(SMALL_WORLD, ignore, new AbortController().signal);

    onTestFinished(() => {
      session.close();
    });

    expect(session.mirror.grid.cellsPerSide).toBe(96);
    expect(session.status.kind).toBe("running");
  });

  it("stops the worker when the opening is canceled", async () => {
    const terminate = vi.spyOn(Worker.prototype, "terminate");
    const opening = new AbortController();

    const session = openSession(SMALL_WORLD, ignore, opening.signal);

    opening.abort();

    await expect(session).rejects.toThrow("canceled");
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("starts no worker once the opening is canceled", async () => {
    const terminate = vi.spyOn(Worker.prototype, "terminate");
    const opening = new AbortController();

    opening.abort();

    await expect(openSession(SMALL_WORLD, ignore, opening.signal)).rejects.toThrow();
    expect(terminate).not.toHaveBeenCalled();
  });
});
