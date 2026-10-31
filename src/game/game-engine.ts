import { Matrix4, PerspectiveCamera, type Vector3, type WebGPURenderer } from "three/webgpu";
import { ANIMAL_WADING_DEPTH, PERSON_WADING_DEPTH, standingHeight } from "../rendering/agents/agent-view-input.ts";
import { createGraphics, type Graphics } from "../rendering/create-graphics.ts";
import { type QualityLevel, RENDER_QUALITY } from "../rendering/render-quality.ts";
import { WorldRenderer } from "../rendering/world-renderer.ts";
import { ignore } from "../shared/ignore.ts";
import { clamp } from "../shared/math.ts";
import type { SimulationFrame } from "../simulation/frame.ts";
import type { GrabTarget } from "../simulation/hand/grab-target.ts";
import { type CameraState, GodCamera, type GroundPoint } from "./camera/god-camera.ts";
import type { EngineHandle } from "./engine-handle.ts";
import { Filming, type FilmingSettings } from "./filming.ts";
import { FramePacer } from "./frame-pacer.ts";
import type { GameSession } from "./game-session.ts";
import { EntityPicker } from "./input/entity-picker.ts";
import { GroundPicker, type ScreenPoint, type ViewportSize } from "./input/ground-picker.ts";
import { KeyboardControls } from "./input/keyboard-controls.ts";
import { PointerControls } from "./input/pointer-controls.ts";
import { type LabelPlacement, LabelProjector } from "./label-projector.ts";
import type { Landmark } from "./landmarks.ts";
import { ResolutionGovernor } from "./resolution-governor.ts";
import { showHandCursor } from "./tools/hand-cursor.ts";
import { type HandCursor, HandTool } from "./tools/hand-tool.ts";
import { type PowerSelection, PowerTool } from "./tools/power-tool.ts";

const LONGEST_FRAME_SECONDS = 0.1;
const MILLISECONDS_PER_SECOND = 1000;
const FIELD_OF_VIEW = 45;
const NEAR_PLANE = 0.5;
const FAR_PLANE = 40_000;
const CURSOR_COLOR = 0xff_ff_ff;
const CURSOR_OPACITY = 0.9;
const PRESSED_CURSOR_COLOR = 0xff_d8_8a;
const FOLLOW_DISTANCE = 45;
const SHAKE_REACH = 400;
const VIEW_FOCUS_STEP = 50;
const ACTIVITY_EVENTS = ["keydown", "pointerdown", "pointermove", "wheel"] as const;

interface EngineOptions {
  readonly camera: Partial<CameraState>;
  readonly canvas: HTMLCanvasElement;
  readonly quality: QualityLevel;
  readonly session: Promise<GameSession>;
}

interface EngineParts {
  readonly canvas: HTMLCanvasElement;
  readonly graphicsLost: Promise<void>;
  readonly quality: QualityLevel;
  readonly renderer: WebGPURenderer;
  readonly session: GameSession;
}

async function openTogether(
  graphics: Promise<Graphics>,
  session: Promise<GameSession>
): Promise<readonly [Graphics, GameSession]> {
  try {
    return await Promise.all([graphics, session]);
  } catch (error) {
    graphics.then(({ renderer }) => {
      renderer.dispose();
    }, ignore);
    session.then((opened) => {
      opened.close();
    }, ignore);

    throw error;
  }
}

export class GameEngine implements EngineHandle {
  readonly camera: GodCamera;
  readonly filming = new Filming();
  readonly graphicsLost: Promise<void>;
  readonly hand: HandTool;
  readonly powers: PowerTool;
  readonly session: GameSession;
  readonly #activity = new AbortController();
  readonly #cameraPlacement = new Matrix4();
  readonly #canvas: HTMLCanvasElement;
  readonly #entityPicker: EntityPicker;
  readonly #keyboard: KeyboardControls;
  readonly #labels: LabelProjector;
  readonly #pacer = new FramePacer();
  readonly #pointer: PointerControls;
  readonly #renderListeners = new Set<() => void>();
  readonly #renderer: WebGPURenderer;
  readonly #resizeObserver: ResizeObserver;
  readonly #resolution: ResolutionGovernor;
  readonly #world: WorldRenderer;
  #devicePixelRatio = 0;
  #handCursor: HandCursor = "none";
  #hoveredFrame: SimulationFrame | null = null;
  #reportedFocusX = Number.NaN;
  #reportedFocusZ = Number.NaN;
  #viewport: ViewportSize = { height: 1, width: 1 };

  constructor(parts: EngineParts) {
    this.#canvas = parts.canvas;
    this.graphicsLost = parts.graphicsLost;
    this.#resolution = new ResolutionGovernor(RENDER_QUALITY[parts.quality].maximumPixelRatio);
    this.#renderer = parts.renderer;
    this.session = parts.session;

    const { mirror } = parts.session;

    const perspective = new PerspectiveCamera(FIELD_OF_VIEW, 1, NEAR_PLANE, FAR_PLANE);

    function heightAt(x: number, z: number): number {
      return mirror.heightAt(x, z);
    }

    this.camera = new GodCamera(perspective, heightAt, mirror.grid.halfSize);
    this.#world = new WorldRenderer({
      camera: perspective,
      mirror,
      onShake: (amount, x, z) => {
        this.#shake(amount, x, z);
      },
      quality: RENDER_QUALITY[parts.quality],
      renderer: parts.renderer,
    });
    this.#entityPicker = new EntityPicker(
      perspective,
      heightAt,
      (kind, x, z) => {
        return standingHeight(mirror, x, z, kind === "person" ? PERSON_WADING_DEPTH : ANIMAL_WADING_DEPTH);
      },
      (kind, id) => {
        return this.#world.drawnHeading(kind, id);
      }
    );
    this.#labels = new LabelProjector(
      perspective,
      {
        heightAt,
        surfaceAt: (x, z) => {
          return mirror.surfaceAt(x, z);
        },
      },
      mirror.grid.halfSize
    );

    const groundPicker = new GroundPicker(perspective, heightAt, mirror.grid.halfSize);

    this.powers = new PowerTool(
      (command) => {
        this.session.send(command);
      },
      {
        hide: () => {
          this.#world.cursor.hide();
        },
        show: (point, radius, isPressed) => {
          this.#showCursor(point, radius, isPressed);
        },
      }
    );

    this.hand = new HandTool((command) => {
      this.session.send(command);
    }, this.#pickGrabbable.bind(this));

    this.#pointer = new PointerControls(parts.canvas, this.camera, groundPicker, [this.hand, this.powers], {
      tap: (point, screen) => {
        return this.#selectAt(point, screen);
      },
    });
    this.#keyboard = new KeyboardControls(window, this.camera);
    this.#resizeObserver = new ResizeObserver(() => {
      this.#resize();
    });
    this.#resizeObserver.observe(parts.canvas);
    this.#resize();
    this.filming.subscribe((settings) => {
      this.#film(settings);
    });

    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(
        type,
        () => {
          this.#pacer.markActivity(performance.now());
        },
        {
          passive: true,
          signal: this.#activity.signal,
        }
      );
    }
  }

  static async start(options: EngineOptions): Promise<GameEngine> {
    const [{ lost, renderer }, session] = await openTogether(
      createGraphics(options.canvas, RENDER_QUALITY[options.quality]),
      options.session
    );

    const engine = new GameEngine({
      canvas: options.canvas,
      graphicsLost: lost,
      quality: options.quality,
      renderer,
      session,
    });

    if (Object.keys(options.camera).length === 0) {
      engine.camera.arriveFromAbove();
    } else {
      engine.camera.jumpTo(options.camera);
    }

    await engine.#world.warmUp();
    engine.run();

    return engine;
  }

  get canvas(): HTMLCanvasElement {
    return this.#canvas;
  }

  get landmarks(): readonly Landmark[] {
    return this.session.mirror.landmarks;
  }

  selectPower(selection: PowerSelection | null): void {
    this.powers.select(selection);
  }

  selectHand(isSelected: boolean): void {
    this.hand.select(isSelected);
  }

  focusOn(x: number, z: number, distance?: number): void {
    this.camera.flyTo({ targetX: x, targetZ: z, ...(distance === undefined ? {} : { distance }) });
  }

  followSelection(): void {
    this.camera.setDistance(Math.min(this.camera.state.distance, FOLLOW_DISTANCE));
    this.camera.follow(() => {
      return this.#selectedPosition();
    });
  }

  stopFollowing(): void {
    this.camera.follow(null);
  }

  clearSelection(): void {
    this.stopFollowing();
    this.session.send({ selection: null, type: "setSelection" });
  }

  placeLabel(x: number, z: number, lift: number): LabelPlacement | null {
    return this.#labels.place(x, z, lift, this.#viewport);
  }

  setOutlinesShown(areShown: boolean): void {
    this.#world.setOutlinesShown(areShown);
    this.#pacer.markActivity(performance.now());
  }

  subscribeToRenders(listener: () => void): () => void {
    this.#renderListeners.add(listener);

    return () => {
      this.#renderListeners.delete(listener);
    };
  }

  run(): void {
    this.#renderer.setAnimationLoop((time) => {
      this.#frame(time);
    });
  }

  stop(): void {
    this.#renderer.setAnimationLoop(null);
  }

  dispose(): void {
    this.stop();
    this.#activity.abort();
    this.#renderListeners.clear();
    this.#pointer.dispose();
    this.#keyboard.dispose();
    this.#resizeObserver.disconnect();
    this.#world.dispose();
    this.session.close();
    this.#renderer.dispose();
  }

  #frame(time: number): void {
    const hasFocus = document.hasFocus();

    if (!this.#pacer.isFrameDue(time, hasFocus)) {
      return;
    }

    const elapsed = this.#pacer.markRendered(time);
    const hasNewResolution = this.#resolution.record(elapsed, hasFocus);

    if (hasNewResolution || window.devicePixelRatio !== this.#devicePixelRatio) {
      this.#resize();
    }

    const realSeconds = clamp(elapsed / MILLISECONDS_PER_SECOND, 0, LONGEST_FRAME_SECONDS);

    this.session.update(realSeconds);
    this.#keyboard.update(realSeconds);
    this.camera.update(realSeconds);
    this.#rehoverOnNewFrame();
    this.#pointer.update();
    this.#showHand();

    this.#world.render({
      camera: this.camera.camera,
      effects: this.session.takeEffects(),
      focus: this.camera.target,
      now: time,
      realSeconds,
      viewDistance: this.camera.state.distance,
    });

    for (const listener of this.#renderListeners) {
      listener();
    }

    this.#noticeCameraMotion(time);
    this.#reportViewFocus();
  }

  #film(settings: FilmingSettings): void {
    this.#world.setFilming(settings);
    this.#resolution.hold(settings.isResolutionHeld);
    this.#resize();
    this.#pacer.markActivity(performance.now());
  }

  #rehoverOnNewFrame(): void {
    const { frame } = this.session;

    if (frame !== this.#hoveredFrame) {
      this.#hoveredFrame = frame;
      this.#pointer.rehover();
    }
  }

  #showHand(): void {
    const cursor = this.hand.cursor(this.session.frame.held);

    this.#world.highlight(this.hand.hovered);

    if (cursor !== this.#handCursor) {
      this.#handCursor = cursor;
      showHandCursor(this.#canvas, cursor);
    }
  }

  #noticeCameraMotion(time: number): void {
    const placement = this.camera.camera.matrixWorld;

    if (!placement.equals(this.#cameraPlacement)) {
      this.#cameraPlacement.copy(placement);
      this.#pacer.markActivity(time);
    }
  }

  #reportViewFocus(): void {
    const { target } = this.camera;

    if (Math.hypot(target.x - this.#reportedFocusX, target.z - this.#reportedFocusZ) < VIEW_FOCUS_STEP) {
      return;
    }

    this.#reportedFocusX = target.x;
    this.#reportedFocusZ = target.z;
    this.session.send({ type: "setViewFocus", x: target.x, z: target.z });
  }

  #selectedPosition(): GroundPoint | null {
    const { inspection } = this.session.frame;

    if (inspection === null || inspection.kind === "tribe" || inspection.kind === "cell") {
      return null;
    }

    return { x: inspection.x, z: inspection.z };
  }

  #shake(amount: number, x: number, z: number): void {
    const { target } = this.camera;

    const reach = SHAKE_REACH + this.camera.state.distance;
    const distance = Math.hypot(target.x - x, target.z - z);

    this.camera.shake(amount * Math.max(0, 1 - distance / reach));
  }

  #showCursor(point: Vector3, radius: number, isPressed: boolean): void {
    const color = isPressed ? PRESSED_CURSOR_COLOR : CURSOR_COLOR;

    this.#world.cursor.show(point.x, point.z, radius, color, CURSOR_OPACITY);
  }

  #selectAt(point: Vector3 | null, screen: ScreenPoint): void {
    const scene = { frame: this.session.frame, secondsSinceTick: this.#secondsSinceTick() };

    const selection = this.#entityPicker.pick(scene, screen, this.#viewport, point);

    this.session.send({ selection, type: "setSelection" });
  }

  #pickGrabbable(point: Vector3 | null, screen: ScreenPoint): GrabTarget | null {
    const { frame, vegetation } = this.session.mirror;

    const scene = {
      frame,
      plantsNear: (spots: readonly GroundPoint[], radius: number) => {
        return this.#world.plantsNear(spots, radius);
      },
      secondsSinceTick: this.#secondsSinceTick(),
      vegetation,
    };

    return this.#entityPicker.pickGrabbable(scene, screen, this.#viewport, point);
  }

  #secondsSinceTick(): number {
    return this.session.mirror.gameSecondsSinceTick(performance.now());
  }

  #resize(): void {
    const width = Math.max(1, this.#canvas.clientWidth);
    const height = Math.max(1, this.#canvas.clientHeight);

    this.#devicePixelRatio = window.devicePixelRatio;
    this.#viewport = { height, width };
    this.#renderer.setDrawingBufferSize(width, height, this.#resolution.pixelRatio(this.#devicePixelRatio));
    this.camera.camera.aspect = width / height;
    this.camera.camera.updateProjectionMatrix();
  }
}
