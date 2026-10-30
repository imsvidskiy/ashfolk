import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { TribeInspection } from "../../simulation/inspection.ts";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { startTestEngine } from "../testing/engine-fixtures.ts";
import { createAnimalInspection, createTribe, showWorld } from "../testing/world-fixtures.ts";
import { SidePanel } from "./side-panel.tsx";

const BEAR_CLAN: TribeInspection = { kind: "tribe", summary: createTribe() };

describe("side panel", () => {
  it("stays hidden while the journal is closed and nothing is selected", async () => {
    showWorld();

    const screen = await render(<SidePanel />);

    expect(screen.container).toBeEmptyDOMElement();
  });

  it("shows the journal with its tabs when opened", async () => {
    showWorld();
    useInterfaceStore.getState().openJournal("tribes");

    const screen = await render(<SidePanel />);

    await expect.element(screen.getByRole("heading", { level: 2, name: "Journal" })).toBeVisible();
    await expect.element(screen.getByRole("tablist", { name: "Journal" })).toBeVisible();
    await expect.element(screen.getByRole("button", { exact: false, name: "Bear Clan" })).toBeVisible();
  });

  it("closes the journal from its close button", async () => {
    showWorld();
    useInterfaceStore.getState().openJournal("tribes");

    const screen = await render(<SidePanel />);

    await screen.getByRole("button", { exact: true, name: "Close the journal" }).click();

    expect(useInterfaceStore.getState().isJournalOpen).toBe(false);
    await expect.element(screen.getByRole("heading", { level: 2, name: "Journal" })).not.toBeInTheDocument();
  });

  it("shows only the card when something is selected on the island", async () => {
    showWorld({ inspection: createAnimalInspection() });

    const screen = await render(<SidePanel />);

    await expect.element(screen.getByRole("region", { name: "Selection details" })).toBeVisible();
    await expect.element(screen.getByRole("heading", { level: 2, name: "Deer" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Back to the journal" })).not.toBeInTheDocument();
    await expect.element(screen.getByRole("region", { name: "Journal" })).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    showWorld();
    useInterfaceStore.getState().openJournal("tribes");

    const screen = await render(<SidePanel />);

    await expect.element(screen.getByRole("heading", { level: 2, name: "Journal" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");

    expect(useInterfaceStore.getState().isJournalOpen).toBe(false);
  });
});

describe("side panel in a running game", () => {
  it("opens a tribe from the journal and goes back to the list where it was", async () => {
    const { clearSelection, send } = await startTestEngine();

    showWorld();
    useInterfaceStore.getState().openJournal("tribes");

    const screen = await render(<SidePanel />);

    const bearClan = screen.getByRole("button", { exact: false, name: "Bear Clan" });

    await bearClan.click();

    expect(send).toHaveBeenCalledWith({ selection: { id: 1, kind: "tribe" }, type: "setSelection" });

    showWorld({ inspection: BEAR_CLAN });

    const card = screen.getByRole("region", { name: "Selection details" });

    await expect.element(card).toBeVisible();
    await expect.element(card.getByRole("heading", { level: 2, name: "Bear Clan" })).toHaveFocus();
    await expect.element(screen.getByRole("region", { name: "Journal" })).not.toBeInTheDocument();

    await screen.getByRole("button", { exact: true, name: "Back to the journal" }).click();

    expect(clearSelection).toHaveBeenCalledOnce();
    expect(useInterfaceStore.getState().isJournalOpen).toBe(true);

    showWorld();

    await expect.element(screen.getByRole("region", { name: "Journal" })).toBeVisible();
    await expect.element(screen.getByRole("tab", { name: "Tribes" })).toHaveAttribute("aria-selected", "true");
    await expect.element(bearClan).toHaveFocus();
  });

  it("closes the card and the journal together", async () => {
    const { clearSelection } = await startTestEngine();

    showWorld({ inspection: BEAR_CLAN });
    useInterfaceStore.getState().openJournal("relations");

    const screen = await render(<SidePanel />);

    await screen.getByRole("button", { exact: true, name: "Close the card" }).click();

    expect(clearSelection).toHaveBeenCalledOnce();
    expect(useInterfaceStore.getState().isJournalOpen).toBe(false);
  });
});
