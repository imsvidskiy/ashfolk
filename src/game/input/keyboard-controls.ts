import type { GodCamera } from "../camera/god-camera.ts";

const MOVE_SPEED_PER_DISTANCE = 0.9;
const TURN_SPEED = 1.6;
const PITCH_SPEED = 0.9;
const ZOOM_SPEED = 1.8;
const TYPING_TAGS: ReadonlySet<string> = new Set(["INPUT", "SELECT", "TEXTAREA"]);

type CameraAction =
  | "back"
  | "forward"
  | "left"
  | "pitchDown"
  | "pitchUp"
  | "right"
  | "turnLeft"
  | "turnRight"
  | "zoomIn"
  | "zoomOut";

const KEY_ACTIONS: ReadonlyMap<string, CameraAction> = new Map([
  ["ArrowDown", "back"],
  ["ArrowLeft", "left"],
  ["ArrowRight", "right"],
  ["ArrowUp", "forward"],
  ["Equal", "zoomIn"],
  ["KeyA", "left"],
  ["KeyD", "right"],
  ["KeyE", "turnRight"],
  ["KeyF", "pitchDown"],
  ["KeyQ", "turnLeft"],
  ["KeyR", "pitchUp"],
  ["KeyS", "back"],
  ["KeyW", "forward"],
  ["Minus", "zoomOut"],
  ["NumpadAdd", "zoomIn"],
  ["NumpadSubtract", "zoomOut"],
]);

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || TYPING_TAGS.has(target.tagName);
}

function actionOf(event: KeyboardEvent): CameraAction | undefined {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) {
    return undefined;
  }

  return KEY_ACTIONS.get(event.code);
}

export class KeyboardControls {
  readonly #abort = new AbortController();
  readonly #camera: GodCamera;
  readonly #held = new Set<CameraAction>();

  constructor(target: Window, camera: GodCamera) {
    this.#camera = camera;

    const options = { signal: this.#abort.signal };

    target.addEventListener(
      "keydown",
      (event) => {
        this.#press(event);
      },
      options
    );
    target.addEventListener(
      "keyup",
      (event) => {
        this.#release(event);
      },
      options
    );
    target.addEventListener(
      "blur",
      () => {
        this.#held.clear();
      },
      options
    );
  }

  update(realSeconds: number): void {
    if (this.#held.size === 0) {
      return;
    }

    const step = this.#camera.state.distance * MOVE_SPEED_PER_DISTANCE * realSeconds;

    this.#camera.moveBy(this.#axis("forward", "back") * step, this.#axis("right", "left") * step);
    this.#camera.orbit(
      this.#axis("turnLeft", "turnRight") * TURN_SPEED * realSeconds,
      this.#axis("pitchUp", "pitchDown") * PITCH_SPEED * realSeconds
    );

    const zoomDirection = this.#axis("zoomOut", "zoomIn");

    if (zoomDirection !== 0) {
      this.#camera.zoom(Math.exp(zoomDirection * ZOOM_SPEED * realSeconds), null);
    }
  }

  dispose(): void {
    this.#abort.abort();
    this.#held.clear();
  }

  #axis(positive: CameraAction, negative: CameraAction): number {
    return Number(this.#held.has(positive)) - Number(this.#held.has(negative));
  }

  #press(event: KeyboardEvent): void {
    const action = actionOf(event);

    if (action === undefined) {
      return;
    }

    event.preventDefault();
    this.#held.add(action);

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  #release(event: KeyboardEvent): void {
    const action = KEY_ACTIONS.get(event.code);

    if (action !== undefined) {
      this.#held.delete(action);
    }
  }
}
