import { describe, expect, it, onTestFinished } from "vitest";
import { render } from "vitest-browser-react";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { usePowerStore } from "../powers/power-store.ts";
import { startTestEngine } from "../testing/engine-fixtures.ts";
import { FINISHED_INTRO } from "../testing/guide-fixtures.ts";
import { createTribe, showWorld } from "../testing/world-fixtures.ts";
import { connectGuide } from "./connect-guide.ts";
import { GuideCard } from "./guide-card.tsx";
import { useGuideStore } from "./guide-store.ts";

describe("island guide", () => {
  it("visits a real camp and equips the power for the next task", async () => {
    const { engine, focusOn, send } = await startTestEngine();
    const tribe = createTribe();

    showWorld({ tribes: [tribe] });
    onTestFinished(connectGuide(engine.session));

    const screen = await render(<GuideCard />);

    await expect.element(screen.getByText(`Visit ${tribe.name}`, { exact: false })).toBeVisible();
    await screen.getByRole("button", { name: "Visit camp" }).click();

    expect(focusOn).toHaveBeenCalledWith(tribe.campX, tribe.campZ, 260);
    expect(send).toHaveBeenCalledWith({ selection: { id: tribe.id, kind: "tribe" }, type: "setSelection" });

    await screen.getByRole("button", { name: "Choose Abundance" }).click();

    expect(usePowerStore.getState().selectedPowerId).toBe("abundance");
    await expect.element(screen.getByText("Tap the ground beside a camp", { exact: false })).toBeVisible();

    useGuideStore.getState().record({ kind: "step", step: "use" });
    await screen.getByRole("button", { name: "Run at 2×" }).click();
    await screen.getByRole("button", { name: "Open chronicle" }).click();

    expect(useInterfaceStore.getState()).toMatchObject({ isJournalOpen: true, journalTab: "chronicle" });
    await expect.element(screen.getByRole("region", { name: "Island guide" })).not.toBeInTheDocument();
  });

  it("offers settlement on an empty island", async () => {
    showWorld({ tribes: [] });

    const screen = await render(<GuideCard />);

    await screen.getByRole("button", { name: "Choose Tribe" }).click();

    expect(usePowerStore.getState().selectedPowerId).toBe("tribe");
  });

  it("collapses, skips and replays the guide", async () => {
    showWorld({ tribes: [createTribe()] });

    const screen = await render(<GuideCard />);
    const toggle = screen.getByRole("button", { exact: false, name: "Meet your first tribe" });

    await toggle.click();

    await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
    await expect.element(screen.getByRole("button", { name: "Visit camp" })).not.toBeInTheDocument();

    await toggle.click();
    await screen.getByRole("button", { name: "Skip guide" }).click();

    expect(localStorage.getItem("ashfolk.guide")).toContain('"isOff":true');

    useGuideStore.getState().setTipsShown(true);

    await expect.element(screen.getByRole("button", { name: "Visit camp" })).toBeVisible();
  });

  it("renders nothing once the intro is done and nothing has happened", async () => {
    useGuideStore.setState({ progress: FINISHED_INTRO });

    const screen = await render(<GuideCard />);

    await expect.element(screen.getByRole("region", { name: "Island guide" })).not.toBeInTheDocument();
  });
});
