import { expect, test } from "@playwright/test";
import { openIsland } from "./launch.ts";

test("the phone layout opens the journal sheet and the settings from the menu", async ({ page }) => {
  await openIsland(page);

  await page.getByRole("button", { exact: true, name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "Journal" }).click();

  const sheet = page.getByRole("dialog", { name: "Journal" });

  await expect(sheet.getByRole("tab", { name: "Chronicle" })).toBeVisible();

  await sheet.getByRole("button", { name: "Close the journal" }).click();

  await expect(sheet).toBeHidden();

  await page.getByRole("button", { exact: true, name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();

  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
});
