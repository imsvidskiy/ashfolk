import { expect, type Page } from "@playwright/test";

export const WORLD_RISING_TIMEOUT = 150_000;

export async function expectIslandReady(page: Page): Promise<void> {
  await expect(page.getByRole("toolbar", { name: "Powers" })).toBeVisible({ timeout: WORLD_RISING_TIMEOUT });
}

export async function openIsland(page: Page): Promise<void> {
  await page.goto("/?seed=7&quality=low&paused=1");

  await expectIslandReady(page);
}
