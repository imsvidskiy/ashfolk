import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type Browser, type BrowserContextOptions, chromium, expect, type Page } from "@playwright/test";
import { TICK_SECONDS } from "../src/simulation/tick.ts";
import { WORLD_RISING_TIMEOUT } from "./launch.ts";
import { type PowerCast, SCENES, type Scene, sceneFromQuery } from "./scenes.ts";

const SYSTEM_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const GPU_ARGUMENTS = ["--use-angle=metal", "--enable-gpu"];
const SETTLE_FRAMES = 60;
const SLOWEST_TICKS_PER_SECOND = 2.5;
const MILLISECONDS_PER_SECOND = 1000;
const SCENE_NAME = /^[a-z0-9-]+$/u;
const RUN_TIMEOUT_FACTOR = 4;

interface Device {
  readonly name: string;
  readonly options: BrowserContextOptions;
}

const DEVICES: readonly Device[] = [
  { name: "wide", options: { deviceScaleFactor: 2, viewport: { height: 900, width: 1440 } } },
  {
    name: "tablet",
    options: { deviceScaleFactor: 2, hasTouch: true, isMobile: true, viewport: { height: 1024, width: 768 } },
  },
  {
    name: "phone",
    options: { deviceScaleFactor: 3, hasTouch: true, isMobile: true, viewport: { height: 844, width: 390 } },
  },
];

function sceneOf(argument: string): Scene {
  const split = argument.indexOf("=");
  const name = split < 0 ? argument : argument.slice(0, split);

  if (!SCENE_NAME.test(name)) {
    throw new Error(`Scene names use lowercase letters, digits and dashes, got "${name}"`);
  }

  if (split >= 0) {
    return sceneFromQuery(name, argument.slice(split + 1));
  }

  const known = SCENES.find((scene) => {
    return scene.name === name;
  });

  if (known === undefined) {
    throw new Error(
      `Unknown scene "${name}". Known: ${SCENES.map((scene) => {
        return scene.name;
      }).join(", ")}`
    );
  }

  return known;
}

async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.evaluate((frames) => {
    return new Promise<void>((resolve) => {
      let left = frames;

      function tick(): void {
        left -= 1;

        if (left <= 0) {
          resolve();

          return;
        }

        requestAnimationFrame(tick);
      }

      requestAnimationFrame(tick);
    });
  }, count);
}

async function send(page: Page, command: Record<string, unknown>): Promise<void> {
  await page.evaluate((sent) => {
    Reflect.get(window, "ashfolk").session.send(sent);
  }, command);
}

async function castPower(page: Page, cast: PowerCast): Promise<void> {
  await send(page, { ...cast, type: "usePower" });
}

async function currentTick(page: Page): Promise<number> {
  return await page.evaluate(() => {
    return Reflect.get(window, "ashfolk").session.frame.tick;
  });
}

async function runFor(page: Page, scene: Scene, seconds: number): Promise<void> {
  if (scene.speed === undefined) {
    await runGameSeconds(page, seconds);

    return;
  }

  const hours = new URLSearchParams(scene.query).get("hours");
  const target = (await currentTick(page)) + Math.round((seconds * scene.speed) / TICK_SECONDS);

  await send(page, { speed: scene.speed, type: "setSpeed" });
  await send(page, { isPaused: false, type: "setPaused" });
  await page.waitForFunction(
    (tick) => {
      return Reflect.get(window, "ashfolk").session.frame.tick >= tick;
    },
    target,
    { timeout: seconds * MILLISECONDS_PER_SECOND * RUN_TIMEOUT_FACTOR }
  );
  await send(page, { isPaused: true, type: "setPaused" });

  if (hours !== null) {
    await send(page, { hours: Number(hours), type: "setHours" });
  }
}

async function runGameSeconds(page: Page, seconds: number): Promise<void> {
  const ticks = Math.round(seconds / TICK_SECONDS);

  await page.evaluate(
    ({ count, timeout }) => {
      const { session } = Reflect.get(window, "ashfolk");

      const lastTick = session.frame.tick + count;
      const deadline = performance.now() + timeout;

      session.send({ isFrozen: true, type: "setTimeFrozen" });
      session.send({ isPaused: false, type: "setPaused" });

      return new Promise<void>((resolve, reject) => {
        function waitForLastTick(): void {
          if (session.frame.tick >= lastTick) {
            session.send({ isPaused: true, type: "setPaused" });
            resolve();

            return;
          }

          if (performance.now() > deadline) {
            reject(new Error(`The game stopped at tick ${session.frame.tick} of ${lastTick}: ${session.status.kind}`));

            return;
          }

          requestAnimationFrame(waitForLastTick);
        }

        requestAnimationFrame(waitForLastTick);
      });
    },
    { count: ticks, timeout: (ticks / SLOWEST_TICKS_PER_SECOND) * MILLISECONDS_PER_SECOND }
  );
}

async function adapterName(browser: Browser, baseUrl: string): Promise<string> {
  const page = await browser.newPage();

  try {
    await page.goto(baseUrl);

    return await page.evaluate(async () => {
      if (!("gpu" in navigator)) {
        return "no WebGPU";
      }

      const adapter = await navigator.gpu.requestAdapter();

      return adapter === null ? "none" : `${adapter.info.vendor} ${adapter.info.architecture}`;
    });
  } finally {
    await page.close();
  }
}

async function shoot(browser: Browser, address: string, scene: Scene, device: Device, path: string): Promise<void> {
  const context = await browser.newContext(device.options);

  try {
    const page = await context.newPage();

    await page.goto(address);
    await page
      .waitForFunction(
        () => {
          return Reflect.has(window, "ashfolk");
        },
        undefined,
        { timeout: WORLD_RISING_TIMEOUT }
      )
      .catch(() => {
        throw new Error("Shots need a dev server, where the engine is on window.ashfolk");
      });
    await expect(page.getByRole("status")).toBeHidden({ timeout: WORLD_RISING_TIMEOUT });

    if (scene.cast !== undefined) {
      await castPower(page, scene.cast);
    }

    if (scene.seconds !== undefined) {
      await runFor(page, scene, scene.seconds);
    }

    if (scene.season !== undefined) {
      await send(page, { season: scene.season, type: "setSeason" });
    }

    await waitForFrames(page, SETTLE_FRAMES);
    await page.screenshot({ path });
  } finally {
    await context.close();
  }
}

async function shootScenes(baseUrl: string, folder: string, scenes: readonly Scene[]): Promise<void> {
  const { CHROMIUM_EXECUTABLE_PATH: executablePath = SYSTEM_CHROME } = process.env;

  const browser = await chromium.launch({ args: GPU_ARGUMENTS, executablePath });

  try {
    await mkdir(folder, { recursive: true });

    console.log(`WebGPU adapter: ${await adapterName(browser, baseUrl)}`);

    for (const scene of scenes) {
      for (const device of DEVICES) {
        const path = join(folder, `${scene.name}-${device.name}.png`);

        // biome-ignore lint/performance/noAwaitInLoops: one GPU browser renders one scene at a time
        await shoot(browser, new URL(`?${scene.query}`, baseUrl).href, scene, device, path);
        console.log(path);
      }
    }
  } finally {
    await browser.close();
  }
}

const [serverUrl, shotsFolder, ...sceneArguments] = process.argv.slice(2);

if (serverUrl === undefined || shotsFolder === undefined) {
  throw new Error("Usage: bun run shots <base-url> <folder> [scene or name=query, with season, seconds and speed ...]");
}

await shootScenes(serverUrl, shotsFolder, sceneArguments.length === 0 ? SCENES : sceneArguments.map(sceneOf));
