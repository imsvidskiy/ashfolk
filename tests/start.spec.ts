import { expect, test as it, test } from "@playwright/test";
import { WORLD_RISING_TIMEOUT } from "./launch.ts";

const SQUARE_WORLD_ADDRESS = /name=Old\+Ford.*shape=square/u;
const HUD_CHUNK = /\/assets\/hud-[\w-]+\.js$/u;

test.describe("the start screen", () => {
  it("names a square world and grows it", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("textbox", { name: "Name" }).fill("Old Ford");
    await page.getByRole("button", { exact: true, name: "Square" }).click();
    await page.getByRole("button", { name: "Grow the island" }).click();

    await expect(page).toHaveURL(SQUARE_WORLD_ADDRESS);
    await expect(page).toHaveTitle("Old Ford · Ashfolk");
    await expect(page.getByRole("status")).toBeHidden({ timeout: WORLD_RISING_TIMEOUT });
    await expect(page.getByRole("toolbar", { name: "Powers" })).toBeVisible();
  });

  it("says the island could not rise when the interface fails to load", async ({ page }) => {
    await page.route(HUD_CHUNK, (route) => {
      return route.abort();
    });
    await page.goto("/?seed=7&quality=low&paused=1");

    await expect(page.getByRole("alert")).toContainText("The island could not rise");
  });
});
