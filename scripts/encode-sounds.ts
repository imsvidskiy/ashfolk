import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { type Cue, cueSchema, encodeLeveled, isBed, type Measurement, parseMeasurement } from "./sound-leveling.ts";

const OUTPUT = fileURLToPath(new URL("../src/audio/sounds/", import.meta.url));
const SILENT_PEAK = -45;
const SHORTEST_SECONDS = 0.15;
const MOMENTARY_SECONDS = 0.4;

function run(command: string, parameters: readonly string[]): string {
  const result = spawnSync(command, parameters, { encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr}`);
  }

  return `${result.stdout}${result.stderr}`;
}

function measure(cue: Cue, file: string): Measurement {
  const meter = isBed(cue) ? "ebur128=peak=true" : `apad=pad_dur=${MOMENTARY_SECONDS},ebur128=peak=true`;
  const log = run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", meter, "-f", "null", "-"]);
  const duration = run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);

  return parseMeasurement(cue, log, Number.parseFloat(duration));
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

function compress(cue: Cue, cleaned: string, encoded: string, gain: number): void {
  run("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    cleaned,
    "-af",
    `volume=${gain.toFixed(2)}dB`,
    "-c:a",
    "libopus",
    "-b:a",
    cue.kind === "music" ? "64k" : "48k",
    "-fflags",
    "+bitexact",
    encoded,
  ]);
}

function encode(cue: Cue, master: string, scratch: string, name: string): Measurement {
  const cleaned = join(scratch, `${name}.wav`);
  const encoded = join(OUTPUT, `${name}.webm`);

  run("ffmpeg", ["-y", "-v", "error", "-i", master, "-af", cleanupFilters(cue).join(","), cleaned]);

  const measurement = measure(cue, cleaned);

  if (measurement.peak < SILENT_PEAK || measurement.seconds < SHORTEST_SECONDS) {
    throw new Error(`${name} is nearly silent; generate it again`);
  }

  return encodeLeveled(cue, measurement, {
    compress: (gain) => {
      compress(cue, cleaned, encoded, gain);
    },
    measure: () => {
      return measure(cue, encoded);
    },
  });
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
  const scratch = mkdtempSync(join(tmpdir(), "ashfolk-sounds-"));

  mkdirSync(OUTPUT, { recursive: true });

  try {
    for (const file of readdirSync(masters).toSorted()) {
      const { name } = parse(file);
      const cue = cues.get(name.slice(0, name.lastIndexOf("-")));

      if (cue === undefined) {
        throw new Error(`${file} has no cue in cues.json`);
      }

      const { loudness, peak, seconds } = encode(cue, join(masters, file), scratch, name);

      console.log(`${name}: ${loudness.toFixed(1)} LUFS, peak ${peak.toFixed(1)} dBTP, ${seconds.toFixed(2)} s`);
    }
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}

main();
