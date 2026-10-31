import { describe, expect, it, vi } from "vitest";
import { ignore } from "../shared/ignore.ts";
import { storedQuality, storedShown, storeQuality, storeShown } from "./preferences.ts";

const QUALITY_KEY = "ashfolk.quality";
const LABELS_KEY = "ashfolk.labels";
const OUTLINES_KEY = "ashfolk.outlines";

describe("saved preferences", () => {
  it("has no saved quality at first", () => {
    expect(storedQuality()).toBeNull();
  });

  it("remembers the saved quality", () => {
    storeQuality("high");

    expect(storedQuality()).toBe("high");
    expect(localStorage.getItem(QUALITY_KEY)).toBe("high");
  });

  it("ignores and reports a saved quality it does not know", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(ignore);

    localStorage.setItem(QUALITY_KEY, "ultra");

    expect(storedQuality()).toBeNull();
    expect(warn).toHaveBeenCalledExactlyOnceWith("Ignoring a saved graphics quality", expect.any(Array));
  });

  it("shows map labels until they are turned off", () => {
    expect(storedShown("labels")).toBe(true);

    storeShown("labels", false);

    expect(storedShown("labels")).toBe(false);
    expect(localStorage.getItem(LABELS_KEY)).toBe("hidden");

    storeShown("labels", true);

    expect(storedShown("labels")).toBe(true);
  });

  it("keeps outlines apart from labels", () => {
    storeShown("outlines", false);

    expect(storedShown("outlines")).toBe(false);
    expect(storedShown("labels")).toBe(true);
    expect(localStorage.getItem(OUTLINES_KEY)).toBe("hidden");
  });

  it("shows map labels when the saved setting is unknown", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(ignore);

    localStorage.setItem(LABELS_KEY, "sometimes");

    expect(storedShown("labels")).toBe(true);
    expect(warn).toHaveBeenCalledExactlyOnceWith("Ignoring a saved label setting", expect.any(Array));
  });
});
