import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { startTestEngine } from "../testing/engine-fixtures.ts";
import { FilmingHint } from "./filming-hint.tsx";

describe("filming hint", () => {
  it("hides and shows the interface with H", async () => {
    const { engine } = await startTestEngine();

    const screen = await render(<FilmingHint />);

    await userEvent.keyboard("h");

    expect(engine.filming.settings.isInterfaceHidden).toBe(true);
    await expect.element(screen.getByText("Interface hidden. Press H to show it.")).toBeVisible();

    await userEvent.keyboard("h");

    expect(engine.filming.settings.isInterfaceHidden).toBe(false);
    await expect.element(screen.getByText("Interface hidden. Press H to show it.")).not.toBeInTheDocument();
  });

  it("shows the interface again from its button", async () => {
    const { engine } = await startTestEngine();

    const screen = await render(<FilmingHint />);

    engine.filming.set({ isInterfaceHidden: true });
    await screen.getByRole("button", { name: "Show" }).click();

    expect(engine.filming.settings.isInterfaceHidden).toBe(false);
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
