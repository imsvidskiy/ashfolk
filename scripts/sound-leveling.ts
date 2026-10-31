import { z } from "zod";

export const cueSchema = z.object({
  group: z.enum(["ambience", "effects", "interface", "music"]),
  id: z.string(),
  kind: z.enum(["effect", "music"]),
  loop: z.boolean().optional(),
});

const PEAK_CEILING = -1;
const SETTLED_DECIBELS = 0.1;
const LEVELING_PASSES = 4;
const INTEGRATED_PATTERN = /I:\s+(?<value>-?[\d.]+) LUFS/u;
const MOMENTARY_PATTERN = /M:\s*(?<value>-?[\d.]+)/u;
const PEAK_PATTERN = /Peak:\s+(?<value>-?[\d.]+) dBFS/u;

export type Cue = z.output<typeof cueSchema>;

type Level = Cue["group"] | "effectLoops";

const LOUDNESS: Readonly<Record<Level, number>> = {
  ambience: -26,
  effectLoops: -27,
  effects: -24,
  interface: -27,
  music: -20,
};

export interface Measurement {
  readonly loudness: number;
  readonly peak: number;
  readonly seconds: number;
}

export interface Encoder {
  readonly compress: (gain: number) => void;
  readonly measure: () => Measurement;
}

interface Pass {
  readonly gain: number;
  readonly leveled: Measurement;
  readonly miss: number;
}

function numberAfter(text: string, pattern: RegExp): number {
  const groups = pattern.exec(text)?.groups;

  if (groups === undefined) {
    return Number.NEGATIVE_INFINITY;
  }

  const { value } = groups;

  return value === undefined ? Number.NEGATIVE_INFINITY : Number.parseFloat(value);
}

function loudestMomentary(log: string): number {
  let loudest = Number.NEGATIVE_INFINITY;

  for (const line of log.split("\n")) {
    loudest = Math.max(loudest, numberAfter(line, MOMENTARY_PATTERN));
  }

  return loudest;
}

export function isBed(cue: Cue): boolean {
  return cue.kind === "music" || cue.loop === true;
}

function levelOf(cue: Cue): Level {
  return cue.group === "effects" && isBed(cue) ? "effectLoops" : cue.group;
}

export function gainFor(cue: Cue, measurement: Measurement): number {
  return Math.min(LOUDNESS[levelOf(cue)] - measurement.loudness, PEAK_CEILING - measurement.peak);
}

export function parseMeasurement(cue: Cue, log: string, seconds: number): Measurement {
  const summaryStart = log.lastIndexOf("Summary:");
  const summary = log.slice(summaryStart);

  return {
    loudness: isBed(cue) ? numberAfter(summary, INTEGRATED_PATTERN) : loudestMomentary(log.slice(0, summaryStart)),
    peak: numberAfter(summary, PEAK_PATTERN),
    seconds,
  };
}

export function encodeLeveled(cue: Cue, measurement: Measurement, encoder: Encoder): Measurement {
  const passes: Pass[] = [];
  let gain = gainFor(cue, measurement);

  for (let pass = 0; pass < LEVELING_PASSES; pass += 1) {
    encoder.compress(gain);

    const leveled = encoder.measure();
    const correction = gainFor(cue, leveled);
    const miss = Math.abs(correction);

    if (miss < SETTLED_DECIBELS) {
      return leveled;
    }

    passes.push({ gain, leveled, miss });
    gain += correction;
  }

  const closest = passes.reduce((best, next) => {
    return next.miss < best.miss ? next : best;
  });

  encoder.compress(closest.gain);

  return closest.leveled;
}
