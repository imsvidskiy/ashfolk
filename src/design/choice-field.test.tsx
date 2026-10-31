import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ChoiceField, type ChoiceOption } from "./choice-field.tsx";

const QUALITY_OPTIONS: readonly ChoiceOption[] = [
  { label: "Light", value: "low" },
  { label: "Balanced", value: "medium" },
  { label: "High", value: "high" },
];

const SEASON_OPTIONS: readonly ChoiceOption[] = [
  { label: "Spring", value: "0" },
  { label: "Summer", value: "1" },
  { label: "Autumn", value: "2" },
  { label: "Winter", value: "3" },
];

const GROUND_OPTIONS: readonly ChoiceOption[] = [
  { icon: <span data-testid="meadow-icon" />, label: "Meadow", value: "meadow" },
  { icon: <span data-testid="sand-icon" />, label: "Sand", value: "sand" },
  { icon: <span data-testid="rock-icon" />, label: "Rock", value: "rock" },
  { icon: <span data-testid="snow-icon" />, label: "Snow", value: "snow" },
];

function QualityField() {
  const [quality, setQuality] = useState("medium");

  return <ChoiceField label="Graphics" onChange={setQuality} options={QUALITY_OPTIONS} value={quality} />;
}

function SeasonField() {
  const [season, setSeason] = useState("0");

  return <ChoiceField label="Season" onChange={setSeason} options={SEASON_OPTIONS} value={season} />;
}

function GroundField() {
  const [ground, setGround] = useState("meadow");

  return <ChoiceField label="Ground" onChange={setGround} options={GROUND_OPTIONS} value={ground} />;
}

describe("choice field with a few options", () => {
  it("shows every option side by side with the current one pressed", async () => {
    const screen = await render(<QualityField />);

    await expect.element(screen.getByRole("group", { name: "Graphics" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Light", pressed: false })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Balanced", pressed: true })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "High", pressed: false })).toBeVisible();
  });

  it("keeps the current option when it is pressed again", async () => {
    const handleChange = vi.fn();

    const screen = await render(
      <ChoiceField label="Graphics" onChange={handleChange} options={QUALITY_OPTIONS} value="medium" />
    );

    await screen.getByRole("button", { name: "Balanced" }).click();

    expect(handleChange).not.toHaveBeenCalled();
  });

  it("reports the chosen value to its owner", async () => {
    const handleChange = vi.fn();

    const screen = await render(
      <ChoiceField label="Graphics" onChange={handleChange} options={QUALITY_OPTIONS} value="medium" />
    );

    await screen.getByRole("button", { name: "Light" }).click();

    expect(handleChange).toHaveBeenCalledExactlyOnceWith("low");
  });
});

describe("choice field with many options", () => {
  it("shows the current option in a drop-down list", async () => {
    const screen = await render(<SeasonField />);

    await expect.element(screen.getByRole("combobox", { name: "Season" })).toHaveTextContent("Spring");
  });

  it("lists every option when opened", async () => {
    const screen = await render(<SeasonField />);

    await screen.getByRole("combobox", { name: "Season" }).click();

    await expect.element(screen.getByRole("option", { name: "Spring" })).toBeVisible();
    await expect.element(screen.getByRole("option", { name: "Summer" })).toBeVisible();
    await expect.element(screen.getByRole("option", { name: "Autumn" })).toBeVisible();
    await expect.element(screen.getByRole("option", { name: "Winter" })).toBeVisible();
  });

  it("reports the chosen value to its owner", async () => {
    const handleChange = vi.fn();

    const screen = await render(
      <ChoiceField label="Season" onChange={handleChange} options={SEASON_OPTIONS} value="0" />
    );

    await screen.getByRole("combobox", { name: "Season" }).click();
    await screen.getByRole("option", { name: "Winter" }).click();

    expect(handleChange).toHaveBeenCalledExactlyOnceWith("3");
  });
});

describe("choice field with many options and icons", () => {
  it("shows the icon of the current option in the closed list", async () => {
    const screen = await render(<GroundField />);

    const trigger = screen.getByRole("combobox", { name: "Ground" });

    await expect.element(trigger).toHaveTextContent("Meadow");
    await expect.element(trigger.getByTestId("meadow-icon")).toBeInTheDocument();
    await expect.element(trigger.getByTestId("sand-icon")).not.toBeInTheDocument();
  });

  it("shows each option's icon beside its name", async () => {
    const screen = await render(<GroundField />);

    await screen.getByRole("combobox", { name: "Ground" }).click();

    await expect.element(screen.getByRole("option", { name: "Snow" })).toBeVisible();

    for (const { label, value } of GROUND_OPTIONS) {
      const option = screen.getByRole("option", { exact: true, name: label });

      expect(option.getByTestId(`${value}-icon`).query()).not.toBeNull();
    }
  });

  it("picks an option with the keyboard", async () => {
    const screen = await render(<GroundField />);

    const trigger = screen.getByRole("combobox", { name: "Ground" });

    trigger.element().focus();
    await userEvent.keyboard("{Enter}");

    await expect.element(screen.getByRole("option", { name: "Meadow" })).toHaveFocus();

    await userEvent.keyboard("{ArrowDown}{ArrowDown}");

    await expect.element(screen.getByRole("option", { name: "Rock" })).toHaveFocus();

    await userEvent.keyboard("{Enter}");

    await expect.element(trigger).toHaveTextContent("Rock");
    await expect.element(trigger.getByTestId("rock-icon")).toBeInTheDocument();
  });
});
