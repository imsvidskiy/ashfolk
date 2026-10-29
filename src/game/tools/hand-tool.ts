import type { Vector3 } from "three/webgpu";
import type { SimulationCommand } from "../../simulation/commands.ts";
import type { GrabTarget, HeldView } from "../../simulation/hand/grab-target.ts";
import type { ScreenPoint } from "../input/ground-picker.ts";
import type { ToolGestures } from "../input/pointer-controls.ts";

type CommandSink = (command: SimulationCommand) => void;

type GrabPicker = (point: Vector3 | null, screen: ScreenPoint) => GrabTarget | null;

type HandState = "holding" | "idle" | "putAway";

export type HandCursor = "blocked" | "closed" | "none" | "open";

export class HandTool implements ToolGestures {
  readonly canHoldThroughPinch = true;
  readonly #pick: GrabPicker;
  readonly #send: CommandSink;
  #carriedX = Number.NaN;
  #carriedZ = Number.NaN;
  #hovered: GrabTarget | null = null;
  #state: HandState = "putAway";
  #target: GrabTarget | null = null;

  constructor(send: CommandSink, pick: GrabPicker) {
    this.#send = send;
    this.#pick = pick;
  }

  get hovered(): GrabTarget | null {
    return this.#hovered;
  }

  select(isSelected: boolean): void {
    if (!isSelected) {
      this.cancel();
      this.#state = "putAway";
      this.#hovered = null;

      return;
    }

    if (this.#state === "putAway") {
      this.#state = "idle";
    }
  }

  isActive(): boolean {
    return this.#state !== "putAway";
  }

  cursor(held: HeldView | null): HandCursor {
    if (this.#state === "putAway") {
      return "none";
    }

    if (this.#state === "idle") {
      return "open";
    }

    return held !== null && !held.isPlaceable ? "blocked" : "closed";
  }

  hover(point: Vector3 | null, screen: ScreenPoint | null): void {
    const canPick = this.#state === "idle" && screen !== null;

    this.#hovered = canPick ? this.#pick(point, screen) : null;
  }

  canBegin(point: Vector3 | null, screen: ScreenPoint): boolean {
    this.#target = this.isActive() ? this.#pick(point, screen) : null;

    return this.#target !== null;
  }

  begin(): void {
    const target = this.#target;

    this.#target = null;

    if (!this.isActive() || target === null) {
      return;
    }

    this.cancel();
    this.#send({ target, type: "grab" });
    this.#state = "holding";
    this.#hovered = null;
    this.#carriedX = Number.NaN;
    this.#carriedZ = Number.NaN;
  }

  move(point: Vector3): void {
    const isStill = point.x === this.#carriedX && point.z === this.#carriedZ;

    if (this.#state !== "holding" || isStill) {
      return;
    }

    this.#carriedX = point.x;
    this.#carriedZ = point.z;
    this.#send({ type: "carry", x: point.x, z: point.z });
  }

  end(): void {
    if (this.#state !== "holding") {
      return;
    }

    this.#state = "idle";
    this.#send({ type: "drop" });
  }

  cancel(): void {
    if (this.#state !== "holding") {
      return;
    }

    this.#state = "idle";
    this.#send({ type: "cancelGrab" });
  }
}
