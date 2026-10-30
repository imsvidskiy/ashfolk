import type { EngineHandle } from "../game/engine-handle.ts";
import { clamp } from "../shared/math.ts";
import type { LavaView, SimulationFrame } from "../simulation/frame.ts";
import type { VolcanoView } from "../simulation/powers/volcanoes.ts";
import type { WorldGrid } from "../world/world-grid.ts";
import { AmbienceMixer, sampleAmbience } from "./ambience.ts";
import { ambienceLevels } from "./ambience-levels.ts";
import { EffectSounds } from "./effect-sounds.ts";
import { type Emitter, EmitterLoops, groupCells } from "./emitters.ts";
import type { HearingView } from "./hearing-view.ts";
import { MusicPlayer } from "./music-player.ts";
import { PowerSounds } from "./power-sounds.ts";
import { SOUNDS } from "./sound-catalog.ts";
import type { SoundEngine, SoundPoint } from "./sound-engine.ts";
import { StorySounds } from "./story-sounds.ts";
import { WorkSounds } from "./work-sounds.ts";

const AMBIENCE_INTERVAL_SECONDS = 0.5;
const LONGEST_STEP_SECONDS = 0.1;
const HEARING_HEIGHT_SHARE = 0.45;
const LOWEST_HEARING = 18;
const HIGHEST_HEARING = 350;
const FIRE_BUCKET = 80;
const FIRE_EMITTERS = 4;
const LAVA_EMITTERS = 3;
const HOT_LAVA = 40;
const MILLISECONDS_PER_SECOND = 1000;
const LISTENER_TOLERANCE = 1e-3;

const PRELOADED = [
  SOUNDS.handDrop,
  SOUNDS.handGrab,
  SOUNDS.uiClick,
  SOUNDS.uiClose,
  SOUNDS.uiOpen,
  SOUNDS.uiPower,
  SOUNDS.uiRefuse,
  SOUNDS.uiTab,
];

type WorldEngine = Pick<EngineHandle, "camera" | "session" | "subscribeToRenders">;

interface Listener {
  readonly forward: SoundPoint;
  readonly position: SoundPoint;
  readonly up: SoundPoint;
}

function secondsNow(): number {
  return performance.now() / MILLISECONDS_PER_SECOND;
}

function hotLava(lava: LavaView): number[] {
  const cells: number[] = [];

  for (const [index, cell] of lava.cells.entries()) {
    if (lava.heat[index] >= HOT_LAVA) {
      cells.push(cell);
    }
  }

  return cells;
}

function lavaEmitters(
  grid: WorldGrid,
  lava: LavaView | null,
  volcanoes: readonly VolcanoView[],
  view: HearingView
): Emitter[] {
  const flows =
    lava === null
      ? []
      : groupCells(grid, hotLava(lava), {
          bucketSize: FIRE_BUCKET,
          focusX: view.focusX,
          focusZ: view.focusZ,
          limit: LAVA_EMITTERS,
        });
  const craters = volcanoes
    .filter((volcano) => {
      return volcano.activity > 0;
    })
    .map((volcano) => {
      return { key: `crater ${volcano.x},${volcano.z}`, volume: volcano.activity, x: volcano.x, z: volcano.z };
    });

  return [...flows, ...craters];
}

function listenerOf(engine: WorldEngine, groundPoint: (x: number, z: number) => SoundPoint): Listener {
  const { elements } = engine.camera.camera.matrixWorld;
  const { distance, targetX, targetZ } = engine.camera.state;

  const focus = groundPoint(targetX, targetZ);
  const toCamera = { x: elements[12] - focus.x, y: elements[13] - focus.y, z: elements[14] - focus.z };
  const length = Math.max(1e-6, Math.hypot(toCamera.x, toCamera.y, toCamera.z));
  const hearing = clamp(distance * HEARING_HEIGHT_SHARE, LOWEST_HEARING, HIGHEST_HEARING);

  return {
    forward: { x: -elements[8], y: -elements[9], z: -elements[10] },
    position: {
      x: focus.x + (toCamera.x / length) * hearing,
      y: focus.y + (toCamera.y / length) * hearing,
      z: focus.z + (toCamera.z / length) * hearing,
    },
    up: { x: elements[4], y: elements[5], z: elements[6] },
  };
}

function isNear(first: SoundPoint, second: SoundPoint): boolean {
  return (
    Math.abs(first.x - second.x) < LISTENER_TOLERANCE &&
    Math.abs(first.y - second.y) < LISTENER_TOLERANCE &&
    Math.abs(first.z - second.z) < LISTENER_TOLERANCE
  );
}

function isSameListener(first: Listener, second: Listener): boolean {
  return (
    isNear(first.position, second.position) && isNear(first.forward, second.forward) && isNear(first.up, second.up)
  );
}

export function connectWorldSounds(engine: WorldEngine, sound: SoundEngine): () => void {
  const { mirror } = engine.session;

  function groundPoint(x: number, z: number): SoundPoint {
    return { x, y: mirror.heightAt(x, z), z };
  }

  function viewOf(): HearingView {
    const { distance, targetX, targetZ } = engine.camera.state;

    return { focusX: targetX, focusZ: targetZ, viewDistance: distance };
  }

  const ambience = new AmbienceMixer(sound);
  const effects = new EffectSounds(sound, groundPoint);
  const fires = new EmitterLoops(sound, SOUNDS.fire, groundPoint);
  const lavas = new EmitterLoops(sound, SOUNDS.lava, groundPoint);
  const music = new MusicPlayer(sound, secondsNow());
  const powers = new PowerSounds(sound, groundPoint);
  const story = new StorySounds(sound, groundPoint);
  const work = new WorkSounds(sound, groundPoint);
  let frame: SimulationFrame = engine.session.frame;
  let knownLava: LavaView | null = null;
  let isHolding = frame.held !== null;
  let hasPreloaded = false;
  let heardListener: Listener | null = null;
  let lastRender = secondsNow();
  let nextAmbienceAt = 0;

  function hearFrame(next: SimulationFrame): void {
    const now = secondsNow();
    const view = viewOf();
    const wasRefused = next.notices.length > 0;
    const isHoldingNow = next.held !== null;

    frame = next;
    powers.settle(wasRefused);

    if (wasRefused) {
      sound.play(SOUNDS.uiRefuse, null);
    }

    if (isHoldingNow !== isHolding) {
      isHolding = isHoldingNow;
      sound.play(isHolding ? SOUNDS.handGrab : SOUNDS.handDrop, null);
    }

    if (next.lava !== null) {
      knownLava = next.lava;
    }

    for (const effect of next.effects) {
      effects.hear(effect, view);
    }

    story.hear(next.chronicle, view, now);
    fires.update(
      groupCells(mirror.grid, next.burningCells, {
        bucketSize: FIRE_BUCKET,
        focusX: view.focusX,
        focusZ: view.focusZ,
        limit: FIRE_EMITTERS,
      })
    );
    lavas.update(lavaEmitters(mirror.grid, knownLava, next.volcanoes, view));

    if (!sound.isAudible) {
      return;
    }

    work.listen(next.people, next.personCount, view);
  }

  function hearRender(): void {
    const now = secondsNow();
    const step = clamp(now - lastRender, 0, LONGEST_STEP_SECONDS);

    lastRender = now;

    if (sound.context === null) {
      return;
    }

    if (!hasPreloaded) {
      hasPreloaded = true;
      sound.preload(PRELOADED);
    }

    const listener = listenerOf(engine, groundPoint);
    const gameSeconds = frame.isPaused ? 0 : step * frame.speed;

    if (heardListener === null || !isSameListener(heardListener, listener)) {
      heardListener = listener;
      sound.setListener(listener.position, listener.forward, listener.up);
    }

    effects.update(gameSeconds);
    powers.update(now);
    work.update(gameSeconds);
    music.update(now, frame.calendar.hours);

    if (now < nextAmbienceAt) {
      return;
    }

    nextAmbienceAt = now + AMBIENCE_INTERVAL_SECONDS;
    ambience.update(
      ambienceLevels(sampleAmbience(mirror, { ...viewOf(), calendar: frame.calendar, weather: frame.weather })),
      now
    );
  }

  const unsubscribeFrames = engine.session.subscribe(hearFrame);
  const unsubscribeCommands = engine.session.subscribeToCommands((command) => {
    powers.hear(command, secondsNow(), engine.session.isAdvancing);
  });
  const unsubscribeRenders = engine.subscribeToRenders(hearRender);

  return () => {
    unsubscribeFrames();
    unsubscribeCommands();
    unsubscribeRenders();
    ambience.dispose();
    effects.dispose();
    fires.dispose();
    lavas.dispose();
    music.dispose();
    powers.dispose();
  };
}
