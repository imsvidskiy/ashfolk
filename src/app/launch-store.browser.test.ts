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

  it("corrects the display and address without starting the engine a second time", () => {
    const initial = { name: "Wrong island", seed: 2, shape: "square", size: "large" } as const;
    const saved = { name: "Remembered Coast", seed: 7, shape: "round", size: "small" } as const;

    useLaunchStore.getState().continueWorld("remembered-coast", initial);
    window.history.replaceState(null, "", "?world=remembered-coast&camera=0,0,400,1,0&paused=1");

    const { request, restoreChoice } = useLaunchStore.getState();

    restoreChoice(request, saved);

    expect(useLaunchStore.getState().launch).toMatchObject(saved);
    expect(useLaunchStore.getState().request).toBe(request);

    const address = new URLSearchParams(window.location.search);

    expect(address.get("name")).toBe(saved.name);
    expect(address.get("seed")).toBe("7");
    expect(address.get("camera")).toBe("0,0,400,1,0");
    expect(address.get("paused")).toBe("1");
  });

  it("ignores late storage reads from a previous launch", () => {
    const store = useLaunchStore.getState();

    store.continueWorld("first", store.launch);

    const { request } = useLaunchStore.getState();

    store.createWorld({ ...store.launch, name: "Second" });
    store.restoreChoice(request, { ...store.launch, name: "First" });

    expect(useLaunchStore.getState().launch.name).toBe("Second");
    expect(new URLSearchParams(window.location.search).get("name")).toBe("Second");
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
