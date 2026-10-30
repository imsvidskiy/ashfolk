import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import type { TribeSummary } from "../../simulation/frame.ts";
import {
  createAnimalInspection,
  createBuildingInspection,
  createCellInspection,
  createPersonInspection,
  createRelation,
  createStock,
  createTribe,
  showWorld,
} from "../testing/world-fixtures.ts";
import { AnimalDetails, BuildingDetails, CellDetails, PersonDetails, TribeDetails } from "./inspector-details.tsx";

function renderTribe(summary: TribeSummary) {
  return render(<TribeDetails tribe={{ kind: "tribe", summary }} />);
}

describe("person details", () => {
  it("shows what a person is doing and how they feel", async () => {
    const person = createPersonInspection({ energy: 0.9, health: 1, hunger: 0.24, warmth: 0.55 });

    const screen = await render(<PersonDetails person={person} />);

    await expect.element(screen.getByText("Resting")).toBeVisible();
    await expect.element(screen.getByRole("meter", { name: "Health" })).toHaveAttribute("aria-valuenow", "1");
    await expect.element(screen.getByRole("meter", { name: "Fed" })).toHaveAttribute("aria-valuenow", "0.76");
    await expect.element(screen.getByRole("meter", { name: "Warmth" })).toHaveAttribute("aria-valuenow", "0.55");
    await expect.element(screen.getByRole("meter", { name: "Energy" })).toHaveAttribute("aria-valuenow", "0.9");
    await expect.element(screen.getByText("100%", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("76%", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("55%", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("90%", { exact: true })).toBeVisible();
  });
});

describe("animal details", () => {
  it("shows what an animal is doing and its health", async () => {
    const animal = createAnimalInspection({ activity: "Running away", health: 0.8 });

    const screen = await render(<AnimalDetails animal={animal} />);

    await expect.element(screen.getByText("Running away")).toBeVisible();
    await expect.element(screen.getByRole("meter", { name: "Health" })).toHaveAttribute("aria-valuenow", "0.8");
    await expect.element(screen.getByText("80%", { exact: true })).toBeVisible();
  });
});

describe("building details", () => {
  it("marks a burning building", async () => {
    const building = createBuildingInspection({ isBurning: true, name: "Hut" });

    const screen = await render(<BuildingDetails building={building} />);

    await expect.element(screen.getByText("On fire")).toBeVisible();
  });

  it("shows how far the construction has come", async () => {
    const building = createBuildingInspection({ name: "Hut", progress: 0.4 });

    const screen = await render(<BuildingDetails building={building} />);

    await expect.element(screen.getByText("Being built · 40%")).toBeVisible();
  });

  it("marks a finished building as standing with its condition", async () => {
    const building = createBuildingInspection({ health: 0.7, name: "Hut" });

    const screen = await render(<BuildingDetails building={building} />);

    await expect.element(screen.getByText("Standing")).toBeVisible();
    await expect.element(screen.getByRole("meter", { name: "Condition" })).toHaveAttribute("aria-valuenow", "0.7");
  });

  it("shows the firewood left in a lit campfire", async () => {
    const campfire = createBuildingInspection({ fuel: 0.6, name: "Campfire" });

    const screen = await render(<BuildingDetails building={campfire} />);

    await expect.element(screen.getByRole("meter", { name: "Firewood" })).toHaveAttribute("aria-valuenow", "0.6");
    await expect.element(screen.getByText("60%", { exact: true })).toBeVisible();
  });

  it("says when a campfire has gone out", async () => {
    const campfire = createBuildingInspection({ fuel: 0.01, name: "Campfire" });

    const screen = await render(<BuildingDetails building={campfire} />);

    await expect.element(screen.getByRole("meter", { name: "Gone out" })).toBeVisible();
    await expect.element(screen.getByRole("meter", { name: "Firewood" })).not.toBeInTheDocument();
  });

  it("shows no firewood for a campfire that is still being built", async () => {
    const campfire = createBuildingInspection({ fuel: 0.6, name: "Campfire", progress: 0.5 });

    const screen = await render(<BuildingDetails building={campfire} />);

    await expect.element(screen.getByText("Being built · 50%")).toBeVisible();
    await expect.element(screen.getByRole("meter", { name: "Firewood" })).not.toBeInTheDocument();
  });

  it("shows no firewood for other buildings", async () => {
    const hut = createBuildingInspection({ fuel: 0.6, name: "Hut" });

    const screen = await render(<BuildingDetails building={hut} />);

    await expect.element(screen.getByRole("meter", { name: "Condition" })).toBeVisible();
    await expect.element(screen.getByRole("meter", { name: "Firewood" })).not.toBeInTheDocument();
  });
});

describe("cell details", () => {
  it("lists the ground, height, temperature, water and surface", async () => {
    const cell = createCellInspection({ height: 212.4, scorch: 0.12, snow: 0, temperature: 14.2, wetness: 0.3 });

    const screen = await render(<CellDetails cell={cell} />);

    await expect.element(screen.getByText("Grass", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("212 m", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("14 °C", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Dry", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("0%", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("30%", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("12%", { exact: true })).toBeVisible();
  });

  it("shows the depth of the water over flooded ground", async () => {
    const cell = createCellInspection({ waterDepth: 1.46 });

    const screen = await render(<CellDetails cell={cell} />);

    await expect.element(screen.getByText("1.5 m", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Dry", { exact: true })).not.toBeInTheDocument();
  });

  it("lists the plants and marks the burnt ones", async () => {
    const plants = [
      { isBurnt: false, name: "Oak" },
      { isBurnt: true, name: "Birch" },
    ];

    const screen = await render(<CellDetails cell={createCellInspection({ plants })} />);

    await expect.element(screen.getByText("Oak", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Birch (burnt)", { exact: true })).toBeVisible();
  });

  it("says when nothing grows", async () => {
    const screen = await render(<CellDetails cell={createCellInspection({ plants: [] })} />);

    await expect.element(screen.getByText("Nothing grows here.")).toBeVisible();
  });

  it("warns about fire on the ground", async () => {
    const screen = await render(<CellDetails cell={createCellInspection({ fire: 0.4 })} />);

    await expect.element(screen.getByText("Burning", { exact: true })).toBeVisible();
  });

  it("stays calm about embers too weak to matter", async () => {
    const screen = await render(<CellDetails cell={createCellInspection({ fire: 0.05 })} />);

    await expect.element(screen.getByText("Grass", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Burning", { exact: true })).not.toBeInTheDocument();
  });
});

describe("tribe details", () => {
  it("lists the era, the people and the stores of a tribe", async () => {
    const summary = createTribe({
      births: 2,
      children: 3,
      deaths: 1,
      population: 7,
      stock: createStock({ berries: 12.4, grain: 20, stone: 3, wood: 8.6 }),
    });

    const screen = await renderTribe(summary);

    const food = screen.getByRole("region", { name: "Food" });
    const materials = screen.getByRole("region", { name: "Materials" });

    await expect.element(screen.getByText("Wanderers", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("7 (3 children)", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("2 · 1", { exact: true })).toBeVisible();
    await expect.element(food.getByText("Berries", { exact: true })).toBeVisible();
    await expect.element(food.getByText("12", { exact: true })).toBeVisible();
    await expect.element(food.getByText("32", { exact: true })).toBeVisible();
    await expect.element(materials.getByText("9", { exact: true })).toBeVisible();
    await expect.element(materials.getByText("3", { exact: true })).toBeVisible();
  });

  it("shows how far the tribe has come along the eras", async () => {
    const summary = createTribe({
      era: { count: 6, index: 3, nextName: "Bronze Age" },
      eraName: "Copper Age",
    });

    const screen = await renderTribe(summary);

    await expect.element(screen.getByRole("list", { name: "Era 4 of 6" })).toBeVisible();
    await expect.element(screen.getByText("Next: Bronze Age", { exact: true })).toBeVisible();
  });

  it("names the ore a tribe still needs for its next discovery", async () => {
    const summary = createTribe({
      goal: { isBlocked: true, need: "4 tin ore", progress: 1, technologyName: "Bronze" },
    });

    const screen = await renderTribe(summary);

    await expect.element(screen.getByRole("meter", { name: "Next: Bronze" })).toHaveAttribute("aria-valuenow", "1");
    await expect.element(screen.getByText("Needs 4 tin ore", { exact: true })).toBeVisible();
  });

  it("lists the buildings and the land of a tribe", async () => {
    const summary = createTribe({
      buildings: [
        { count: 2, kind: "longhouse", name: "Longhouse" },
        { count: 1, kind: "smelter", name: "Smelter" },
      ],
      farmland: { crops: [{ count: 3, crop: "wheat", name: "Wheat" }], fields: 4, orchardTrees: 6, woodlotTrees: 0 },
    });

    const screen = await renderTribe(summary);

    await expect.element(screen.getByText("Longhouse ×2", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Smelter", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("4 (Wheat 3)", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Orchard trees", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Woodlot trees", { exact: true })).not.toBeInTheDocument();
  });

  it("shows the faith and the progress towards the next discovery", async () => {
    const summary = createTribe({
      faith: 40,
      goal: { isBlocked: false, need: null, progress: 0.5, technologyName: "Fire making" },
    });

    const screen = await renderTribe(summary);

    await expect.element(screen.getByRole("meter", { name: "Faith" })).toHaveAttribute("aria-valuenow", "0.4");
    await expect.element(screen.getByText("40", { exact: true })).toBeVisible();
    await expect
      .element(screen.getByRole("meter", { name: "Next: Fire making" }))
      .toHaveAttribute("aria-valuenow", "0.5");
    await expect.element(screen.getByText("50%", { exact: true })).toBeVisible();
  });

  it("fills the faith meter at most to the top", async () => {
    const summary = createTribe({ faith: 140 });

    const screen = await renderTribe(summary);

    await expect.element(screen.getByRole("meter", { name: "Faith" })).toHaveAttribute("aria-valuenow", "1");
    await expect.element(screen.getByText("140", { exact: true })).toBeVisible();
  });

  it("says when every discovery is made", async () => {
    const summary = createTribe({ goal: null });

    const screen = await renderTribe(summary);

    await expect.element(screen.getByText("Every discovery is made.")).toBeVisible();
  });

  it("lists the technologies the tribe knows", async () => {
    const summary = createTribe({ technologies: ["Gathering", "Fire making"] });

    const screen = await renderTribe(summary);

    await expect.element(screen.getByText("Gathering", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Fire making", { exact: true })).toBeVisible();
  });

  it("lists the neighbors of the tribe", async () => {
    showWorld({
      rivalry: {
        raids: [],
        relations: [createRelation({ firstId: 1, isKin: true, secondId: 2, stance: "friendly" })],
      },
      tribes: [createTribe({ id: 1, name: "Bear Clan" }), createTribe({ id: 2, name: "Wolf Clan" })],
    });

    const screen = await renderTribe(createTribe({ id: 1 }));

    const neighbors = screen.getByRole("region", { name: "Neighbors" });

    await expect.element(neighbors.getByText("Wolf Clan", { exact: true })).toBeVisible();
  });
});
