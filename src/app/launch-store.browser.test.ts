import { describe, expect, it } from "vitest";
import type { SavedWorldListing } from "../features/saves/save-database.ts";
import { useLaunchStore } from "./launch-store.ts";

describe("launch store", () => {
  it("starts from the options in the address", () => {
    const { launch } = useLaunchStore.getState();

    expect(launch.seed).toBeGreaterThanOrEqual(1);
    expect(launch.camera).toEqual({});
  });

  it("relaunches with the changes and a fresh camera, time and pace", () => {
    useLaunchStore.setState({
      launch: {
        camera: { distance: 90 },
        hours: 21,
        isPaused: true,
        name: "Mossholm",
        quality: "low",
        seed: 7,
        shape: "round",
        size: "large",
      },
    });

    useLaunchStore.getState().relaunch({ seed: 42 });

    expect(useLaunchStore.getState().launch).toEqual({
      camera: {},
      hours: null,
      isPaused: false,
      name: "Mossholm",
      quality: "low",
      seed: 42,
      shape: "round",
      size: "large",
    });
  });

  it("leaves the start screen once a world is chosen", () => {
    useLaunchStore.setState({ isChoosingWorld: true });

    useLaunchStore.getState().relaunch({ name: "Ashvale", seed: 42, shape: "square" });

    const { isChoosingWorld, launch } = useLaunchStore.getState();

    expect(isChoosingWorld).toBe(false);
    expect(launch).toMatchObject({ name: "Ashvale", seed: 42, shape: "square" });
  });

  it("continues a saved world from its listing without carrying the listing along", () => {
    useLaunchStore.setState({
      launch: {
        camera: {},
        hours: null,
        isPaused: false,
        name: "Mossholm",
        quality: "low",
        seed: 7,
        shape: "round",
        size: "normal",
      },
    });

    const listing: SavedWorldListing = {
      hasLandChanged: false,
      id: "old-ford",
      isLoadable: true,
      name: "Old Ford",
      savedAt: 1000,
      seed: 42,
      shape: "square",
      size: "small",
      summary: null,
    };

    useLaunchStore.getState().continueWorld("old-ford", listing);

    const { launch, worldId } = useLaunchStore.getState();

    expect(worldId).toBe("old-ford");
    expect(launch).toEqual({
      camera: {},
      hours: null,
      isPaused: false,
      name: "Old Ford",
      quality: "low",
      seed: 42,
      shape: "square",
      size: "small",
    });
  });

  it("writes the world into the address so a reload keeps it", () => {
    useLaunchStore.getState().relaunch({ name: "Old Ford", quality: "high", seed: 42, shape: "square", size: "small" });

    const parameters = new URLSearchParams(window.location.search);

    expect(parameters.get("name")).toBe("Old Ford");
    expect(parameters.get("seed")).toBe("42");
    expect(parameters.get("shape")).toBe("square");
    expect(parameters.get("size")).toBe("small");
    expect(parameters.get("quality")).toBe("high");
  });
});
