import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { VitePWA } from "vite-plugin-pwa";
import { configDefaults, defineConfig } from "vitest/config";
import { createChromiumLaunchOptions } from "./tests/chromium.ts";

interface BuiltAsset {
  readonly names: readonly string[];
}

function assetFileName(asset: BuiltAsset): string {
  const isVideo = asset.names.some((name) => {
    return name.endsWith(".mp4");
  });

  if (isVideo) {
    return "media/[name]-[hash][extname]";
  }

  return "assets/[name]-[hash][extname]";
}

function inlineLimit(file: string): boolean | undefined {
  if (file.endsWith(".webm")) {
    return false;
  }

  return undefined;
}

export default defineConfig({
  base: "./",
  build: {
    assetsInlineLimit: inlineLimit,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        privacy: fileURLToPath(new URL("privacy/index.html", import.meta.url)),
      },
      output: {
        assetFileNames: assetFileName,
      },
    },
    target: "es2023",
  },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    VitePWA({
      base: "/",
      injectRegister: "script-defer",
      manifest: false,
      workbox: {
        clientsClaim: true,
        directoryIndex: null,
        globPatterns: ["**/*.{css,html,js,png,svg,webp,woff2}"],
        navigateFallback: null,
        navigationPreload: true,
        runtimeCaching: [
          {
            handler: "NetworkOnly",
            options: { precacheFallback: { fallbackURL: "privacy/index.html" } },
            urlPattern: ({ request, url }) => {
              return request.mode === "navigate" && url.pathname.startsWith("/privacy/");
            },
          },
          {
            handler: "NetworkOnly",
            options: { precacheFallback: { fallbackURL: "index.html" } },
            urlPattern: ({ request }) => {
              return request.mode === "navigate";
            },
          },
          {
            handler: "CacheFirst",
            options: { cacheName: "sounds", expiration: { maxEntries: 150 } },
            urlPattern: ({ request, url }) => {
              return url.pathname.endsWith(".webm") && !request.headers.has("range");
            },
          },
        ],
        skipWaiting: true,
      },
    }),
  ],
  test: {
    projects: [
      {
        extends: true,
        test: {
          exclude: [...configDefaults.exclude, "src/**/*.browser.test.ts"],
          include: ["scripts/**/*.test.ts", "src/**/*.test.ts", "worker/**/*.test.ts"],
          name: "unit",
        },
      },
      {
        extends: true,
        test: {
          browser: {
            enabled: true,
            headless: true,
            instances: [{ browser: "chromium" }],
            provider: playwright({ launchOptions: createChromiumLaunchOptions() }),
          },
          include: ["src/**/*.browser.test.ts", "src/**/*.test.tsx"],
          name: "browser",
          setupFiles: ["src/features/testing/browser-setup.ts"],
        },
      },
    ],
    restoreMocks: true,
    testTimeout: 30_000,
  },
  worker: {
    format: "es",
  },
});
