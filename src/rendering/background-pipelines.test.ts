import { describe, expect, it } from "vitest";
import { isSoftwareAdapter } from "./background-pipelines.ts";
import { HARDWARE_ADAPTER } from "./testing/hardware-adapter.ts";

describe("software adapters", () => {
  it("counts a fallback adapter as software", () => {
    expect(isSoftwareAdapter({ ...HARDWARE_ADAPTER, architecture: "", isFallbackAdapter: true })).toBe(true);
  });

  it("counts SwiftShader as software when it doesn't report itself as a fallback", () => {
    expect(isSoftwareAdapter({ ...HARDWARE_ADAPTER, architecture: "swiftshader", vendor: "google" })).toBe(true);
  });

  it("counts a Metal adapter as hardware", () => {
    expect(isSoftwareAdapter(HARDWARE_ADAPTER)).toBe(false);
  });

  it("counts a browser without adapter info as hardware", () => {
    expect(isSoftwareAdapter(undefined)).toBe(false);
  });
});
