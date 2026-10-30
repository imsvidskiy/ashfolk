import { ignore } from "../shared/ignore.ts";
import type { SoundBus, SoundDefinition } from "./sound-catalog.ts";
import { heardLoudness, voiceToReplace } from "./voices.ts";

const MAXIMUM_VOICES = 24;
const QUIETEST_HEARD = 0.01;
const STEAL_FADE_SECONDS = 0.04;
const LEVEL_SMOOTHING_SECONDS = 0.08;
const LISTENER_SMOOTHING_SECONDS = 0.03;
const EFFECT_PITCH_SPREAD = 0.05;
const MAXIMUM_DISTANCE = 20_000;
const GESTURES = ["pointerdown", "pointerup", "touchend", "keydown"] as const;
const BUSES: readonly SoundBus[] = ["ambience", "effects", "interface", "music"];

export interface SoundLevels {
  readonly ambience: number;
  readonly effects: number;
  readonly interface: number;
  readonly isMuted: boolean;
  readonly master: number;
  readonly music: number;
}

export const DEFAULT_SOUND_LEVELS: SoundLevels = {
  ambience: 0.7,
  effects: 0.8,
  interface: 0.6,
  isMuted: false,
  master: 0.8,
  music: 0.5,
};

export interface SoundPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PlayOptions {
  readonly delaySeconds?: number;
  readonly volume?: number;
}

export interface LoopFade {
  readonly seconds: number;
  readonly volume: number;
}

export interface SoundLoop {
  readonly setPosition: (point: SoundPoint) => void;
  readonly setVolume: (volume: number, smoothingSeconds: number) => void;
  readonly stop: (fadeSeconds: number) => void;
}

interface Voice {
  readonly gain: GainNode;
  readonly loudness: number;
  readonly priority: number;
  readonly source: AudioBufferSourceNode;
}

interface Playback {
  readonly buffer: AudioBuffer | null;
  readonly point: SoundPoint | null;
  readonly sound: SoundDefinition;
  readonly startAt: number;
  readonly volume: number;
}

interface Graph {
  readonly buses: Readonly<Record<SoundBus, GainNode>>;
  readonly context: AudioContext;
  readonly master: GainNode;
}

function perceived(level: number): number {
  return level * level;
}

function pickFile(sound: SoundDefinition): string {
  return sound.files[Math.floor(Math.random() * sound.files.length)];
}

function createGraph(): Graph {
  const context = new AudioContext({ latencyHint: "interactive" });
  const master = context.createGain();

  master.connect(context.destination);

  const buses = {
    ambience: context.createGain(),
    effects: context.createGain(),
    interface: context.createGain(),
    music: context.createGain(),
  };

  for (const bus of BUSES) {
    buses[bus].connect(master);
  }

  return { buses, context, master };
}

function createPanner(context: AudioContext, sound: SoundDefinition, point: SoundPoint): PannerNode {
  return new PannerNode(context, {
    distanceModel: "inverse",
    maxDistance: MAXIMUM_DISTANCE,
    panningModel: "equalpower",
    positionX: point.x,
    positionY: point.y,
    positionZ: point.z,
    refDistance: sound.referenceDistance,
    rolloffFactor: 1,
  });
}

function isPlaced(sound: SoundDefinition, point: SoundPoint | null): point is SoundPoint {
  return point !== null && sound.referenceDistance > 0;
}

function hasPositionParameters(listener: AudioListener): boolean {
  return "positionX" in listener;
}

function placePanner(panner: PannerNode, point: SoundPoint, now: number): void {
  panner.positionX.setTargetAtTime(point.x, now, LISTENER_SMOOTHING_SECONDS);
  panner.positionY.setTargetAtTime(point.y, now, LISTENER_SMOOTHING_SECONDS);
  panner.positionZ.setTargetAtTime(point.z, now, LISTENER_SMOOTHING_SECONDS);
}

export class SoundEngine {
  readonly #buffers = new Map<string, Promise<AudioBuffer | null>>();
  readonly #voices: Voice[] = [];
  #graph: Graph | null = null;
  #isHidden = false;
  #levels: SoundLevels = DEFAULT_SOUND_LEVELS;
  #listener: SoundPoint = { x: 0, y: 0, z: 0 };

  get context(): AudioContext | null {
    return this.#graph === null ? null : this.#graph.context;
  }

  get isAudible(): boolean {
    return this.#graph !== null && !this.#levels.isMuted && !this.#isHidden;
  }

  get levels(): SoundLevels {
    return this.#levels;
  }

  attach(target: Window): () => void {
    const abort = new AbortController();

    for (const gesture of GESTURES) {
      target.addEventListener(
        gesture,
        () => {
          this.#unlock();
        },
        { capture: true, passive: true, signal: abort.signal }
      );
    }

    target.document.addEventListener(
      "visibilitychange",
      () => {
        this.#isHidden = target.document.visibilityState === "hidden";
        this.#applyRunning();
      },
      { signal: abort.signal }
    );

    return () => {
      abort.abort();
    };
  }

  setLevels(levels: SoundLevels): void {
    this.#levels = levels;

    const graph = this.#graph;

    if (graph === null) {
      return;
    }

    const now = graph.context.currentTime;

    graph.master.gain.setTargetAtTime(levels.isMuted ? 0 : perceived(levels.master), now, LEVEL_SMOOTHING_SECONDS);

    for (const bus of BUSES) {
      graph.buses[bus].gain.setTargetAtTime(perceived(levels[bus]), now, LEVEL_SMOOTHING_SECONDS);
    }

    this.#applyRunning();
  }

  busOutput(bus: SoundBus): GainNode | null {
    return this.#graph === null ? null : this.#graph.buses[bus];
  }

  setListener(position: SoundPoint, forward: SoundPoint, up: SoundPoint): void {
    this.#listener = position;

    const graph = this.#graph;

    if (graph === null) {
      return;
    }

    const { listener } = graph.context;

    // Firefox has no AudioParams on the listener yet.
    if (!hasPositionParameters(listener)) {
      listener.setPosition(position.x, position.y, position.z);
      listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);

      return;
    }

    const now = graph.context.currentTime;

    listener.positionX.setTargetAtTime(position.x, now, LISTENER_SMOOTHING_SECONDS);
    listener.positionY.setTargetAtTime(position.y, now, LISTENER_SMOOTHING_SECONDS);
    listener.positionZ.setTargetAtTime(position.z, now, LISTENER_SMOOTHING_SECONDS);
    listener.forwardX.setTargetAtTime(forward.x, now, LISTENER_SMOOTHING_SECONDS);
    listener.forwardY.setTargetAtTime(forward.y, now, LISTENER_SMOOTHING_SECONDS);
    listener.forwardZ.setTargetAtTime(forward.z, now, LISTENER_SMOOTHING_SECONDS);
    listener.upX.setTargetAtTime(up.x, now, LISTENER_SMOOTHING_SECONDS);
    listener.upY.setTargetAtTime(up.y, now, LISTENER_SMOOTHING_SECONDS);
    listener.upZ.setTargetAtTime(up.z, now, LISTENER_SMOOTHING_SECONDS);
  }

  heardAt(sound: SoundDefinition, point: SoundPoint | null): number {
    if (!isPlaced(sound, point)) {
      return sound.volume;
    }

    const listener = this.#listener;
    const distance = Math.hypot(point.x - listener.x, point.y - listener.y, point.z - listener.z);

    return heardLoudness(sound.volume, sound.referenceDistance, distance);
  }

  preload(sounds: readonly SoundDefinition[]): void {
    for (const sound of sounds) {
      for (const url of sound.files) {
        this.#buffer(url);
      }
    }
  }

  play(sound: SoundDefinition, point: SoundPoint | null, options: PlayOptions = {}): void {
    const graph = this.#graph;

    if (graph === null || !this.isAudible) {
      return;
    }

    const { delaySeconds = 0, volume = 1 } = options;

    if (this.heardAt(sound, point) * volume < QUIETEST_HEARD) {
      return;
    }

    const startAt = graph.context.currentTime + delaySeconds;

    this.#buffer(pickFile(sound)).then((buffer) => {
      this.#start(graph, { buffer, point, sound, startAt, volume });
    });
  }

  loop(sound: SoundDefinition, point: SoundPoint | null, fade: LoopFade): SoundLoop | null {
    const graph = this.#graph;

    if (graph === null) {
      return null;
    }

    const { context } = graph;
    const gain = context.createGain();
    const panner = isPlaced(sound, point) ? createPanner(context, sound, point) : null;
    let source: AudioBufferSourceNode | null = null;
    let isStopped = false;

    gain.gain.value = 0;
    gain.gain.setTargetAtTime(fade.volume * sound.volume, context.currentTime, fade.seconds / 3);
    gain.connect(panner === null ? graph.buses[sound.bus] : panner);

    if (panner !== null) {
      panner.connect(graph.buses[sound.bus]);
    }

    this.#buffer(pickFile(sound)).then((buffer) => {
      if (buffer === null || isStopped) {
        return;
      }

      source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      source.start(context.currentTime, Math.random() * buffer.duration);
    });

    return {
      setPosition: (next) => {
        if (panner !== null) {
          placePanner(panner, next, context.currentTime);
        }
      },
      setVolume: (next, smoothingSeconds) => {
        gain.gain.setTargetAtTime(next * sound.volume, context.currentTime, smoothingSeconds / 3);
      },
      stop: (fadeSeconds) => {
        isStopped = true;
        gain.gain.setTargetAtTime(0, context.currentTime, fadeSeconds / 3);

        const playing = source;

        if (playing === null) {
          gain.disconnect();

          return;
        }

        playing.addEventListener("ended", () => {
          gain.disconnect();
        });
        playing.stop(context.currentTime + fadeSeconds);
      },
    };
  }

  #start(graph: Graph, playback: Playback): void {
    const { buffer, point, sound, startAt, volume } = playback;

    if (buffer === null || !this.isAudible) {
      return;
    }

    const loudness = this.heardAt(sound, point) * volume;
    const slot = voiceToReplace(this.#voices, { loudness, priority: sound.priority }, MAXIMUM_VOICES);

    if (slot < 0) {
      return;
    }

    if (slot < this.#voices.length) {
      this.#release(this.#voices[slot]);
    }

    const { context } = graph;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const panner = isPlaced(sound, point) ? createPanner(context, sound, point) : null;

    source.buffer = buffer;
    source.playbackRate.value = sound.bus === "effects" ? 1 + (Math.random() * 2 - 1) * EFFECT_PITCH_SPREAD : 1;
    gain.gain.value = sound.volume * volume;
    source.connect(gain);
    gain.connect(panner === null ? graph.buses[sound.bus] : panner);

    if (panner !== null) {
      panner.connect(graph.buses[sound.bus]);
    }

    const voice: Voice = { gain, loudness, priority: sound.priority, source };

    this.#voices.push(voice);
    source.addEventListener("ended", () => {
      this.#forget(voice);
      gain.disconnect();
    });
    source.start(Math.max(startAt, context.currentTime));
  }

  #release(voice: Voice): void {
    const graph = this.#graph;

    this.#forget(voice);

    if (graph === null) {
      return;
    }

    const now = graph.context.currentTime;

    voice.gain.gain.setTargetAtTime(0, now, STEAL_FADE_SECONDS / 3);
    voice.source.stop(now + STEAL_FADE_SECONDS);
  }

  #forget(voice: Voice): void {
    const index = this.#voices.indexOf(voice);

    if (index >= 0) {
      this.#voices.splice(index, 1);
    }
  }

  #buffer(url: string): Promise<AudioBuffer | null> {
    const known = this.#buffers.get(url);

    if (known !== undefined) {
      return known;
    }

    const graph = this.#graph;

    if (graph === null) {
      return Promise.resolve(null);
    }

    const loading = fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`The server answered ${response.status}`);
        }

        return response.arrayBuffer();
      })
      .then((data) => {
        return graph.context.decodeAudioData(data);
      })
      .catch((error: unknown) => {
        console.warn(`Could not load the sound ${url}`, error);

        return null;
      });

    this.#buffers.set(url, loading);

    return loading;
  }

  #unlock(): void {
    if (this.#graph === null) {
      if (typeof AudioContext === "undefined") {
        return;
      }

      this.#graph = createGraph();
      this.setLevels(this.#levels);
    }

    this.#applyRunning();
  }

  #applyRunning(): void {
    const graph = this.#graph;

    if (graph === null) {
      return;
    }

    if (this.isAudible) {
      graph.context.resume().catch(ignore);

      return;
    }

    graph.context.suspend().catch(ignore);
  }
}
