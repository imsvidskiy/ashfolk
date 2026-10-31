import { describe, expect, it } from "vitest";
import { isSoftwareAdapter } from "./background-pipelines.ts";

const SWIFTSHADER_ADAPTER: GPUAdapterInfo = {
  architecture: "swiftshader",
  description: "",
  device: "",
  isFallbackAdapter: false,
  subgroupMaxSize: 4,
  subgroupMinSize: 4,
  vendor: "google",
};

describe("software adapters", () => {
  it("counts a fallback adapter as software", () => {
    expect(isSoftwareAdapter({ ...SWIFTSHADER_ADAPTER, architecture: "", isFallbackAdapter: true })).toBe(true);
  });

  it("counts SwiftShader as software when it doesn't report itself as a fallback", () => {
    expect(isSoftwareAdapter(SWIFTSHADER_ADAPTER)).toBe(true);
  });

  it("counts a Metal adapter as hardware", () => {
    expect(isSoftwareAdapter({ ...SWIFTSHADER_ADAPTER, architecture: "metal-3", vendor: "apple" })).toBe(false);
  });

  it("counts a browser without adapter info as hardware", () => {
    expect(isSoftwareAdapter(undefined)).toBe(false);
  });
});
