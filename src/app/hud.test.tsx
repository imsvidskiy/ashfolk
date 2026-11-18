import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useInterfaceStore } from "../features/interface/interface-store.ts";
import { usePowerStore } from "../features/powers/power-store.ts";
import { startTestEngine } from "../features/testing/engine-fixtures.ts";
import { createTribe, showWorld } from "../features/testing/world-fixtures.ts";
import { Hud } from "./hud.tsx";

const CLAN_NAMES = ["Bear", "Wolf", "Lynx", "Heron", "Otter", "Fox", "Elk", "Crane"];

function showManyTribes(): void {
  showWorld({
    tribes: CLAN_NAMES.map((name, index) => {
      return createTribe({ id: index + 1, name: `${name} Clan` });
    }),
  });
}

function islandAround(element: Element): HTMLElement {
  const island = element.closest(".island");

  if (!(island instanceof HTMLElement)) {
    throw new Error("The element is not on an island");
  }

  return island;
}

function shownIslands(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".island")].filter((island) => {
    return island.getClientRects().length > 0;
  });
}

function overlaps(first: DOMRect, second: DOMRect): boolean {
  const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
  const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);

  return width > 1 && height > 1;
}

function nameOf(island: HTMLElement): string {
  const labelled = island.querySelector("[aria-label]");

  return labelled === null ? island.className : String(labelled.getAttribute("aria-label"));
}

function brokenIslands(): string[] {
  const islands = shownIslands();
  const problems: string[] = [];

  for (const island of islands) {
    const bounds = island.getBoundingClientRect();

    if (island.scrollHeight > island.clientHeight + 1 && getComputedStyle(island).overflowY !== "auto") {
      problems.push(`${nameOf(island)} clips its content`);
    }

    if (bounds.left < 0 || bounds.right > window.innerWidth || bounds.top < 0 || bounds.bottom > window.innerHeight) {
      problems.push(`${nameOf(island)} leaves the window`);
    }
  }

  for (const [index, island] of islands.entries()) {
    for (const other of islands.slice(index + 1)) {
      if (overlaps(island.getBoundingClientRect(), other.getBoundingClientRect())) {
        problems.push(`${nameOf(island)} overlaps ${nameOf(other)}`);
      }
    }
  }

  return problems;
}

async function openJournalWithMeteor(width: number, height: number) {
  await page.viewport(width, height);

  showManyTribes();
  useInterfaceStore.getState().openJournal("tribes");
  usePowerStore.getState().selectPower("meteor");

  return render(<Hud />);
}

describe("wide hud", () => {
  it("keeps the panel buttons whole with a long journal and the power settings open", async () => {
    const screen = await openJournalWithMeteor(1024, 640);

    await expect.element(screen.getByRole("region", { name: "Meteor settings" })).toBeVisible();

    const panels = screen.getByRole("navigation", { name: "Panels" });
    const worldViews = islandAround(
      panels.getByRole("group", { name: "World views" }).element()
    ).getBoundingClientRect();
    const gameControls = islandAround(
      panels.getByRole("group", { name: "Game controls" }).element()
    ).getBoundingClientRect();

    expect(worldViews.height).toBe(gameControls.height);
    expect(worldViews.right).toBeLessThan(gameControls.left);
    expect(brokenIslands()).toEqual([]);
  });

  it("scrolls the journal inside its list and keeps the power settings whole at a tall size", async () => {
    const screen = await openJournalWithMeteor(1440, 900);

    await expect.element(screen.getByRole("region", { name: "Meteor settings" })).toBeVisible();

    const settings = islandAround(screen.getByRole("region", { name: "Meteor settings" }).element());
    const crater = screen.getByRole("slider", { name: "Crater" }).element().getBoundingClientRect();
    const list = screen.getByRole("tabpanel").element().querySelector(".scroll-fade");

    expect(list).not.toBeNull();
    expect(list === null ? 0 : list.scrollHeight - list.clientHeight).toBeGreaterThan(0);
    expect(crater.bottom).toBeLessThanOrEqual(settings.getBoundingClientRect().bottom);
    expect(brokenIslands()).toEqual([]);
  });
});

describe("short hud", () => {
  it("keeps every speed and the whole clock visible on a narrow phone", async () => {
    await page.viewport(320, 680);

    const { send } = await startTestEngine();

    const screen = await render(<Hud />);

    showWorld({ isPaused: true, speed: 2 });

    await expect.element(screen.getByRole("button", { name: "Resume" })).toBeVisible();

    const speed = screen.getByRole("combobox", { name: "Game speed" });
    const pause = screen.getByRole("button", { name: "Resume" }).element().getBoundingClientRect();
    const clock = screen.getByText("10:00").element().getBoundingClientRect();

    expect(clock.right).toBeLessThan(pause.left);
    await expect.element(speed.getByRole("option", { name: "16×" })).toBeInTheDocument();

    await speed.selectOptions("4");

    expect(send).toHaveBeenCalledWith({ speed: 4, type: "setSpeed" });
    expect(send).toHaveBeenCalledWith({ isPaused: false, type: "setPaused" });
    expect(brokenIslands()).toEqual([]);
  });

  it.each([
    [320, 568],
    [390, 844],
    [667, 375],
    [844, 390],
  ])("keeps the map, guide, powers and expanded controls usable at %i by %i", async (width, height) => {
    await page.viewport(width, height);
    await startTestEngine();

    showManyTribes();
    useInterfaceStore.setState({ isMapOpen: true });

    const screen = await render(<Hud />);
    const dock = screen.getByRole("toolbar", { name: "Powers" });
    const map = screen.getByRole("img", { name: "Map of the island. Click to move the camera." });
    const guide = screen.getByRole("region", { name: "Island guide" });

    await dock.getByRole("button", { exact: true, name: "Meteor" }).click();
    await screen.getByRole("button", { exact: true, name: "Meteor shower" }).click();

    const settings = screen.getByRole("region", { name: "Meteor shower settings" });

    await settings.getByRole("button", { name: "Adjust settings" }).click();

    await expect.element(map).toBeVisible();
    await expect.element(guide).toBeVisible();
    expect(brokenIslands()).toEqual([]);

    const slider = settings.getByRole("slider").last().element();

    slider.scrollIntoView({ block: "nearest" });
    const sliderBounds = slider.getBoundingClientRect();
    const settingsBounds = settings.element().getBoundingClientRect();

    expect(sliderBounds.top).toBeGreaterThanOrEqual(settingsBounds.top);
    expect(sliderBounds.bottom).toBeLessThanOrEqual(settingsBounds.bottom);

    const lesson = guide.getByRole("button", { exact: false, name: "First island" });

    if (lesson.element().getAttribute("aria-expanded") === "false") {
      await lesson.click();
    }

    await guide.getByRole("button", { name: "Skip guide" }).click();
    await expect.element(guide).not.toBeInTheDocument();
  });

  it("switches to the compact bar when the window is too short for side panels", async () => {
    await page.viewport(844, 390);

    showWorld();
    usePowerStore.getState().selectPower("meteor");

    const screen = await render(<Hud />);

    await expect.element(screen.getByRole("button", { exact: true, name: "Menu" })).toBeVisible();
    await expect.element(screen.getByRole("navigation", { name: "Panels" })).not.toBeInTheDocument();
    expect(brokenIslands()).toEqual([]);
  });
});

describe("filmed hud", () => {
  it("hides the interface and the labels for a clean frame", async () => {
    await page.viewport(1440, 900);

    showWorld();

    const { engine } = await startTestEngine();

    const screen = await render(<Hud />);

    await expect.element(screen.getByRole("navigation", { name: "Panels" })).toBeVisible();

    engine.filming.set({ areMarkersHidden: true, isInterfaceHidden: true });

    await expect.element(screen.getByRole("navigation", { name: "Panels" })).not.toBeInTheDocument();
    await expect.element(screen.getByRole("list", { name: "Places" })).not.toBeInTheDocument();
    await expect.element(screen.getByText("Interface hidden. Press H to show it.")).toBeVisible();
    expect(shownIslands()).toHaveLength(1);
  });

  it("hides the journal sheet of a compact view, which sits outside the hud", async () => {
    await page.viewport(390, 844);

    showManyTribes();
    useInterfaceStore.getState().openJournal("tribes");

    const { engine } = await startTestEngine();

    const screen = await render(<Hud />);

    await expect.element(screen.getByRole("dialog", { name: "Journal" })).toBeVisible();

    engine.filming.set({ isInterfaceHidden: true });

    await expect.element(screen.getByRole("dialog", { name: "Journal" })).not.toBeInTheDocument();
    await expect.element(screen.getByRole("button", { exact: true, name: "Menu" })).not.toBeInTheDocument();
  });
});
