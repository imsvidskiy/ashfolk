import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { RangeField } from "./range-field.tsx";

function RadiusField() {
  const [radius, setRadius] = useState(25);

  return (
    <RangeField
      description="How far the power reaches."
      label="Radius"
      maximum={60}
      minimum={5}
      onChange={setRadius}
      step={5}
      value={radius}
      valueText={`${radius} m`}
    />
  );
}

describe("range field", () => {
  it("shows its label and the formatted value", async () => {
    const screen = await render(<RadiusField />);

    await expect.element(screen.getByText("Radius")).toBeVisible();
    await expect.element(screen.getByText("25 m")).toBeVisible();
  });

  it("exposes a slider named by its label with the current value and bounds", async () => {
    const screen = await render(<RadiusField />);

    const slider = screen.getByRole("slider", { name: "Radius" });

    await expect.element(slider).toHaveValue("25");
    await expect.element(slider).toHaveAttribute("min", "5");
    await expect.element(slider).toHaveAttribute("max", "60");
  });

  it("moves by one step with the arrow keys", async () => {
    const screen = await render(<RadiusField />);

    screen.getByRole("slider", { name: "Radius" }).element().focus();

    await userEvent.keyboard("{ArrowRight}");

    await expect.element(screen.getByText("30 m")).toBeVisible();

    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");

    await expect.element(screen.getByText("20 m")).toBeVisible();
  });

  it("reports each new value to its owner", async () => {
    const handleChange = vi.fn();

    const screen = await render(
      <RangeField
        label="Strength"
        maximum={100}
        minimum={0}
        onChange={handleChange}
        step={10}
        value={50}
        valueText="50%"
      />
    );

    screen.getByRole("slider", { name: "Strength" }).element().focus();

    await userEvent.keyboard("{ArrowRight}");

    expect(handleChange).toHaveBeenCalledExactlyOnceWith(60);
  });

  it("keeps the thumb where it was dragged while the owner catches up", async () => {
    const screen = await render(
      <RangeField label="Strength" maximum={100} minimum={0} onChange={vi.fn()} step={10} value={50} valueText="50%" />
    );

    const slider = screen.getByRole("slider", { name: "Strength" });

    slider.element().focus();

    await userEvent.keyboard("{ArrowRight}");

    await expect.element(slider).toHaveValue("60");
  });

  it("shows its description as a hint", async () => {
    const screen = await render(<RadiusField />);

    await expect.element(screen.getByTitle("How far the power reaches.")).toBeInTheDocument();
  });
});
