import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { createCalendar, createWeather, showWorld } from "../testing/world-fixtures.ts";
import { useInterfaceStore } from "./interface-store.ts";
import { CompactTopBar, PanelBar, StatusCard } from "./top-bar.tsx";

function showMorning(): void {
  showWorld({
    calendar: createCalendar({ hours: 9.5 }),
    isPaused: true,
    weather: createWeather({ name: "Clear" }),
  });
}

describe("status card and top bar", () => {
  it("holds the status and the time controls in one card", async () => {
    showMorning();

    const screen = await render(<StatusCard />);

    const card = screen.getByRole("banner");

    await expect.element(card.getByText("09:30")).toBeVisible();
    await expect.element(card.getByText("Clear")).toBeVisible();
    await expect.element(card.getByText("14", { exact: true })).toBeVisible();
    await expect.element(card.getByRole("button", { exact: true, name: "Resume" })).toBeVisible();
    await expect.element(card.getByRole("group", { name: "Game speed" })).toBeVisible();
  });

  it("groups labelled world views apart from game controls and marks the active view", async () => {
    useInterfaceStore.setState({ isJournalOpen: false, isMapOpen: false });

    const screen = await render(<PanelBar />);

    const panels = screen.getByRole("navigation", { name: "Panels" });
    const views = panels.getByRole("group", { name: "World views" });
    const controls = panels.getByRole("group", { name: "Game controls" });

    await expect.element(views.getByText("Journal")).toBeVisible();
    await expect.element(views.getByText("Map")).toBeVisible();
    await views.getByRole("button", { name: "Journal", pressed: false }).click();
    await expect.element(views.getByRole("button", { name: "Journal", pressed: true })).toBeVisible();
    await expect.element(controls.getByRole("button", { name: "Settings" })).toBeVisible();
    await expect.element(screen.getByRole("banner")).not.toBeInTheDocument();
  });

  it("keeps only the clock, the time controls and the menu on a phone", async () => {
    showMorning();

    const screen = await render(<CompactTopBar />);

    const bar = screen.getByRole("banner");

    await expect.element(bar.getByText("09:30")).toBeVisible();
    await expect.element(bar.getByRole("button", { exact: true, name: "Resume" })).toBeVisible();
    await expect.element(bar.getByRole("button", { exact: true, name: "Menu" })).toBeVisible();
    await expect.element(bar.getByText("Clear")).not.toBeInTheDocument();
  });
});
