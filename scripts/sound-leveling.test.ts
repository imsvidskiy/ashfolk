import { describe, expect, it, vi } from "vitest";
import { type Cue, encodeLeveled, gainFor, type Measurement, parseMeasurement } from "./sound-leveling.ts";

const PADDED_CLICK_LOG = `[Parsed_ebur128_1 @ 0x771cc04e40] t: 0.0999792  TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU  FTPK: -33.1 dBFS  TPK: -33.1 dBFS
[Parsed_ebur128_1 @ 0x771cc04e40] t: 0.199979   TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU  FTPK: -33.1 dBFS  TPK: -33.1 dBFS
[Parsed_ebur128_1 @ 0x771cc04e40] t: 0.299979   TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU  FTPK: -33.1 dBFS  TPK: -33.1 dBFS
[Parsed_ebur128_1 @ 0x771cc04e40] t: 0.399979   TARGET:-23 LUFS    M: -39.1 S:-120.7     I: -39.1 LUFS       LRA:   0.0 LU  FTPK:  -inf dBFS  TPK: -33.1 dBFS
[Parsed_ebur128_1 @ 0x771cc04e40] t: 0.499979   TARGET:-23 LUFS    M: -42.1 S:-120.7     I: -40.3 LUFS       LRA:   0.0 LU  FTPK:  -inf dBFS  TPK: -33.1 dBFS
[Parsed_ebur128_1 @ 0x771cc04e40] t: 0.599979   TARGET:-23 LUFS    M: -78.8 S:-120.7     I: -40.3 LUFS       LRA:   0.0 LU  FTPK:  -inf dBFS  TPK: -33.1 dBFS
[Parsed_ebur128_1 @ 0x771cc04e40] Summary:

  Integrated loudness:
    I:         -40.3 LUFS
    Threshold: -50.3 LUFS

  Loudness range:
    LRA:         0.0 LU
    Threshold:   0.0 LUFS
    LRA low:     0.0 LUFS
    LRA high:    0.0 LUFS

  True peak:
    Peak:      -33.1 dBFS
`;
const CLICK_SECONDS = 0.2;
const QUIET: Measurement = { loudness: -30, peak: -20, seconds: 1 };
const ONE_SHOT: Cue = { group: "effects", id: "meteor-impact", kind: "effect" };
const EFFECT_LOOP: Cue = { group: "effects", id: "fire-crackle", kind: "effect", loop: true };
const CLICK: Cue = { group: "interface", id: "ui-click", kind: "effect" };

function fakeEncoder(loudnesses: readonly number[]) {
  const readings = loudnesses.map((loudness) => {
    return { loudness, peak: QUIET.peak, seconds: QUIET.seconds };
  });
  const compress = vi.fn<(gain: number) => void>();
  const measure = vi.fn<() => Measurement>();

  for (const reading of readings) {
    measure.mockReturnValueOnce(reading);
  }

  return { compress, measure, readings };
}

describe("sound leveling", () => {
  it("aims effect loops and interface sounds quieter than one-shot effects", () => {
    const gains = [ONE_SHOT, EFFECT_LOOP, CLICK].map((cue) => {
      return gainFor(cue, QUIET);
    });

    expect(gains).toEqual([6, 3, 3]);
  });

  it("keeps the gain under the peak ceiling", () => {
    expect(gainFor(ONE_SHOT, { loudness: -30, peak: -4, seconds: 1 })).toBe(3);
  });

  it("measures one-shots by their loudest momentary block and beds by integrated loudness", () => {
    expect(parseMeasurement(CLICK, PADDED_CLICK_LOG, CLICK_SECONDS)).toEqual({
      loudness: -39.1,
      peak: -33.1,
      seconds: CLICK_SECONDS,
    });
    expect(parseMeasurement(EFFECT_LOOP, PADDED_CLICK_LOG, CLICK_SECONDS)).toEqual({
      loudness: -40.3,
      peak: -33.1,
      seconds: CLICK_SECONDS,
    });
  });

  it("stops once a pass lands within a tenth of a decibel", () => {
    const { compress, measure, readings } = fakeEncoder([-25, -24.05]);

    const leveled = encodeLeveled(ONE_SHOT, QUIET, { compress, measure });

    expect(compress.mock.calls).toEqual([[6], [7]]);
    expect(leveled).toBe(readings[1]);
  });

  it("re-encodes at the gain of the closest pass when no pass settles", () => {
    const { compress, measure, readings } = fakeEncoder([-25, -24.5, -23.75, -24.375]);

    const leveled = encodeLeveled(ONE_SHOT, QUIET, { compress, measure });

    expect(compress.mock.calls).toEqual([[6], [7], [7.5], [7.25], [7.5]]);
    expect(leveled).toBe(readings[2]);
  });
});
