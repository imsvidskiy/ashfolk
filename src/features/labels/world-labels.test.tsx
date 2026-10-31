import { describe, expect, it, onTestFinished } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { Landmark } from "../../game/landmarks.ts";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { startTestEngine } from "../testing/engine-fixtures.ts";
import { createRaid, createRelation, createTribe, showWorld } from "../testing/world-fixtures.ts";
import { WorldLabels } from "./world-labels.tsx";

const PEAK: Landmark = { detail: "1460 m", id: "peak", kind: "peak", lift: 30, name: "Graycrown", x: 40, z: -20 };
const LAKE: Landmark = { detail: null, id: "lake-3", kind: "lake", lift: 4, name: "Mirror Lake", x: -300, z: 90 };
const POND: Landmark = { detail: null, id: "pond-5", kind: "pond", lift: 4, name: "Frog Pool", x: -280, z: 95 };
const RING: Landmark = {
  detail: "Stone circle",
  id: "monument-2",
  kind: "monument",
  lift: 9,
  name: "Whispering Ring",
  x: 210,
  z: 65,
};
const ON_SCREEN = { left: 240, top: 320 };
const ADDRESS_BAR_HEIGHT = 56;

describe("world labels", () => {
  it("shows nothing before the game runs", async () => {
    showWorld();

    const screen = await render(<WorldLabels />);

    await expect.element(screen.getByRole("list", { name: "Tribes" })).not.toBeInTheDocument();
  });

  it("pins a banner over every tribe camp", async () => {
    const { placeLabel, renderFrame } = await startTestEngine();

    placeLabel.mockReturnValue(ON_SCREEN);
    showWorld({ tribes: [createTribe({ campX: 120, campZ: -40, eraName: "Hunters", id: 3, name: "Fox Clan" })] });

    const screen = await render(<WorldLabels />);

    renderFrame();

    const banner = screen.getByRole("button", { exact: false, name: "Fox Clan" });

    await expect.element(banner).toBeVisible();
    await expect.element(banner.getByText("Hunters", { exact: true })).toBeVisible();
    expect(placeLabel).toHaveBeenCalledWith(120, -40, 18);
    expect(banner.element().closest("li")?.style.transform).toBe(
      "translate3d(240px, 320px, 0px) translate(-50%, -100%)"
    );
  });

  it("marks the banners of tribes at war", async () => {
    const { placeLabel, renderFrame } = await startTestEngine();

    placeLabel.mockReturnValue(ON_SCREEN);
    showWorld({
      rivalry: { raids: [], relations: [createRelation({ firstId: 1, secondId: 2, stance: "hostile" })] },
      tribes: [
        createTribe({ id: 1, name: "Bear Clan" }),
        createTribe({ id: 2, name: "Wolf Clan" }),
        createTribe({ id: 3, name: "Elk Clan" }),
      ],
    });

    const screen = await render(<WorldLabels />);

    renderFrame();

    await expect
      .element(screen.getByRole("button", { exact: false, name: "Bear Clan" }).getByRole("img", { name: "In a feud" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { exact: false, name: "Elk Clan" }).getByRole("img", { name: "In a feud" }))
      .not.toBeInTheDocument();
  });

  it("marks a raid under way over a feud on both sides of it", async () => {
    const { placeLabel, renderFrame } = await startTestEngine();

    placeLabel.mockReturnValue(ON_SCREEN);
    showWorld({
      rivalry: {
        raids: [createRaid({ attackerId: 2, defenderId: 1 })],
        relations: [createRelation({ firstId: 1, secondId: 2, stance: "hostile" })],
      },
    });

    const screen = await render(<WorldLabels />);

    renderFrame();

    await expect
      .element(
        screen.getByRole("button", { exact: false, name: "Bear Clan" }).getByRole("img", { name: "Raid under way" })
      )
      .toBeVisible();
    await expect
      .element(
        screen.getByRole("button", { exact: false, name: "Wolf Clan" }).getByRole("img", { name: "Raid under way" })
      )
      .toBeVisible();
  });

  it("hides the banners the engine cannot place", async () => {
    const { renderFrame } = await startTestEngine();

    showWorld();

    const screen = await render(<WorldLabels />);

    renderFrame();

    const banner = screen.getByRole("button", { exact: false, includeHidden: true, name: "Bear Clan" });

    await expect.element(banner).toBeInTheDocument();
    await expect.element(banner).not.toBeVisible();
  });

  it("hides the banners that would slide under the top bar", async () => {
    const { placeLabel, renderFrame } = await startTestEngine();

    placeLabel.mockReturnValue({ left: 240, top: 40 });
    showWorld();

    const screen = await render(<WorldLabels />);

    renderFrame();

    const banner = screen.getByRole("button", { exact: false, includeHidden: true, name: "Bear Clan" });

    await expect.element(banner).toBeInTheDocument();
    await expect.element(banner).not.toBeVisible();
  });

  it("flies the camera to a tribe when its banner is clicked", async () => {
    const { focusOn, placeLabel, renderFrame, send } = await startTestEngine();

    placeLabel.mockReturnValue(ON_SCREEN);
    showWorld({ tribes: [createTribe({ campX: 120, campZ: -40, id: 3, name: "Fox Clan" })] });

    const screen = await render(<WorldLabels />);

    renderFrame();
    await screen.getByRole("button", { exact: false, name: "Fox Clan" }).click();

    expect(focusOn).toHaveBeenCalledExactlyOnceWith(120, -40, 260);
    expect(send).toHaveBeenCalledExactlyOnceWith({ selection: { id: 3, kind: "tribe" }, type: "setSelection" });
  });

  it("marks the banner of the selected tribe", async () => {
    const { placeLabel, renderFrame } = await startTestEngine();

    const bearClan = createTribe({ id: 1, name: "Bear Clan" });

    placeLabel.mockReturnValue(ON_SCREEN);
    showWorld({
      inspection: { kind: "tribe", summary: bearClan },
      tribes: [bearClan, createTribe({ id: 2, name: "Wolf Clan" })],
    });

    const screen = await render(<WorldLabels />);

    renderFrame();

    await expect
      .element(screen.getByRole("button", { exact: false, name: "Bear Clan" }))
      .toHaveAttribute("aria-current", "true");
    await expect
      .element(screen.getByRole("button", { exact: false, name: "Wolf Clan" }))
      .toHaveAttribute("aria-current", "false");
  });

  it("drops the era from the banners while the camera is far away", async () => {
    const { placeLabel, renderFrame } = await startTestEngine({ cameraDistance: 3200 });

    placeLabel.mockReturnValue(ON_SCREEN);
    showWorld({ tribes: [createTribe({ eraName: "Hunters", name: "Fox Clan" })] });

    const screen = await render(<WorldLabels />);

    renderFrame();

    const banner = screen.getByRole("button", { exact: false, name: "Fox Clan" });

    await expect.element(banner).toBeVisible();
    await expect.element(banner.getByText("Hunters", { exact: true })).not.toBeVisible();
  });

  it("names the peak with its height and the lakes", async () => {
    const { placeLabel, renderFrame } = await startTestEngine({ landmarks: [PEAK, LAKE] });

    placeLabel.mockImplementation((x) => {
      return { left: ON_SCREEN.left + x, top: ON_SCREEN.top };
    });
    showWorld({ tribes: [] });

    const screen = await render(<WorldLabels />);

    renderFrame();

    const places = screen.getByRole("list", { name: "Places" });

    await expect.element(places.getByText("Graycrown", { exact: true })).toBeVisible();
    await expect.element(places.getByText("1460 m", { exact: true })).toBeVisible();
    await expect.element(places.getByText("Mirror Lake", { exact: true })).toBeVisible();
    expect(placeLabel).toHaveBeenCalledWith(40, -20, 30);
    expect(placeLabel).toHaveBeenCalledWith(-300, 90, 4);
  });

  it("names the monuments and what they are", async () => {
    const { placeLabel, renderFrame } = await startTestEngine({ landmarks: [RING] });

    placeLabel.mockReturnValue(ON_SCREEN);
    showWorld({ tribes: [] });

    const screen = await render(<WorldLabels />);

    renderFrame();

    const places = screen.getByRole("list", { name: "Places" });

    await expect.element(places.getByText("Whispering Ring", { exact: true })).toBeVisible();
    await expect.element(places.getByText("Stone circle", { exact: true })).toBeVisible();
    expect(placeLabel).toHaveBeenCalledWith(210, 65, 9);
  });

  it("gives way to a tribe banner that would cover a place name", async () => {
    const { placeLabel, renderFrame } = await startTestEngine({ landmarks: [LAKE] });

    placeLabel.mockReturnValue(ON_SCREEN);
    showWorld({ tribes: [createTribe({ name: "Fox Clan" })] });

    const screen = await render(<WorldLabels />);

    renderFrame();

    await expect.element(screen.getByRole("button", { exact: false, name: "Fox Clan" })).toBeVisible();
    await expect.element(screen.getByText("Mirror Lake", { exact: true })).not.toBeVisible();
  });

  it("lets a pond name give way to a lake name it would cover", async () => {
    const { placeLabel, renderFrame } = await startTestEngine({ landmarks: [POND, LAKE] });

    placeLabel.mockReturnValue(ON_SCREEN);
    showWorld({ tribes: [] });

    const screen = await render(<WorldLabels />);

    renderFrame();

    await expect.element(screen.getByText("Mirror Lake", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Frog Pool", { exact: true })).not.toBeVisible();
  });

  it("places the labels again only once the camera moves", async () => {
    const { engine, placeLabel, renderFrame } = await startTestEngine({ landmarks: [PEAK] });

    placeLabel.mockReturnValue(ON_SCREEN);
    showWorld({ tribes: [] });

    const screen = await render(<WorldLabels />);

    renderFrame();
    await expect.element(screen.getByText("Graycrown", { exact: true })).toBeVisible();
    placeLabel.mockClear();
    renderFrame();

    expect(placeLabel).not.toHaveBeenCalled();

    engine.camera.camera.matrixWorld.setPosition(10, 120, 40);
    renderFrame();

    expect(placeLabel).toHaveBeenCalledExactlyOnceWith(40, -20, 30);
  });

  it("places the labels again once the ground changes", async () => {
    const { engine, placeLabel, renderFrame } = await startTestEngine({ landmarks: [PEAK] });

    placeLabel.mockReturnValue(ON_SCREEN);
    showWorld({ tribes: [] });

    const screen = await render(<WorldLabels />);

    renderFrame();
    await expect.element(screen.getByText("Graycrown", { exact: true })).toBeVisible();
    placeLabel.mockClear();
    engine.session.mirror.landVersion += 1;
    renderFrame();

    expect(placeLabel).toHaveBeenCalledExactlyOnceWith(40, -20, 30);
  });

  it("places the labels again once only the window height changes", async () => {
    const { placeLabel, renderFrame } = await startTestEngine({ landmarks: [PEAK] });
    const { innerHeight, innerWidth } = window;

    onTestFinished(async () => {
      await page.viewport(innerWidth, innerHeight);
    });
    placeLabel.mockReturnValue(ON_SCREEN);
    showWorld({ tribes: [] });

    const screen = await render(<WorldLabels />);

    renderFrame();
    await expect.element(screen.getByText("Graycrown", { exact: true })).toBeVisible();
    placeLabel.mockClear();
    await page.viewport(innerWidth, innerHeight - ADDRESS_BAR_HEIGHT);
    renderFrame();

    expect(placeLabel).toHaveBeenCalledExactlyOnceWith(40, -20, 30);
  });

  it("renames the places when a frame brings new landmarks", async () => {
    const { engine, placeLabel, setLandmarks } = await startTestEngine({ landmarks: [PEAK, LAKE] });

    placeLabel.mockReturnValue(ON_SCREEN);
    showWorld({ tribes: [] });

    const screen = await render(<WorldLabels />);

    const places = screen.getByRole("list", { name: "Places" });

    await expect.element(places.getByText("Mirror Lake", { exact: true })).toBeInTheDocument();
    setLandmarks([{ ...PEAK, detail: "2110 m", x: -80, z: 300 }]);
    engine.session.update(1);
    await engine.session.whenIdle();

    await expect.element(places.getByText("2110 m", { exact: true })).toBeInTheDocument();
    await expect.element(places.getByText("Mirror Lake", { exact: true })).not.toBeInTheDocument();
  });

  it("stays away while the labels are turned off", async () => {
    await startTestEngine({ landmarks: [PEAK] });

    useInterfaceStore.setState({ areLabelsShown: false });
    showWorld();

    const screen = await render(<WorldLabels />);

    await expect.element(screen.getByRole("list", { name: "Places" })).not.toBeInTheDocument();
    await expect.element(screen.getByRole("list", { name: "Tribes" })).not.toBeInTheDocument();
  });
});
