import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { Inspection, TribeInspection } from "../../simulation/inspection.ts";
import { startTestEngine } from "../testing/engine-fixtures.ts";
import {
  createAnimalInspection,
  createBuildingInspection,
  createCellInspection,
  createPersonInspection,
  createTribe,
} from "../testing/world-fixtures.ts";
import { InspectorCard } from "./inspector-card.tsx";

const FOLLOW_LABEL = "Follow with the camera";

function createTribeInspection(isMigrating: boolean): TribeInspection {
  return { kind: "tribe", summary: createTribe({ isMigrating }) };
}

function renderInspection(inspection: Inspection, onBack?: () => void) {
  return render(<InspectorCard inspection={inspection} onBack={onBack} onClose={vi.fn<() => void>()} />);
}

describe("inspector card", () => {
  it("titles a person with their name, age and tribe", async () => {
    const screen = await renderInspection(createPersonInspection());

    await expect.element(screen.getByRole("heading", { level: 2, name: "Esk" })).toBeVisible();
    await expect.element(screen.getByText("Man, 26 · Bear Clan")).toBeVisible();
    await expect.element(screen.getByRole("region", { name: "Selection details" })).toBeVisible();
  });

  it.each([
    { age: 7, isFemale: true, subtitle: "Girl, 7 · Bear Clan" },
    { age: 9, isFemale: false, subtitle: "Boy, 9 · Bear Clan" },
    { age: 34, isFemale: true, subtitle: "Woman, 34 · Bear Clan" },
    { age: 63, isFemale: true, subtitle: "Elder woman, 63 · Bear Clan" },
    { age: 70, isFemale: false, subtitle: "Elder man, 70 · Bear Clan" },
  ])("describes a person aged $age as “$subtitle”", async ({ age, isFemale, subtitle }) => {
    const screen = await renderInspection(createPersonInspection({ age, isFemale }));

    await expect.element(screen.getByText(subtitle)).toBeVisible();
  });

  it.each([
    { inspection: createAnimalInspection(), subtitle: "Wild animal", title: "Deer" },
    { inspection: createAnimalInspection({ isYoung: true }), subtitle: "Young animal", title: "Deer" },
    { inspection: createBuildingInspection(), subtitle: "Bear Clan", title: "Campfire" },
    { inspection: createCellInspection(), subtitle: "-120, 341", title: "Broadleaf forest" },
    { inspection: createTribeInspection(false), subtitle: "Settled", title: "Bear Clan" },
    { inspection: createTribeInspection(true), subtitle: "On the move", title: "Bear Clan" },
  ])("titles a $inspection.kind as “$title” with “$subtitle”", async ({ inspection, subtitle, title }) => {
    const screen = await renderInspection(inspection);

    await expect.element(screen.getByRole("heading", { level: 2, name: title })).toBeVisible();
    await expect.element(screen.getByText(subtitle, { exact: true })).toBeVisible();
  });

  it.each([{ inspection: createPersonInspection() }, { inspection: createAnimalInspection() }])(
    "lets the camera follow a $inspection.kind",
    async ({ inspection }) => {
      const screen = await renderInspection(inspection);

      await expect
        .element(screen.getByRole("button", { exact: true, name: FOLLOW_LABEL }))
        .toHaveAttribute("aria-pressed", "false");
    }
  );

  it.each([
    { inspection: createBuildingInspection() },
    { inspection: createCellInspection() },
    { inspection: createTribeInspection(false) },
  ])("has nothing to follow for a $inspection.kind", async ({ inspection }) => {
    const screen = await renderInspection(inspection);

    await expect.element(screen.getByRole("button", { exact: true, name: "Close the card" })).toBeVisible();
    await expect.element(screen.getByRole("button", { exact: true, name: FOLLOW_LABEL })).not.toBeInTheDocument();
  });

  it("does not start following while no game is running", async () => {
    const screen = await renderInspection(createPersonInspection());

    const follow = screen.getByRole("button", { exact: true, name: FOLLOW_LABEL });

    await follow.click();

    await expect.element(follow).toHaveAttribute("aria-pressed", "false");
  });

  it("closes from its close button", async () => {
    const close = vi.fn<() => void>();

    const screen = await render(<InspectorCard inspection={createPersonInspection()} onClose={close} />);

    await screen.getByRole("button", { exact: true, name: "Close the card" }).click();

    expect(close).toHaveBeenCalledOnce();
  });

  it("goes back to the journal when it was opened from there", async () => {
    const back = vi.fn<() => void>();

    const screen = await renderInspection(createPersonInspection(), back);

    await screen.getByRole("button", { exact: true, name: "Back to the journal" }).click();

    expect(back).toHaveBeenCalledOnce();
  });

  it("offers no way back when it was opened from the island", async () => {
    const screen = await renderInspection(createPersonInspection());

    await expect.element(screen.getByRole("button", { name: "Back to the journal" })).not.toBeInTheDocument();
  });
});

describe("inspector card in a running game", () => {
  it("shows that the camera follows the selection", async () => {
    const { setFollowing } = await startTestEngine();

    setFollowing(true);

    const screen = await renderInspection(createPersonInspection());

    await expect
      .element(screen.getByRole("button", { exact: true, name: FOLLOW_LABEL }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("follows the selected person with the camera and stops again", async () => {
    const { followSelection, renderFrame, stopFollowing } = await startTestEngine();

    const screen = await renderInspection(createPersonInspection());

    const follow = screen.getByRole("button", { exact: true, name: FOLLOW_LABEL });

    await follow.click();
    renderFrame();

    expect(followSelection).toHaveBeenCalledOnce();
    await expect.element(follow).toHaveAttribute("aria-pressed", "true");

    await follow.click();
    renderFrame();

    expect(stopFollowing).toHaveBeenCalledOnce();
    await expect.element(follow).toHaveAttribute("aria-pressed", "false");
  });

  it("lets go of the button when the camera stops following on its own", async () => {
    const { followSelection, renderFrame, setFollowing } = await startTestEngine();

    const screen = await renderInspection(createPersonInspection());

    const follow = screen.getByRole("button", { exact: true, name: FOLLOW_LABEL });

    await follow.click();
    renderFrame();

    await expect.element(follow).toHaveAttribute("aria-pressed", "true");

    setFollowing(false);
    renderFrame();

    await expect.element(follow).toHaveAttribute("aria-pressed", "false");

    await follow.click();

    expect(followSelection).toHaveBeenCalledTimes(2);
  });
});
