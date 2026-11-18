import { useState } from "react";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { SOUNDS } from "../../audio/sound-catalog.ts";
import { ToggleField } from "../../design/toggle-field.tsx";
import { ignore } from "../../shared/ignore.ts";
import { connectSound, sound } from "./sound.ts";

function Setting() {
  const [checked, setChecked] = useState(false);

  return <ToggleField isChecked={checked} label="Show labels" onChange={setChecked} />;
}

function hearInterface() {
  const play = vi.spyOn(sound, "play").mockImplementation(ignore);

  onTestFinished(connectSound(window));

  return play;
}

describe("app interface sound", () => {
  it("opens and closes island options before there is a game session", async () => {
    const play = hearInterface();
    const screen = await render(
      <details>
        <summary>Island options</summary>
        Seed
      </details>
    );

    await screen.getByText("Island options").click();
    await vi.waitFor(() => {
      expect(play).toHaveBeenCalledExactlyOnceWith(SOUNDS.uiOpen, null);
    });

    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => {
      expect(play.mock.calls).toEqual([
        [SOUNDS.uiOpen, null],
        [SOUNDS.uiClose, null],
      ]);
    });
  });

  it("hears the actual switch once for a pointer and once for the keyboard", async () => {
    const play = hearInterface();
    const screen = await render(<Setting />);
    const toggle = screen.getByRole("switch", { name: "Show labels" });

    await toggle.click();
    await vi.waitFor(() => {
      expect(play).toHaveBeenCalledExactlyOnceWith(SOUNDS.uiToggleOn, null);
    });

    await userEvent.keyboard(" ");
    await vi.waitFor(() => {
      expect(play.mock.calls).toEqual([
        [SOUNDS.uiToggleOn, null],
        [SOUNDS.uiToggleOff, null],
      ]);
    });
  });

  it("confirms a native select change without sounding when it merely gains focus", async () => {
    const play = hearInterface();
    const screen = await render(
      <select aria-label="Section" defaultValue="General">
        <option>General</option>
        <option>Sound</option>
      </select>
    );
    const select = screen.getByRole("combobox", { name: "Section" });

    select.element().focus();
    expect(play).not.toHaveBeenCalled();
    await select.selectOptions("Sound");
    await vi.waitFor(() => {
      expect(play).toHaveBeenCalledExactlyOnceWith(SOUNDS.uiTab, null);
    });
  });
});
