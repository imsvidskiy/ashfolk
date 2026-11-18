import { describe, expect, it, onTestFinished, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { SimulationFrame } from "../../simulation/frame.ts";
import { createListeners } from "../testing/listener-fixtures.ts";
import { createFrame } from "../testing/world-fixtures.ts";
import { connectWorldStore, useWorldStore, type WorldNotice } from "../world/world-store.ts";
import { NoticeFeed } from "./notice-feed.tsx";

const RAIN_NOTICE: WorldNotice = { category: "notice", expiresAt: 7000, id: 1, text: "Rain is coming." };
const HUNGER_WARNING: WorldNotice = { category: "warning", expiresAt: 7000, id: 2, text: "The Wolf Clan is starving." };

describe("notice feed", () => {
  it("lists the current notices", async () => {
    useWorldStore.setState({ notices: [RAIN_NOTICE, HUNGER_WARNING] });

    const screen = await render(<NoticeFeed />);

    expect(screen.getByRole("listitem").elements()).toHaveLength(2);
    await expect.element(screen.getByText("Rain is coming.")).toBeVisible();
    await expect.element(screen.getByText("The Wolf Clan is starving.")).toBeVisible();
  });

  it("announces new notices politely to assistive technology", async () => {
    const screen = await render(<NoticeFeed />);

    await expect.element(screen.getByRole("list")).toHaveAttribute("aria-live", "polite");
  });

  it("leaves the island under a notice available for pointer input", async () => {
    useWorldStore.setState({ notices: [RAIN_NOTICE] });

    const screen = await render(
      <div className="relative h-32">
        <canvas aria-label="Island" className="absolute inset-0 size-full" />

        <NoticeFeed className="absolute inset-0" />
      </div>
    );

    const notice = screen.getByText(RAIN_NOTICE.text).element();
    const { x, y, width, height } = notice.getBoundingClientRect();

    expect(document.elementFromPoint(x + width / 2, y + height / 2)).toBe(screen.getByLabelText("Island").element());
  });

  it("keeps the original expiry when the HUD is hidden and shown again", async () => {
    vi.useFakeTimers({ toFake: ["clearTimeout", "performance", "setTimeout"] });

    const frames = createListeners<SimulationFrame>();
    const feed = { chronicle: [], frame: createFrame(), subscribe: frames.subscribe };

    onTestFinished(connectWorldStore(feed));
    frames.emit(createFrame({ notices: [RAIN_NOTICE.text] }));

    const screen = await render(<NoticeFeed />);

    vi.advanceTimersByTime(4000);
    await screen.rerender(null);

    vi.advanceTimersByTime(2500);
    await screen.rerender(<NoticeFeed />);
    await expect.element(screen.getByText(RAIN_NOTICE.text)).toBeVisible();

    vi.advanceTimersByTime(500);
    await expect.element(screen.getByText(RAIN_NOTICE.text)).not.toBeInTheDocument();
  });
});
