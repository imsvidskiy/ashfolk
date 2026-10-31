import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { usePowerStore } from "../powers/power-store.ts";
import { nextFrame, startTestEngine } from "../testing/engine-fixtures.ts";
import { FilmingHint } from "./filming-hint.tsx";

const HINT_MILLISECONDS = 2500;
const HINT_TEXT = "Interface hidden. Press H to show it.";

function press(type: string, pointerType: string, pointerId: number, x: number): void {
  document.body.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: 0,
      isPrimary: pointerId === 1,
      pointerId,
      pointerType,
    })
  );
}

describe("filming hint", () => {
  it("hides and shows the interface with H", async () => {
    const { engine } = await startTestEngine();

    const screen = await render(<FilmingHint />);

    await userEvent.keyboard("h");

    expect(engine.filming.settings.isInterfaceHidden).toBe(true);
    await expect.element(screen.getByText(HINT_TEXT)).toBeVisible();

    await userEvent.keyboard("h");

    expect(engine.filming.settings.isInterfaceHidden).toBe(false);
    await expect.element(screen.getByText(HINT_TEXT)).not.toBeInTheDocument();
  });

  it("shows the interface again from its button", async () => {
    const { engine } = await startTestEngine();

    const screen = await render(<FilmingHint />);

    engine.filming.set({ isInterfaceHidden: true });
    await screen.getByRole("button", { name: "Show" }).click();

    expect(engine.filming.settings.isInterfaceHidden).toBe(false);
  });

  it("comes back on a tap but not on a drag or a pinch", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const { engine } = await startTestEngine();

    const screen = await render(<FilmingHint />);

    engine.filming.set({ isInterfaceHidden: true });

    await expect.element(screen.getByText(HINT_TEXT)).toBeVisible();

    vi.advanceTimersByTime(HINT_MILLISECONDS);

    await expect.element(screen.getByText(HINT_TEXT)).not.toBeInTheDocument();

    press("pointerdown", "touch", 1, 0);
    press("pointerup", "touch", 1, 40);
    press("pointerdown", "touch", 1, 0);
    press("pointerdown", "touch", 2, 100);
    press("pointerup", "touch", 1, 0);
    press("pointerup", "touch", 2, 60);
    await nextFrame();

    expect(screen.getByText(HINT_TEXT).elements()).toHaveLength(0);

    press("pointerdown", "touch", 1, 0);
    press("pointerup", "touch", 1, 2);

    await expect.element(screen.getByText(HINT_TEXT)).toBeVisible();
  });

  it("waits for the settings to close before it shows", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const { engine } = await startTestEngine();

    useInterfaceStore.getState().setSettingsOpen(true);

    const screen = await render(<FilmingHint />);

    engine.filming.set({ isInterfaceHidden: true });
    await nextFrame();
    vi.advanceTimersByTime(HINT_MILLISECONDS);

    expect(screen.getByText(HINT_TEXT).elements()).toHaveLength(0);

    useInterfaceStore.getState().setSettingsOpen(false);

    await expect.element(screen.getByText(HINT_TEXT)).toBeVisible();
  });

  it("puts the selected power down at the first touch while the interface is hidden", async () => {
    const { engine } = await startTestEngine();

    usePowerStore.getState().selectPower("meteor");

    const screen = await render(<FilmingHint />);

    engine.filming.set({ isInterfaceHidden: true });

    await expect.element(screen.getByText(HINT_TEXT)).toBeVisible();

    press("pointerdown", "mouse", 1, 0);

    expect(usePowerStore.getState().selectedPowerId).toBe("meteor");

    press("pointerdown", "touch", 2, 0);

    expect(usePowerStore.getState().selectedPowerId).toBeNull();
  });

  it("leaves H alone while a field is typed into", async () => {
    const { engine } = await startTestEngine();

    const screen = await render(
      <>
        <FilmingHint />

        <input aria-label="Name" />
      </>
    );

    await screen.getByRole("textbox", { name: "Name" }).click();
    await userEvent.keyboard("h");

    expect(engine.filming.settings.isInterfaceHidden).toBe(false);
  });
});
