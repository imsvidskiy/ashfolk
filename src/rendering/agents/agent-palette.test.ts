import { afterEach, describe, expect, it } from "vitest";
import { MaterialSlot } from "../../models/materials.ts";
import { AgentPalette } from "./agent-palette.ts";

const LAYOUT = { boneCount: 1, colorSlots: [MaterialSlot.Skin] };
const CHANNELS = 4;
const TILT = 0.2;
const ROW = 0;

const palettes: AgentPalette[] = [];

function uprightPalette(): AgentPalette {
  const palette = new AgentPalette(LAYOUT);
  const offset = palette.rowOffset(ROW);

  for (let axis = 0; axis < 3; axis += 1) {
    palette.data[offset + axis * CHANNELS + axis] = 1;
  }

  palettes.push(palette);

  return palette;
}

function worldUp(palette: AgentPalette, heading: number): { x: number; y: number; z: number } {
  const offset = palette.rowOffset(ROW);
  const x = palette.data[offset + 1];
  const y = palette.data[offset + CHANNELS + 1];
  const z = palette.data[offset + 2 * CHANNELS + 1];
  const cosine = Math.cos(heading);
  const sine = Math.sin(heading);

  return { x: x * cosine + z * sine, y, z: z * cosine - x * sine };
}

describe("agent palette", () => {
  afterEach(() => {
    for (const palette of palettes.splice(0)) {
      palette.dispose();
    }
  });

  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 3])("tips a figure facing %f toward the world tilt", (heading) => {
    const towardX = uprightPalette();
    const towardZ = uprightPalette();

    towardX.tiltToward(ROW, heading, TILT, 0);
    towardZ.tiltToward(ROW, heading, 0, TILT);

    const upX = worldUp(towardX, heading);
    const upZ = worldUp(towardZ, heading);

    expect(upX.x).toBeCloseTo(Math.sin(TILT));
    expect(upX.z).toBeCloseTo(0);
    expect(upZ.x).toBeCloseTo(0);
    expect(upZ.z).toBeCloseTo(Math.sin(TILT));
  });
});
