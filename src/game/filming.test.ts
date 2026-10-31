import { describe, expect, it, vi } from "vitest";
import { ignore } from "../shared/ignore.ts";
import { FILMING_OFF, FILMING_ON, Filming, readFilming } from "./filming.ts";

describe("filming", () => {
  it("changes only the settings it is given and tells its listeners", () => {
    const filming = new Filming();
    const listener = vi.fn();

    filming.subscribe(listener);
    filming.set({ hasFarShadows: true });

    expect(filming.settings).toEqual({ ...FILMING_OFF, hasFarShadows: true });
    expect(listener).toHaveBeenCalledWith({ ...FILMING_OFF, hasFarShadows: true });
  });

  it("turns everything on and off at once", () => {
    const filming = new Filming();

    filming.setAll(true);

    expect(filming.settings).toEqual(FILMING_ON);

    filming.setAll(false);

    expect(filming.settings).toEqual(FILMING_OFF);
  });

  it("ignores settings a recording script got wrong", () => {
    vi.spyOn(console, "warn").mockImplementation(ignore);

    const filming = new Filming();
    const listener = vi.fn();

    filming.subscribe(listener);
    filming.set(JSON.parse('{"hasFarShadows":"yes"}'));
    filming.set(JSON.parse('{"hasFarShadow":true}'));

    expect(filming.settings).toEqual(FILMING_OFF);
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops telling a listener once it unsubscribes", () => {
    const filming = new Filming();
    const listener = vi.fn();

    const unsubscribe = filming.subscribe(listener);

    unsubscribe();
    filming.set({ isInterfaceHidden: true });

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("filming from the address", () => {
  it("turns everything on for filming=1", () => {
    expect(readFilming("?seed=7&filming=1")).toEqual(FILMING_ON);
    expect(readFilming("?filming=all")).toEqual(FILMING_ON);
  });

  it("turns on the settings it names", () => {
    expect(readFilming("?filming=farShadows,noInterface")).toEqual({ hasFarShadows: true, isInterfaceHidden: true });
  });

  it("changes nothing without the parameter or with filming=0", () => {
    expect(readFilming("?seed=7")).toEqual({});
    expect(readFilming("?filming=0")).toEqual({});
  });

  it("skips names it does not know", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(ignore);

    expect(readFilming("?filming=farPlants,sharperShadows")).toEqual({ hasFarPlants: true });
    expect(warn).toHaveBeenCalledOnce();
  });
});
