import { beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { defaultPowerParameters, POWERS } from "../../content/powers.ts";
import { PowerSettings } from "./power-settings.tsx";
import { usePowerStore } from "./power-store.ts";

function renderSettingsOf(powerId: "explosion" | "fire" | "forest") {
  usePowerStore.getState().selectPower(powerId);

  return render(<PowerSettings />);
}

describe("power settings", () => {
  beforeEach(async () => {
    await page.viewport(1280, 800);
  });

  it("stays hidden while no power is selected", async () => {
    const screen = await render(<PowerSettings />);

    expect(screen.container).toBeEmptyDOMElement();
  });

  it("describes the selected power and how to use it", async () => {
    const screen = await renderSettingsOf("fire");

    await expect.element(screen.getByRole("region", { name: "Fire settings" })).toBeVisible();
    await expect.element(screen.getByRole("heading", { level: 2, name: "Fire" })).toBeVisible();
    await expect.element(screen.getByTitle(POWERS.fire.description)).toBeVisible();
    await expect.element(screen.getByText("Hold and drag over the land.")).toBeVisible();
  });

  it("tells how to use a power cast at one spot", async () => {
    const screen = await renderSettingsOf("explosion");

    await expect.element(screen.getByText("Tap a spot on the island.")).toBeVisible();
  });

  it("shows a slider for every range with its current value", async () => {
    const screen = await renderSettingsOf("fire");

    await expect.element(screen.getByRole("slider", { name: "Strength" })).toHaveAttribute("aria-valuenow", "60");
    await expect.element(screen.getByRole("slider", { name: "Radius" })).toHaveAttribute("aria-valuenow", "25");
    await expect.element(screen.getByText("60%", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("25 m", { exact: true })).toBeVisible();
  });

  it("shows a switch for every on and off setting", async () => {
    const screen = await renderSettingsOf("explosion");

    await expect.element(screen.getByRole("switch", { name: "Burning debris" })).toBeChecked();
  });

  it("shows a list to pick from for settings with many choices", async () => {
    const screen = await renderSettingsOf("forest");

    await expect.element(screen.getByRole("combobox", { name: "Species" })).toHaveTextContent("Suits the climate");
  });

  it("changes a range with the keyboard and keeps the value in the store", async () => {
    const screen = await renderSettingsOf("fire");

    const strength = screen.getByRole("slider", { name: "Strength" });

    strength.element().focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(usePowerStore.getState().parameters.fire).toEqual({ ...defaultPowerParameters("fire"), intensity: 65 });
    await expect.element(strength).toHaveAttribute("aria-valuenow", "65");
    await expect.element(screen.getByText("65%", { exact: true })).toBeVisible();
  });

  it("turns a setting off with the keyboard and keeps it in the store", async () => {
    const screen = await renderSettingsOf("explosion");

    const burningDebris = screen.getByRole("switch", { name: "Burning debris" });

    burningDebris.element().focus();
    await userEvent.keyboard(" ");

    expect(usePowerStore.getState().parameters.explosion).toEqual({
      ...defaultPowerParameters("explosion"),
      burningDebris: false,
    });
    await expect.element(burningDebris).not.toBeChecked();
  });

  it("picks a choice from the list and keeps it in the store", async () => {
    const screen = await renderSettingsOf("forest");

    await screen.getByRole("combobox", { name: "Species" }).click();
    await screen.getByRole("option", { name: "Oak" }).click();

    expect(usePowerStore.getState().parameters.forest).toEqual({ ...defaultPowerParameters("forest"), species: "oak" });
    await expect.element(screen.getByRole("combobox", { name: "Species" })).toHaveTextContent("Oak");
  });

  it("shows a painted icon beside every species", async () => {
    const screen = await renderSettingsOf("forest");

    const species = screen.getByRole("combobox", { name: "Species" });

    expect(species.element().querySelectorAll("img")).toHaveLength(1);

    await species.click();

    const options = screen.getByRole("option").elements();

    expect(options).toHaveLength(12);

    for (const option of options) {
      expect(option.querySelectorAll("img")).toHaveLength(1);
    }
  });

  it("restores the defaults", async () => {
    usePowerStore.getState().setParameter("fire", "intensity", 90);

    const screen = await renderSettingsOf("fire");

    await expect.element(screen.getByText("90%", { exact: true })).toBeVisible();

    await screen.getByRole("button", { exact: true, name: "Reset to defaults" }).click();

    expect(usePowerStore.getState().parameters.fire).toEqual(defaultPowerParameters("fire"));
    await expect.element(screen.getByText("60%", { exact: true })).toBeVisible();
  });
});

describe("power settings on a phone", () => {
  beforeEach(async () => {
    await page.viewport(390, 844);
  });

  it("keeps to one line until the settings are asked for", async () => {
    const screen = await renderSettingsOf("fire");

    const adjust = screen.getByRole("button", { name: "Adjust settings" });

    await expect.element(screen.getByText("Hold and drag over the land.")).toBeVisible();
    await expect.element(adjust).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("slider", { name: "Strength" }).query()).toBeNull();

    await adjust.click();

    await expect.element(adjust).toHaveAttribute("aria-expanded", "true");
    await expect.element(screen.getByRole("slider", { name: "Strength" })).toBeVisible();

    await adjust.click();

    expect(screen.getByRole("slider", { name: "Strength" }).query()).toBeNull();
  });
});
