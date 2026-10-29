import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { FILMING_OFF, FILMING_ON } from "../../game/filming.ts";
import { startTestEngine } from "../testing/engine-fixtures.ts";
import { FilmingSection } from "./filming-section.tsx";

describe("filming section", () => {
  it("stays empty until the engine starts", async () => {
    const screen = await render(<FilmingSection />);

    expect(screen.container).toBeEmptyDOMElement();
  });

  it("turns one optimization off from its switch", async () => {
    const { engine } = await startTestEngine();

    const screen = await render(<FilmingSection />);

    await screen.getByRole("switch", { name: "Shadows at any distance" }).click();

    expect(engine.filming.settings).toEqual({ ...FILMING_OFF, hasFarShadows: true });
    await expect.element(screen.getByRole("switch", { name: "Shadows at any distance" })).toBeChecked();
  });

  it("shows settings a recording script changed", async () => {
    const { engine } = await startTestEngine();

    const screen = await render(<FilmingSection />);

    engine.filming.set({ isInterfaceHidden: true });

    await expect.element(screen.getByRole("switch", { name: "Hide interface" })).toBeChecked();
  });

  it("turns everything on and off at once", async () => {
    const { engine } = await startTestEngine();

    const screen = await render(<FilmingSection />);

    await screen.getByRole("button", { name: "All on" }).click();

    expect(engine.filming.settings).toEqual(FILMING_ON);

    await screen.getByRole("button", { name: "All off" }).click();

    expect(engine.filming.settings).toEqual(FILMING_OFF);
  });
});
