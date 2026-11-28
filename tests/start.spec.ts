import { expect, test as it, test } from "@playwright/test";
import { expectIslandReady } from "./launch.ts";

const FILM_FILE = /\.mp4(?:\?|$)/u;
const POSTER_FILE = /\.webp$/u;

const HUD_CHUNK = /\/assets\/hud-[\w-]+\.js$/u;

test.describe("the start screen", () => {
  it("keeps a poster when the film is unavailable and follows the reduced motion preference", async ({ page }) => {
    let videoRequests = 0;

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route(FILM_FILE, (route) => {
      videoRequests += 1;

      return route.abort();
    });
    await page.goto("/");

    const film = page.locator("video");

    await expect(page.getByRole("button", { name: "Grow the island" })).toBeEnabled();
    await expect(film).toHaveCount(0);
    expect(videoRequests).toBe(0);

    await page.emulateMedia({ reducedMotion: "no-preference" });

    await expect(film).toHaveJSProperty("autoplay", true);
    await expect(film).toHaveJSProperty("muted", true);
    await expect(film).toHaveJSProperty("controls", false);
    await expect(film).toHaveAttribute("poster", POSTER_FILE);

    await expect
      .poll(() => {
        return videoRequests;
      })
      .toBeGreaterThan(0);

    const poster = await film.getAttribute("poster");

    await page.emulateMedia({ reducedMotion: "reduce" });

    await expect(film).toHaveCount(0);
    await expect(page.locator(`img[src="${poster}"][alt=""]`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Grow the island" })).toBeEnabled();
  });

  it("names a square world and grows it", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("textbox", { name: "Name" }).fill("Old Ford");
    await page.getByText("Island options", { exact: true }).click();
    await page.getByRole("button", { exact: true, name: "Square" }).click();
    await page.getByRole("button", { name: "Grow the island" }).click();

    await expect(page).toHaveURL((address) => {
      return address.searchParams.get("name") === "Old Ford" && address.searchParams.get("shape") === "square";
    });
    await expect(page).toHaveTitle("Old Ford · Ashfolk");
    await expectIslandReady(page);
  });

  it("says the island could not rise when the interface fails to load", async ({ page }) => {
    await page.route(HUD_CHUNK, (route) => {
      return route.abort();
    });
    await page.goto("/?seed=7&quality=low&paused=1");

    await expect(page.getByRole("alert")).toContainText("The island could not rise");
  });
});
