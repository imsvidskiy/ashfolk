import { describe, expect, it, vi } from "vitest";
import { defaultPowerParameters } from "../../content/powers.ts";
import { ignore } from "../../shared/ignore.ts";
import { parametersOf, readStoredParameters, usePowerStore } from "./power-store.ts";

const STORAGE_KEY = "ashfolk.powers";

function saveSettings(parameters: unknown): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { parameters }, version: 0 }));
}

function readSavedSettings(): unknown {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (saved === null) {
    return null;
  }

  return JSON.parse(saved);
}

describe("power store", () => {
  it("starts with no power selected", () => {
    const state = usePowerStore.getState();

    expect(state.selectedPowerId).toBeNull();
    expect(state.parameters).toEqual({});
  });

  it("selects a power and puts it away again", () => {
    usePowerStore.getState().selectPower("fire");

    expect(usePowerStore.getState().selectedPowerId).toBe("fire");

    usePowerStore.getState().selectPower(null);

    expect(usePowerStore.getState().selectedPowerId).toBeNull();
  });

  it("changes one parameter and keeps the defaults of the others", () => {
    usePowerStore.getState().setParameter("fire", "intensity", 80);

    expect(usePowerStore.getState().parameters.fire).toEqual({ ...defaultPowerParameters("fire"), intensity: 80 });
  });

  it("keeps the parameters of other powers when one changes", () => {
    usePowerStore.getState().setParameter("rain", "radius", 200);
    usePowerStore.getState().setParameter("fire", "radius", 40);

    expect(usePowerStore.getState().parameters.rain).toEqual({ ...defaultPowerParameters("rain"), radius: 200 });
  });

  it("falls back to the defaults and warns when a value is out of range", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(ignore);

    usePowerStore.getState().setParameter("fire", "intensity", 80);
    usePowerStore.getState().setParameter("fire", "intensity", 500);

    expect(usePowerStore.getState().parameters.fire).toEqual(defaultPowerParameters("fire"));
    expect(warning).toHaveBeenCalledOnce();
  });

  it("resets the parameters of one power to the defaults", () => {
    usePowerStore.getState().setParameter("fire", "intensity", 80);
    usePowerStore.getState().setParameter("rain", "intensity", 30);

    usePowerStore.getState().resetParameters("fire");

    const { parameters } = usePowerStore.getState();

    expect(parameters.fire).toEqual(defaultPowerParameters("fire"));
    expect(parameters.rain).toEqual({ ...defaultPowerParameters("rain"), intensity: 30 });
  });

  it("saves only the parameters between visits", () => {
    usePowerStore.getState().selectPower("fire");
    usePowerStore.getState().setParameter("fire", "intensity", 80);

    expect(readSavedSettings()).toEqual({
      state: { parameters: { fire: { ...defaultPowerParameters("fire"), intensity: 80 } } },
      version: 0,
    });
  });

  it("restores the saved parameters", async () => {
    saveSettings({ fire: { intensity: 35, radius: 40 } });

    await usePowerStore.persist.rehydrate();

    expect(usePowerStore.getState().parameters).toEqual({ fire: { intensity: 35, radius: 40 } });
  });

  it("keeps the current state when nothing was saved", async () => {
    usePowerStore.getState().selectPower("rain");

    await usePowerStore.persist.rehydrate();

    const state = usePowerStore.getState();

    expect(state.selectedPowerId).toBe("rain");
    expect(state.parameters).toEqual({});
  });

  it("drops saved settings of unknown powers and repairs invalid ones", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(ignore);

    saveSettings({ fire: { intensity: 900 }, tsunami: { size: 3 } });

    await usePowerStore.persist.rehydrate();

    expect(usePowerStore.getState().parameters).toEqual({ fire: defaultPowerParameters("fire") });
    expect(warning).toHaveBeenCalled();
  });
});

describe("stored power parameters", () => {
  it("reads the parameters of every known power", () => {
    const parameters = readStoredParameters({ parameters: { rain: { intensity: 40, radius: 90 } } });

    expect(parameters).toEqual({ rain: { intensity: 40, radius: 90 } });
  });

  it("skips the parameters of a power that was removed", () => {
    const parameters = readStoredParameters({ parameters: { inspect: {}, rain: { intensity: 40, radius: 90 } } });

    expect(parameters).toEqual({ rain: { intensity: 40, radius: 90 } });
  });

  it("fills in missing values with the defaults", () => {
    const parameters = readStoredParameters({ parameters: { rain: { intensity: 40 } } });

    expect(parameters).toEqual({ rain: { ...defaultPowerParameters("rain"), intensity: 40 } });
  });

  it("ignores saved data of the wrong shape and warns about it", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(ignore);

    const parameters = readStoredParameters("not settings");

    expect(parameters).toEqual({});
    expect(warning).toHaveBeenCalledOnce();
  });

  it("reads saved data without parameters as no parameters", () => {
    expect(readStoredParameters({})).toEqual({});
  });

  it("uses the defaults for powers without saved parameters", () => {
    expect(parametersOf({}, "rain")).toEqual(defaultPowerParameters("rain"));
  });

  it("prefers saved parameters over the defaults", () => {
    const saved = { intensity: 20, radius: 30 };

    expect(parametersOf({ fire: saved }, "fire")).toBe(saved);
  });
});
