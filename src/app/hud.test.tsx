import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useInterfaceStore } from "../features/interface/interface-store.ts";
import { usePowerStore } from "../features/powers/power-store.ts";
import { createTribe, showWorld } from "../features/testing/world-fixtures.ts";
import { Hud } from "./hud.tsx";

const CLAN_NAMES = ["Bear", "Wolf", "Lynx", "Heron", "Otter", "Fox", "Elk", "Crane"];

function showManyTribes(): void {
  showWorld({ tribes: CLAN_NAMES.map((name, index) => createTribe({ id: index + 1, name: `${name} Clan` })) });
}

function islandAround(element: Element): HTMLElement {
  const island = element.closest(".island");

  if (!(island instanceof HTMLElement)) {
    throw new Error("The element is not on an island");
  }

  return island;
}

function shownIslands(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".island")].filter((island) => island.getClientRects().length > 0);
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

    if (island.scrollHeight > island.clientHeight + 1) {
      problems.push(`${nameOf(island)} clips its content`);
    }

    if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
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

    const panels = screen.getByRole("navigation", { name: "Panels" }).element();
    const island = islandAround(panels);

    expect(island.getBoundingClientRect().height).toBeGreaterThanOrEqual(panels.getBoundingClientRect().height);
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
