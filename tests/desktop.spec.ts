import { expect, test } from "@playwright/test";
import { openIsland, WORLD_RISING_TIMEOUT } from "./launch.ts";

function documentStart(): number {
  return performance.timeOrigin;
}

test("the wide layout opens the journal and grows a new world from the settings without reloading", async ({
  page,
}) => {
  await openIsland(page);

  const start = await page.evaluate(documentStart);

  await page.getByRole("button", { exact: true, name: "Journal" }).click();

  const journal = page.getByRole("region", { name: "Journal" });

  await expect(journal.getByRole("tab", { name: "Tribes" })).toHaveAttribute("aria-selected", "true");
  await expect(journal.getByRole("listitem").first()).toBeVisible();

  await page.getByRole("button", { exact: true, name: "Settings" }).click();

  const settings = page.getByRole("dialog", { name: "Settings" });

  await settings.getByRole("tab", { name: "Island" }).click();
  await settings.getByRole("textbox", { name: "Seed" }).fill("42");
  await settings.getByRole("button", { exact: true, name: "Create" }).click();

  await expect(page).toHaveURL((address) => {
    return address.searchParams.get("seed") === "42";
  });
  await expect(page.getByRole("button", { exact: true, name: "Pause" })).toBeVisible({
    timeout: WORLD_RISING_TIMEOUT,
  });
  expect(await page.evaluate(documentStart)).toBe(start);
});
