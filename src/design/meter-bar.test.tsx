import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { MeterBar } from "./meter-bar.tsx";

describe("meter bar", () => {
  it("exposes a meter named by its label", async () => {
    const screen = await render(<MeterBar label="Health" tone="ember" value={0.76} valueText="76%" />);

    const meter = screen.getByRole("meter", { name: "Health" });

    await expect.element(meter).toHaveAttribute("aria-valuenow", "0.76");
    await expect.element(meter).toHaveAttribute("aria-valuemin", "0");
    await expect.element(meter).toHaveAttribute("aria-valuemax", "1");
  });

  it("shows the value text next to the label", async () => {
    const screen = await render(<MeterBar label="Firewood" tone="dawn" value={0.4} valueText="40%" />);

    await expect.element(screen.getByText("Firewood")).toBeVisible();
    await expect.element(screen.getByText("40%")).toBeVisible();
  });

  it("shows the value as a percent when no value text is given", async () => {
    const screen = await render(<MeterBar label="Warmth" tone="dawn" value={0.4} />);

    await expect.element(screen.getByText("40%")).toBeVisible();
  });
});
