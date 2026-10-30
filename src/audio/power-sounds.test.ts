import { describe, expect, it } from "vitest";
import type { SimulationCommand } from "../simulation/commands.ts";
import { PowerSounds } from "./power-sounds.ts";
import { SOUNDS } from "./sound-catalog.ts";
import { createTestSoundEngine, flatGroundPoint } from "./testing/test-sound-engine.ts";

const DEER: SimulationCommand = { parameters: {}, powerId: "deer", type: "usePower", x: 10, z: 20 };
const PLACE = { x: 10, y: 0, z: 20 };

describe("power sounds", () => {
  it("keeps a refused cast silent", () => {
    const { engine, play } = createTestSoundEngine();
    const powers = new PowerSounds(engine, flatGroundPoint);

    powers.hear(DEER, 0, false);
    powers.settle(true);

    expect(play).not.toHaveBeenCalled();
  });

  it("plays the spawn and then the call of an animal once the cast went through", () => {
    const { engine, play } = createTestSoundEngine();
    const powers = new PowerSounds(engine, flatGroundPoint);

    powers.hear(DEER, 0, false);

    expect(play).not.toHaveBeenCalled();

    powers.settle(false);

    expect(play.mock.calls).toEqual([
      [SOUNDS.spawn, PLACE, { delaySeconds: 0 }],
      [SOUNDS.animalDeer, PLACE, { delaySeconds: 0.3 }],
    ]);
  });

  it("settles a cast sent during an advance on the frame after that advance", () => {
    const { engine, play } = createTestSoundEngine();
    const powers = new PowerSounds(engine, flatGroundPoint);

    powers.hear(DEER, 0, true);
    powers.settle(false);

    expect(play).not.toHaveBeenCalled();

    powers.settle(true);
    powers.settle(false);

    expect(play).not.toHaveBeenCalled();
  });
});
