import { Matrix4, type Vector3 } from "three/webgpu";
import type { GodCamera } from "../camera/god-camera.ts";
import type { GroundPicker, ScreenPoint } from "./ground-picker.ts";

export const TAP_TOLERANCE = 6;

const MOUSE_PRIMARY = 0;
const TOUCH_HOLD_MILLISECONDS = 140;
const ORBIT_YAW_PER_PIXEL = 0.005;
const ORBIT_PITCH_PER_PIXEL = 0.004;
const WHEEL_ZOOM_RATE = 0.0015;
const WHEEL_LINE_PIXELS = 16;

export interface ToolGestures {
  readonly begin: (point: Vector3 | null) => void;
  readonly canBegin: (point: Vector3 | null, screen: ScreenPoint) => boolean;
  readonly cancel: () => void;
  readonly canHoldThroughPinch: boolean;
  readonly end: () => void;
  readonly hover: (point: Vector3 | null, screen: ScreenPoint | null) => void;
  readonly isActive: () => boolean;
  readonly move: (point: Vector3) => void;
}

export type TapListener = (point: Vector3 | null, screen: ScreenPoint) => void;

interface TrackedPointer {
  readonly startX: number;
  readonly startY: number;
  x: number;
  y: number;
}

interface PinchMeasure {
  readonly angle: number;
  readonly distance: number;
  readonly middleX: number;
  readonly middleY: number;
}

interface Carrying {
  readonly holder: TrackedPointer;
  readonly tool: ToolGestures;
}

type Gesture =
  | { readonly kind: "idle" }
  | { readonly kind: "orbit" }
  | { readonly kind: "pan"; travel: number }
  | { readonly kind: "tool"; readonly tool: ToolGestures }
  | {
      readonly kind: "waiting";
      readonly point: Vector3 | null;
      readonly screen: ScreenPoint;
      readonly tool: ToolGestures;
    }
  | {
      angle: number;
      readonly carrying: Carrying | null;
      distance: number;
      readonly kind: "pinch";
      middleX: number;
      middleY: number;
    };

function wheelPixels(event: WheelEvent, pageHeight: number): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * WHEEL_LINE_PIXELS;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * pageHeight;
  }

  return event.deltaY;
}

function measurePinch(pointers: ReadonlyMap<number, TrackedPointer>): PinchMeasure | null {
  const [first, second] = [...pointers.values()];

  if (first === undefined || second === undefined) {
    return null;
  }

  return {
    angle: Math.atan2(second.y - first.y, second.x - first.x),
    distance: Math.hypot(second.x - first.x, second.y - first.y),
    middleX: (first.x + second.x) / 2,
    middleY: (first.y + second.y) / 2,
  };
}

export class PointerControls {
  readonly #abort = new AbortController();
  readonly #camera: GodCamera;
  readonly #canvas: HTMLCanvasElement;
  readonly #picker: GroundPicker;
  readonly #pointers = new Map<number, TrackedPointer>();
  readonly #onTap: TapListener;
  readonly #tools: readonly ToolGestures[];
  readonly #viewAtPick = new Matrix4();
  #carriedX = Number.NaN;
  #carriedY = Number.NaN;
  #gesture: Gesture = { kind: "idle" };
  #holdTimer: number | null = null;
  #hoverScreen: ScreenPoint | null = null;
  #hoverTool: ToolGestures | null = null;
  #pickedScreen: ScreenPoint | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    camera: GodCamera,
    picker: GroundPicker,
    tools: readonly ToolGestures[],
    onTap: TapListener
  ) {
    this.#canvas = canvas;
    this.#camera = camera;
    this.#picker = picker;
    this.#tools = tools;
    this.#onTap = onTap;

    const options = { signal: this.#abort.signal };

    canvas.addEventListener(
      "pointerdown",
      (event) => {
        return this.#down(event);
      },
      options
    );
    canvas.addEventListener(
      "pointermove",
      (event) => {
        return this.#move(event);
      },
      options
    );
    canvas.addEventListener(
      "pointerup",
      (event) => {
        return this.#up(event, true);
      },
      options
    );
    canvas.addEventListener(
      "pointercancel",
      (event) => {
        return this.#up(event, false);
      },
      options
    );
    canvas.addEventListener(
      "pointerleave",
      () => {
        return this.#leave();
      },
      options
    );
    canvas.addEventListener(
      "wheel",
      (event) => {
        return this.#wheel(event);
      },
      { ...options, passive: false }
    );
    canvas.addEventListener(
      "contextmenu",
      (event) => {
        return event.preventDefault();
      },
      options
    );
  }

  dispose(): void {
    this.#stopHold();
    this.#abort.abort();
  }

  rehover(): void {
    this.#pickedScreen = null;
    this.#carriedX = Number.NaN;
  }

  update(): void {
    const carrying = this.#carrying();

    if (carrying !== null) {
      this.#keepCarrying(carrying);

      return;
    }

    this.#refreshHover();
  }

  #down(event: PointerEvent): void {
    this.#canvas.setPointerCapture(event.pointerId);
    this.#pointers.set(event.pointerId, {
      startX: event.offsetX,
      startY: event.offsetY,
      x: event.offsetX,
      y: event.offsetY,
    });

    if (this.#pointers.size === 2) {
      this.#beginPinch(event.pointerId);

      return;
    }

    if (this.#pointers.size === 1) {
      this.#beginSingle(event);
    }
  }

  #beginSingle(event: PointerEvent): void {
    if (event.pointerType === "mouse" && event.button !== MOUSE_PRIMARY) {
      this.#gesture = { kind: "orbit" };

      return;
    }

    const screen = { x: event.offsetX, y: event.offsetY };
    const point = this.#pick(screen.x, screen.y);
    const tool = this.#activeTool();

    if (tool === null || !tool.canBegin(point, screen)) {
      this.#gesture = { kind: "pan", travel: 0 };

      return;
    }

    if (event.pointerType === "touch") {
      this.#waitForSecondTouch({ kind: "waiting", point, screen, tool });

      return;
    }

    this.#gesture = { kind: "tool", tool };
    tool.begin(point);
  }

  #waitForSecondTouch(waiting: Extract<Gesture, { kind: "waiting" }>): void {
    this.#gesture = waiting;
    waiting.tool.hover(waiting.point, waiting.screen);
    this.#holdTimer = window.setTimeout(() => {
      return this.#commitTool(this.#onlyPointer());
    }, TOUCH_HOLD_MILLISECONDS);
  }

  #onlyPointer(): TrackedPointer | null {
    const [pointer, other] = [...this.#pointers.values()];

    if (pointer === undefined || other !== undefined) {
      return null;
    }

    return pointer;
  }

  #commitTool(pointer: TrackedPointer | null): void {
    const gesture = this.#gesture;

    this.#stopHold();

    if (gesture.kind !== "waiting" || pointer === null) {
      return;
    }

    this.#gesture = { kind: "tool", tool: gesture.tool };
    gesture.tool.begin(gesture.point);
    this.#continueTool(gesture.tool, pointer);
  }

  #stopHold(): void {
    if (this.#holdTimer === null) {
      return;
    }

    window.clearTimeout(this.#holdTimer);
    this.#holdTimer = null;
  }

  #beginPinch(newcomer: number): void {
    const gesture = this.#gesture;
    const carrying = gesture.kind === "tool" ? this.#keptHolder(gesture.tool, newcomer) : null;

    this.#stopHold();

    if (gesture.kind === "tool" && carrying === null) {
      gesture.tool.cancel();
    }

    if (carrying === null) {
      this.#hoverNothing();
    }

    const pinch = measurePinch(this.#pointers);

    if (pinch === null) {
      return;
    }

    this.#gesture = { ...pinch, carrying, kind: "pinch" };
  }

  #keptHolder(tool: ToolGestures, newcomer: number): Carrying | null {
    if (!tool.canHoldThroughPinch) {
      return null;
    }

    for (const [id, pointer] of this.#pointers) {
      if (id !== newcomer) {
        return { holder: pointer, tool };
      }
    }

    return null;
  }

  #carrying(): Carrying | null {
    const gesture = this.#gesture;

    if (gesture.kind === "pinch") {
      return gesture.carrying;
    }

    if (gesture.kind !== "tool") {
      return null;
    }

    const holder = this.#onlyPointer();

    return holder === null ? null : { holder, tool: gesture.tool };
  }

  #move(event: PointerEvent): void {
    const pointer = this.#pointers.get(event.pointerId);

    if (pointer === undefined) {
      this.#hover(event);

      return;
    }

    this.#hoverScreen = event.pointerType === "mouse" ? { x: event.offsetX, y: event.offsetY } : null;

    const deltaX = event.offsetX - pointer.x;
    const deltaY = event.offsetY - pointer.y;

    pointer.x = event.offsetX;
    pointer.y = event.offsetY;
    this.#continueGesture(pointer, deltaX, deltaY);
  }

  #continueGesture(pointer: TrackedPointer, deltaX: number, deltaY: number): void {
    const gesture = this.#gesture;

    switch (gesture.kind) {
      case "orbit":
        this.#camera.orbit(-deltaX * ORBIT_YAW_PER_PIXEL, deltaY * ORBIT_PITCH_PER_PIXEL);
        break;
      case "pan":
        gesture.travel = Math.max(gesture.travel, Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY));
        this.#camera.pan(deltaX, deltaY, this.#canvas.clientHeight);
        break;
      case "pinch":
        this.#continuePinch(gesture);
        break;
      case "tool":
        this.#continueTool(gesture.tool, pointer);
        break;
      default:
        break;
    }
  }

  #continueTool(tool: ToolGestures, pointer: TrackedPointer): void {
    const point = this.#pick(pointer.x, pointer.y);

    if (point !== null) {
      tool.move(point);
    }
  }

  #keepCarrying({ holder, tool }: Carrying): void {
    const view = this.#camera.camera.matrixWorld;

    if (holder.x === this.#carriedX && holder.y === this.#carriedY && view.equals(this.#viewAtPick)) {
      return;
    }

    this.#carriedX = holder.x;
    this.#carriedY = holder.y;
    this.#viewAtPick.copy(view);
    this.#continueTool(tool, holder);
  }

  #continuePinch(gesture: Extract<Gesture, { kind: "pinch" }>): void {
    const pinch = measurePinch(this.#pointers);

    if (pinch === null) {
      return;
    }

    this.#camera.zoom(gesture.distance / Math.max(1, pinch.distance), this.#pick(pinch.middleX, pinch.middleY));

    if (gesture.carrying === null) {
      this.#camera.orbit(pinch.angle - gesture.angle, 0);
      this.#camera.pan(pinch.middleX - gesture.middleX, pinch.middleY - gesture.middleY, this.#canvas.clientHeight);
    }

    gesture.distance = pinch.distance;
    gesture.angle = pinch.angle;
    gesture.middleX = pinch.middleX;
    gesture.middleY = pinch.middleY;
  }

  #up(event: PointerEvent, isReleased: boolean): void {
    const pointer = this.#pointers.get(event.pointerId);

    this.#pointers.delete(event.pointerId);
    this.#pickedScreen = null;
    this.#carriedX = Number.NaN;

    if (pointer === undefined) {
      return;
    }

    const gesture = this.#gesture;

    if (gesture.kind === "pinch" && gesture.carrying !== null) {
      this.#leavePinch(gesture.carrying, pointer, isReleased);

      return;
    }

    if (isReleased) {
      this.#finishGesture(pointer);
    } else {
      this.#abandonGesture();
    }

    if (this.#pointers.size === 0) {
      this.#gesture = { kind: "idle" };

      return;
    }

    if (this.#gesture.kind === "pinch") {
      this.#gesture = { kind: "pan", travel: TAP_TOLERANCE };
    }
  }

  #leavePinch(carrying: Carrying, pointer: TrackedPointer, isReleased: boolean): void {
    const { holder, tool } = carrying;

    if (pointer !== holder) {
      const pinch = measurePinch(this.#pointers);

      this.#gesture = pinch === null ? { kind: "tool", tool } : { ...pinch, carrying, kind: "pinch" };

      return;
    }

    if (isReleased) {
      tool.end();
    } else {
      tool.cancel();
    }

    this.#gesture = this.#pointers.size === 0 ? { kind: "idle" } : { kind: "pan", travel: TAP_TOLERANCE };
  }

  #abandonGesture(): void {
    const gesture = this.#gesture;

    this.#stopHold();

    if (gesture.kind === "tool") {
      gesture.tool.cancel();
    }

    if (gesture.kind === "waiting") {
      gesture.tool.hover(null, null);
    }

    this.#gesture = { kind: "idle" };
  }

  #finishGesture(pointer: TrackedPointer): void {
    if (this.#gesture.kind === "waiting") {
      this.#commitTool(pointer);
    }

    const gesture = this.#gesture;

    if (gesture.kind === "tool") {
      gesture.tool.end();
      this.#gesture = { kind: "idle" };

      return;
    }

    if (gesture.kind === "pan" && gesture.travel < TAP_TOLERANCE && this.#activeTool() === null) {
      this.#onTap(this.#pick(pointer.x, pointer.y), { x: pointer.x, y: pointer.y });
    }
  }

  #hover(event: PointerEvent): void {
    if (event.pointerType !== "mouse") {
      return;
    }

    this.#hoverScreen = { x: event.offsetX, y: event.offsetY };
  }

  #refreshHover(): void {
    const screen = this.#hoverScreen;
    const tool = this.#activeTool();
    const view = this.#camera.camera.matrixWorld;

    if (screen === null || tool === null || this.#pointers.size > 0) {
      return;
    }

    if (screen === this.#pickedScreen && tool === this.#hoverTool && view.equals(this.#viewAtPick)) {
      return;
    }

    this.#pickedScreen = screen;
    this.#hoverTool = tool;
    this.#viewAtPick.copy(view);
    tool.hover(this.#pick(screen.x, screen.y), screen);
  }

  #leave(): void {
    this.#hoverScreen = null;
    this.#hoverNothing();
  }

  #hoverNothing(): void {
    const tool = this.#activeTool();

    if (tool !== null) {
      tool.hover(null, null);
    }
  }

  #activeTool(): ToolGestures | null {
    for (const tool of this.#tools) {
      if (tool.isActive()) {
        return tool;
      }
    }

    return null;
  }

  #wheel(event: WheelEvent): void {
    event.preventDefault();

    const factor = Math.exp(wheelPixels(event, this.#canvas.clientHeight) * WHEEL_ZOOM_RATE);

    this.#camera.zoom(factor, this.#pick(event.offsetX, event.offsetY));
  }

  #pick(x: number, y: number): Vector3 | null {
    return this.#picker.pick({ x, y }, { height: this.#canvas.clientHeight, width: this.#canvas.clientWidth });
  }
}
