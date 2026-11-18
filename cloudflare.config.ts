import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  accountId: "1d1a3bd27899eba23e92aa6099285634",
  worker: {
    assets: {
      runWorkerFirst: ["/", "/media/*", "/privacy/*"],
    },
    compatibilityDate: "2026-10-18",
    domains: ["ashfolk.com", "www.ashfolk.com"],
    entrypoint: "./worker/index.ts",
    env: {
      ASSETS: bindings.assets(),
    },
    name: "ashfolk",
    previewUrls: false,
    workersDev: true,
  },
});
