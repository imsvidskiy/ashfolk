import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useSoundStore } from "../sound/sound-store.ts";
import { SoundSection } from "./sound-section.tsx";

describe("sound section", () => {
  it("offers a volume for each part of the mix", async () => {
    const screen = await render(<SoundSection />);

    await Promise.all(
      ["Volume", "Music", "Nature", "Effects", "Interface"].map((name) => {
        return expect.element(screen.getByRole("slider", { name })).toBeInTheDocument();
      })
    );
  });

  it("turns the sound off and remembers it", async () => {
    const screen = await render(<SoundSection />);

    const sound = screen.getByRole("switch", { name: "Play sound" });

    await expect.element(sound).toBeChecked();
    await sound.click();

    await expect.element(sound).not.toBeChecked();
    expect(useSoundStore.getState().levels.isMuted).toBe(true);
    expect(localStorage.getItem("dawnfolk.sound")).toContain('"isMuted":true');
  });

  it("changes a volume from its slider", async () => {
    const screen = await render(<SoundSection />);

    screen.getByRole("slider", { name: "Music" }).element().focus();
    await userEvent.keyboard("{ArrowLeft}");

    expect(useSoundStore.getState().levels.music).toBeCloseTo(0.45);
  });
});
