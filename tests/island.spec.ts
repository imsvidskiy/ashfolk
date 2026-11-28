import { expect, test } from "@playwright/test";
import { openIsland } from "./launch.ts";

const PEAK_HEIGHT = /^\d+ m$/u;

test("the island rises with its tribes, runs time and shows the settings of a power", async ({ page }, testInfo) => {
  await openIsland(page);

  const tribes = page.getByRole("list", { name: "Tribes" });
  const places = page.getByRole("list", { name: "Places" });

  await expect(page.getByRole("button", { exact: true, name: "Select" })).toHaveAttribute("aria-pressed", "true");
  await expect(tribes.getByRole("listitem", { includeHidden: true })).toHaveCount(3);
  await expect(places.getByText(PEAK_HEIGHT)).toBeAttached();

  await page.getByRole("button", { exact: true, name: "Resume" }).click();

  await expect(page.getByRole("button", { exact: true, name: "Pause" })).toBeVisible();

  await page.getByRole("button", { exact: true, name: "Pause" }).click();

  await expect(page.getByRole("button", { exact: true, name: "Resume" })).toBeVisible();

  await page.getByRole("button", { exact: true, name: "Fire" }).click();

  await expect(page.getByRole("region", { name: "Fire settings" })).toBeVisible();

  if (testInfo.project.name === "phone") {
    await page.getByRole("button", { name: "Adjust settings" }).click();
  }

  await expect(page.getByRole("slider", { name: "Strength" })).toBeVisible();

  await page.getByRole("button", { exact: true, name: "Select" }).click();

  await expect(page.getByRole("region", { name: "Fire settings" })).toBeHidden();
});
