import { defineConfig, devices } from "@playwright/test";
import { createChromiumLaunchOptions } from "./tests/chromium.ts";

const PREVIEW_PORT = 4173;

const launchOptions = createChromiumLaunchOptions();

export default defineConfig({
  expect: { timeout: 20_000 },
  projects: [
    { name: "desktop", testIgnore: "phone.spec.ts", use: { ...devices["Desktop Chrome"], launchOptions } },
    { name: "phone", testIgnore: ["desktop.spec.ts", "start.spec.ts"], use: { ...devices["Pixel 7"], launchOptions } },
  ],
  testDir: "tests",
  testMatch: "*.spec.ts",
  timeout: 180_000,
  use: {
    baseURL: `http://localhost:${PREVIEW_PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `bun run build && bun run preview --port ${PREVIEW_PORT} --strictPort`,
    port: PREVIEW_PORT,
    reuseExistingServer: true,
    timeout: 300_000,
  },
  workers: 1,
});
