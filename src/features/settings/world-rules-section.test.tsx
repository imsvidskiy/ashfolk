import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { DEFAULT_WORLD_RULES } from "../../content/world-rules.ts";
import { startTestEngine } from "../testing/engine-fixtures.ts";
import { showWorld } from "../testing/world-fixtures.ts";
import { WorldRulesSection } from "./world-rules-section.tsx";

const RULE_GROUP_NAMES = ["Fire", "People", "Nature", "Storms", "Rain and snow"];

describe("world rules section", () => {
  it("stays empty until the first frame arrives", async () => {
    const screen = await render(<WorldRulesSection />);

    expect(screen.container).toBeEmptyDOMElement();
  });

  it("shows a group for each kind of rule", async () => {
    showWorld();

    const screen = await render(<WorldRulesSection />);

    await Promise.all(
      RULE_GROUP_NAMES.map((name) => {
        return expect.element(screen.getByRole("group", { name })).toBeVisible();
      })
    );
  });

  it("keeps each rule inside its own group", async () => {
    showWorld();

    const screen = await render(<WorldRulesSection />);

    const fire = screen.getByRole("group", { name: "Fire" });
    const storms = screen.getByRole("group", { name: "Storms" });

    await expect.element(fire.getByRole("slider", { name: "Spread speed" })).toBeInTheDocument();
    await expect.element(fire.getByRole("slider", { name: "Embers" })).toBeInTheDocument();
    await expect.element(storms.getByRole("slider", { name: "Strike fires" })).toBeInTheDocument();
  });

  it("shows the current value of each rule", async () => {
    showWorld({ rules: { ...DEFAULT_WORLD_RULES, fire: { ...DEFAULT_WORLD_RULES.fire, spreadSpeed: 2.5 } } });

    const screen = await render(<WorldRulesSection />);

    const fire = screen.getByRole("group", { name: "Fire" });

    await expect.element(fire.getByRole("slider", { name: "Spread speed" })).toHaveValue("2.5");
    await expect.element(fire.getByText("×2.5")).toBeVisible();
    await expect.element(screen.getByRole("group", { name: "Storms" }).getByText("75%")).toBeVisible();
  });
});

describe("world rules section in a running game", () => {
  it("keeps both of two rules changed in quick succession", async () => {
    const { send } = await startTestEngine();

    showWorld();

    const screen = await render(<WorldRulesSection />);

    const fire = screen.getByRole("group", { name: "Fire" });

    fire.getByRole("slider", { name: "Spread speed" }).element().focus();
    await userEvent.keyboard("{ArrowRight}");
    fire.getByRole("slider", { name: "Embers" }).element().focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(send).toHaveBeenLastCalledWith({
      rules: { ...DEFAULT_WORLD_RULES, fire: { ...DEFAULT_WORLD_RULES.fire, embers: 1.1, spreadSpeed: 1.1 } },
      type: "setWorldRules",
    });
  });

  it("puts every rule back with one button", async () => {
    const { send } = await startTestEngine();

    showWorld({ rules: { ...DEFAULT_WORLD_RULES, fire: { ...DEFAULT_WORLD_RULES.fire, spreadSpeed: 2.5 } } });

    const screen = await render(<WorldRulesSection />);

    await screen.getByRole("button", { name: "Reset all" }).click();

    expect(send).toHaveBeenLastCalledWith({ rules: DEFAULT_WORLD_RULES, type: "setWorldRules" });
    await expect.element(screen.getByRole("slider", { name: "Spread speed" })).toHaveValue("1");
  });
});
