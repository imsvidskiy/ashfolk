import { afterEach, describe, expect, it } from "vitest";
import { InterfaceSounds } from "./interface-sounds.ts";
import { SOUNDS, type SoundDefinition } from "./sound-catalog.ts";
import { createTestSoundEngine } from "./testing/test-sound-engine.ts";

const detachers: (() => void)[] = [];

function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function soundsOfClick(markup: string): Promise<SoundDefinition[]> {
  const { engine, play } = createTestSoundEngine();
  const sounds = new InterfaceSounds(engine);
  const host = document.createElement("div");

  host.innerHTML = markup;
  document.body.append(host);
  detachers.push(sounds.attach(document), () => {
    host.remove();
  });

  const target = host.querySelector("[data-target]");

  target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await settle();

  return play.mock.calls.map(([sound]) => {
    return sound;
  });
}

describe("click sounds", () => {
  afterEach(() => {
    for (const detach of detachers.splice(0)) {
      detach();
    }
  });

  it("clicks for a button and for what sits inside it", async () => {
    expect(await soundsOfClick('<button data-target type="button">Go</button>')).toEqual([SOUNDS.uiClick]);
    expect(await soundsOfClick('<button type="button"><span data-target>Go</span></button>')).toEqual([SOUNDS.uiClick]);
  });

  it("uses the tab sound for tabs", async () => {
    expect(await soundsOfClick('<div data-target role="tab">Tools</div>')).toEqual([SOUNDS.uiTab]);
  });

  it("stays silent for disabled controls", async () => {
    expect(await soundsOfClick('<button data-target disabled type="button">Go</button>')).toEqual([]);
    expect(await soundsOfClick('<div aria-disabled="true" data-target role="button">Go</div>')).toEqual([]);
  });

  it("stays silent for text that is not a control", async () => {
    expect(await soundsOfClick("<p data-target>Text</p>")).toEqual([]);
  });
});
