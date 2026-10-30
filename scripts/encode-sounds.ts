import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const OUTPUT = fileURLToPath(new URL("../src/audio/sounds/", import.meta.url));
const SHORT_SECONDS = 1.5;
const PEAK_CEILING = -1;
const SILENT_PEAK = -45;
const SHORTEST_SECONDS = 0.15;
const LOUDNESS_PATTERN = /I:\s+(?<value>-?[\d.]+) LUFS/u;
const PEAK_PATTERN = /Peak:\s+(?<value>-?[\d.]+) dBFS/u;

const cueSchema = z.object({
  group: z.enum(["ambience", "effects", "interface", "music"]),
  id: z.string(),
  kind: z.enum(["effect", "music"]),
  loop: z.boolean().optional(),
});

type Cue = z.output<typeof cueSchema>;

type SoundGroup = Cue["group"];

const LOUDNESS: Readonly<Record<SoundGroup, number>> = { ambience: -26, effects: -20, interface: -24, music: -20 };
const SHORT_PEAK: Readonly<Record<SoundGroup, number>> = { ambience: -6, effects: -6, interface: -10, music: -6 };

interface Measurement {
  readonly loudness: number;
  readonly peak: number;
  readonly seconds: number;
}

function run(command: string, parameters: readonly string[]): string {
  const result = spawnSync(command, parameters, { encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr}`);
  }

  return `${result.stdout}${result.stderr}`;
}

function numberAfter(text: string, pattern: RegExp): number {
  const groups = pattern.exec(text)?.groups;

  if (groups === undefined) {
    return Number.NEGATIVE_INFINITY;
  }

  const { value } = groups;

  return value === undefined ? Number.NEGATIVE_INFINITY : Number.parseFloat(value);
}

function measure(file: string): Measurement {
  const log = run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const summary = log.slice(log.lastIndexOf("Summary:"));
  const duration = run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);

  return {
    loudness: numberAfter(summary, LOUDNESS_PATTERN),
    peak: numberAfter(summary, PEAK_PATTERN),
    seconds: Number.parseFloat(duration),
  };
}

function cleanupFilters(cue: Cue): string[] {
  const filters = ["aresample=48000"];

  if (cue.kind === "music") {
    return filters;
  }

  filters.push("pan=mono|c0=0.5*c0+0.5*c1");

  if (cue.loop === true) {
    return filters;
  }

  return [
    ...filters,
    "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.005",
    "areverse",
    "silenceremove=start_periods=1:start_threshold=-60dB",
    "afade=t=in:d=0.03",
    "areverse",
  ];
}

function gainFor(cue: Cue, measurement: Measurement): number {
  if (measurement.seconds < SHORT_SECONDS) {
    return SHORT_PEAK[cue.group] - measurement.peak;
  }

  return Math.min(LOUDNESS[cue.group] - measurement.loudness, PEAK_CEILING - measurement.peak);
}

function encode(cue: Cue, master: string, name: string): Measurement {
  const cleaned = join(OUTPUT, `${name}.wav`);

  run("ffmpeg", ["-y", "-v", "error", "-i", master, "-af", cleanupFilters(cue).join(","), cleaned]);

  const measurement = measure(cleaned);

  if (measurement.peak < SILENT_PEAK || measurement.seconds < SHORTEST_SECONDS) {
    rmSync(cleaned);

    throw new Error(`${name} is nearly silent; generate it again`);
  }

  const bitrate = cue.kind === "music" ? "64k" : "48k";
  const gain = gainFor(cue, measurement).toFixed(2);

  run("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    cleaned,
    "-af",
    `volume=${gain}dB`,
    "-c:a",
    "libopus",
    "-b:a",
    bitrate,
    join(OUTPUT, `${name}.webm`),
  ]);
  rmSync(cleaned);

  return measurement;
}

function main(): void {
  const [folder] = process.argv.slice(2);

  if (folder === undefined) {
    throw new Error("Usage: bun scripts/encode-sounds.ts <folder with cues.json and masters>");
  }

  const cues = new Map(
    z
      .array(cueSchema)
      .parse(JSON.parse(readFileSync(join(folder, "cues.json"), "utf8")))
      .map((cue) => {
        return [cue.id, cue];
      })
  );
  const masters = join(folder, "masters");

  mkdirSync(OUTPUT, { recursive: true });

  for (const file of readdirSync(masters).toSorted()) {
    const { name } = parse(file);
    const cue = cues.get(name.slice(0, name.lastIndexOf("-")));

    if (cue === undefined) {
      throw new Error(`${file} has no cue in cues.json`);
    }

    const { seconds } = encode(cue, join(masters, file), name);

    console.log(`${name}: ${seconds.toFixed(2)} s`);
  }
}

main();
