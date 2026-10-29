import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { POWERS, powersInCategory } from "../../content/powers.ts";
import { PowerDock } from "./power-dock.tsx";
import { usePowerStore } from "./power-store.ts";

const ELEMENT_POWERS = [
  "Fire",
  "Lightning",
  "Rain",
  "Snow",
  "Explosion",
  "Meteor",
  "Earthquake",
  "Volcano",
  "Tornado",
] as const;
const LAND_POWERS = ["Raise land", "Lower land", "Flatten", "Smooth", "Forest", "Paint ground"] as const;
const LIFE_POWERS = powersInCategory("life").map((powerId) => {
  return POWERS[powerId].name;
});

describe("power dock", () => {
  it("shows the kinds as tabs above Select, Hand and the powers of the chosen kind", async () => {
    const screen = await render(<PowerDock />);

    const row = screen.getByRole("toolbar", { name: "Powers" });
    const kinds = row.getByRole("group", { name: "Kinds" });
    const names = row
      .getByRole("button")
      .elements()
      .map((button) => {
        const label = button.getAttribute("aria-label");

        return label === null ? button.textContent : label;
      });

    expect(names).toEqual(["Elements", "Land", "Life", "Select", "Hand", ...ELEMENT_POWERS]);
    await expect.element(kinds.getByRole("button", { name: "Elements" })).toHaveAttribute("aria-pressed", "true");
  });

  it("switches to the powers of another kind", async () => {
    const screen = await render(<PowerDock />);

    const kinds = screen.getByRole("group", { name: "Kinds" });

    await kinds.getByRole("button", { name: "Land" }).click();

    await Promise.all(
      LAND_POWERS.map((name) => {
        return expect.element(screen.getByRole("button", { exact: true, name })).toBeInTheDocument();
      })
    );
    await expect.element(screen.getByRole("button", { exact: true, name: "Fire" })).not.toBeInTheDocument();

    await kinds.getByRole("button", { name: "Life" }).click();

    await Promise.all(
      LIFE_POWERS.map((name) => {
        return expect.element(screen.getByRole("button", { exact: true, name })).toBeInTheDocument();
      })
    );
  });

  it("separates the groups of the chosen kind", async () => {
    const screen = await render(<PowerDock />);

    await screen.getByRole("group", { name: "Kinds" }).getByRole("button", { name: "Life" }).click();

    expect(screen.getByRole("separator").elements()).toHaveLength(3);
  });

  it("opens on the kind of the selected power", async () => {
    usePowerStore.setState({ selectedPowerId: "smooth" });

    const screen = await render(<PowerDock />);

    await expect
      .element(screen.getByRole("group", { name: "Kinds" }).getByRole("button", { name: "Land" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(screen.getByRole("button", { exact: true, name: "Smooth" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("shows icons alone and names each power with its key in its tooltip", async () => {
    const screen = await render(<PowerDock />);

    const rain = screen.getByRole("button", { exact: true, name: "Rain" });

    expect(rain.element().textContent).toBe("");
    await expect.element(rain).toHaveAttribute("aria-keyshortcuts", "3");

    await rain.hover();

    await expect.element(screen.getByText(POWERS.rain.description)).toBeVisible();
    await expect.element(screen.getByText("3", { exact: true })).toBeVisible();
  });

  it("selects the powers of the chosen kind with the number keys", async () => {
    const screen = await render(<PowerDock />);

    await userEvent.keyboard("3");

    expect(usePowerStore.getState().selectedPowerId).toBe("rain");

    await screen.getByRole("group", { name: "Kinds" }).getByRole("button", { name: "Land" }).click();
    await userEvent.keyboard("1");

    expect(usePowerStore.getState().selectedPowerId).toBe("raise");

    await userEvent.keyboard("9");

    expect(usePowerStore.getState().selectedPowerId).toBe("raise");
  });

  it("leaves the number keys alone while typing", async () => {
    const screen = await render(
      <>
        <input aria-label="Seed" />

        <p contentEditable suppressContentEditableWarning>
          Tribe name
        </p>

        <PowerDock />
      </>
    );

    await screen.getByRole("textbox", { name: "Seed" }).click();
    await userEvent.keyboard("2");

    expect(usePowerStore.getState().selectedPowerId).toBeNull();

    await screen.getByText("Tribe name").click();
    await userEvent.keyboard("2");

    expect(usePowerStore.getState().selectedPowerId).toBeNull();
  });

  it("leaves the number keys alone while a dialog is open", async () => {
    const screen = await render(
      <>
        <div aria-label="Settings" role="dialog">
          <button type="button">Close</button>
        </div>

        <PowerDock />
      </>
    );

    screen.getByRole("button", { name: "Close" }).element().focus();
    await userEvent.keyboard("2");

    expect(usePowerStore.getState().selectedPowerId).toBeNull();
  });

  it("leaves the number keys to the browser with a modifier held", async () => {
    await render(<PowerDock />);

    await userEvent.keyboard("{Control>}3{/Control}");
    await userEvent.keyboard("{Meta>}1{/Meta}");
    await userEvent.keyboard("{Alt>}2{/Alt}");

    expect(usePowerStore.getState().selectedPowerId).toBeNull();
  });

  it("moves between the tiles with the arrow keys", async () => {
    const screen = await render(<PowerDock />);

    const select = screen.getByRole("button", { exact: true, name: "Select" });

    select.element().focus();
    await userEvent.keyboard("{ArrowRight}");

    await expect.element(screen.getByRole("button", { exact: true, name: "Hand" })).toHaveFocus();

    await userEvent.keyboard("{ArrowRight}");

    await expect.element(screen.getByRole("button", { exact: true, name: "Fire" })).toHaveFocus();

    select.element().focus();
    await userEvent.keyboard("{ArrowLeft}");

    await expect.element(screen.getByRole("button", { exact: true, name: "Life" })).toHaveFocus();
  });

  it("selects a power and puts it away when selected again", async () => {
    const screen = await render(<PowerDock />);

    const fire = screen.getByRole("button", { exact: true, name: "Fire" });

    await fire.click();

    expect(usePowerStore.getState().selectedPowerId).toBe("fire");
    await expect.element(fire).toHaveAttribute("aria-pressed", "true");

    await fire.click();

    expect(usePowerStore.getState().selectedPowerId).toBeNull();
    await expect.element(fire).toHaveAttribute("aria-pressed", "false");
  });

  it("switches from one power to another", async () => {
    const screen = await render(<PowerDock />);

    await screen.getByRole("button", { exact: true, name: "Fire" }).click();
    await screen.getByRole("button", { exact: true, name: "Rain" }).click();

    expect(usePowerStore.getState().selectedPowerId).toBe("rain");
    await expect
      .element(screen.getByRole("button", { exact: true, name: "Fire" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("puts the power away with the Select tile", async () => {
    usePowerStore.getState().selectPower("fire");

    const screen = await render(<PowerDock />);

    const select = screen.getByRole("button", { exact: true, name: "Select" });

    await expect.element(select).toHaveAttribute("aria-pressed", "false");

    await select.click();

    expect(usePowerStore.getState().selectedPowerId).toBeNull();
    await expect.element(select).toHaveAttribute("aria-pressed", "true");
  });

  it("takes the hand in place of a power and names it in its tooltip", async () => {
    usePowerStore.getState().selectPower("fire");

    const screen = await render(<PowerDock />);

    const hand = screen.getByRole("button", { exact: true, name: "Hand" });

    await hand.hover();

    await expect
      .element(screen.getByText("Pick up people, animals, trees and bushes and set them down elsewhere."))
      .toBeVisible();

    await hand.click();

    expect(usePowerStore.getState()).toMatchObject({ isHandSelected: true, selectedPowerId: null });
    await expect.element(hand).toHaveAttribute("aria-pressed", "true");
    await expect
      .element(screen.getByRole("button", { exact: true, name: "Fire" }))
      .toHaveAttribute("aria-pressed", "false");
    await expect
      .element(screen.getByRole("button", { exact: true, name: "Select" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("puts the hand away with the Select tile or a power", async () => {
    usePowerStore.getState().selectHand();

    const screen = await render(<PowerDock />);

    await screen.getByRole("button", { exact: true, name: "Select" }).click();

    expect(usePowerStore.getState().isHandSelected).toBe(false);

    await screen.getByRole("button", { exact: true, name: "Hand" }).click();
    await screen.getByRole("button", { exact: true, name: "Rain" }).click();

    expect(usePowerStore.getState()).toMatchObject({ isHandSelected: false, selectedPowerId: "rain" });
  });
});
