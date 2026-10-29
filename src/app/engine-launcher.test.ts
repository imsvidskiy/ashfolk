import { afterEach, describe, expect, it, vi } from "vitest";
import { useSavesStore } from "../features/saves/saves-store.ts";
import { type EngineStatus, reportGraphicsLost } from "./engine-launcher.ts";

const initialSaves = useSavesStore.getState();

function loseGraphics(isCurrent: boolean) {
  const engine = { graphicsLost: Promise.resolve(), stop: vi.fn<() => void>() };
  const saveNow = vi.fn(() => {
    return Promise.resolve("saved" as const);
  });
  const onStatus = vi.fn<(status: EngineStatus) => void>();

  useSavesStore.setState({ saveNow });
  reportGraphicsLost(
    engine,
    () => {
      return isCurrent;
    },
    onStatus
  );

  return { engine, onStatus, saveNow };
}

afterEach(() => {
  useSavesStore.setState(initialSaves, true);
});

describe("graphics loss", () => {
  it("stops the engine, saves and asks for a reload", async () => {
    const { engine, onStatus, saveNow } = loseGraphics(true);

    await engine.graphicsLost;

    expect(engine.stop).toHaveBeenCalledOnce();
    expect(saveNow).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenCalledWith({ kind: "graphicsLost", saved: saveNow.mock.results[0]?.value });
  });

  it("does nothing once the engine is gone", async () => {
    const { engine, onStatus, saveNow } = loseGraphics(false);

    await engine.graphicsLost;

    expect(engine.stop).not.toHaveBeenCalled();
    expect(saveNow).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
  });
});
