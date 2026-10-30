import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { GuideCard } from "./guide-card.tsx";
import { useGuideStore } from "./guide-store.ts";
import { FRESH_GUIDE, INTRO_TIPS } from "./guide-tips.ts";

const LOOK_TIP = /Drag to look around/u;
const PICK_TIP = /Pick Lightning/u;

describe("guide card", () => {
  it("shows the first tip and moves on when dismissed", async () => {
    const screen = await render(<GuideCard />);

    await expect.element(screen.getByText(LOOK_TIP)).toBeVisible();

    await screen.getByRole("button", { name: "Got it" }).click();

    await expect.element(screen.getByText(PICK_TIP)).toBeVisible();
  });

  it("hides every tip and remembers it", async () => {
    const screen = await render(<GuideCard />);

    await screen.getByRole("button", { name: "Hide tips" }).click();

    await expect.element(screen.getByRole("button", { name: "Got it" })).not.toBeInTheDocument();
    expect(useGuideStore.getState().progress.isOff).toBe(true);
    expect(localStorage.getItem("ashfolk.guide")).toContain('"isOff":true');
  });

  it("renders nothing once the intro is done and nothing has happened", async () => {
    useGuideStore.setState({ progress: { ...FRESH_GUIDE, done: [...INTRO_TIPS] } });

    const screen = await render(<GuideCard />);

    await expect.element(screen.getByRole("button", { name: "Got it" })).not.toBeInTheDocument();
  });
});
