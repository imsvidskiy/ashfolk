import type { Vector3 } from "three/webgpu";
import { type ParameterValueMap, POWERS, type PowerId } from "../../content/powers.ts";
import type { SimulationCommand } from "../../simulation/commands.ts";
import type { ToolGestures } from "../input/pointer-controls.ts";

const MARKER_RADIUS = 12;
const RADIUS_PARAMETERS = ["radius", "craterRadius"] as const;
const SCATTER_PARAMETER = "scatter";

export interface PowerSelection {
  readonly parameters: ParameterValueMap;
  readonly powerId: PowerId;
}

interface BrushCursor {
  readonly hide: () => void;
  readonly show: (point: Vector3, radius: number, isPressed: boolean) => void;
}

type CommandSink = (command: SimulationCommand) => void;

type StrokeState = "idle" | "stroking";

function numberParameter(parameters: ParameterValueMap, name: string): number | null {
  const value = parameters[name];

  if (typeof value === "number") {
    return value;
  }

  return null;
}

function cursorRadius(selection: PowerSelection): number {
  for (const name of RADIUS_PARAMETERS) {
    const radius = numberParameter(selection.parameters, name);

    if (radius !== null) {
      return radius;
    }
  }

  const scatter = numberParameter(selection.parameters, SCATTER_PARAMETER);

  if (scatter === null) {
    return MARKER_RADIUS;
  }

  return Math.max(MARKER_RADIUS, scatter);
}

export class PowerTool implements ToolGestures {
  readonly canHoldThroughPinch = false;
  readonly #cursor: BrushCursor;
  readonly #send: CommandSink;
  #selection: PowerSelection | null = null;
  #stroke: StrokeState = "idle";

  constructor(send: CommandSink, cursor: BrushCursor) {
    this.#send = send;
    this.#cursor = cursor;
  }

  get selection(): PowerSelection | null {
    return this.#selection;
  }

  select(selection: PowerSelection | null): void {
    this.end();
    this.#selection = selection;

    if (selection === null) {
      this.#cursor.hide();
    }
  }

  isActive(): boolean {
    return this.#selection !== null;
  }

  canBegin(point: Vector3 | null): boolean {
    return this.isActive() && point !== null;
  }

  begin(point: Vector3 | null): void {
    const selection = this.#selection;

    if (selection === null || point === null) {
      return;
    }

    const command = { parameters: selection.parameters, powerId: selection.powerId, x: point.x, z: point.z };

    this.#cursor.show(point, cursorRadius(selection), true);

    if (POWERS[selection.powerId].usage === "brush") {
      this.#send({ ...command, type: "beginStroke" });
      this.#stroke = "stroking";

      return;
    }

    this.#send({ ...command, type: "usePower" });
  }

  move(point: Vector3): void {
    const selection = this.#selection;

    if (selection === null) {
      return;
    }

    this.#cursor.show(point, cursorRadius(selection), this.#stroke === "stroking");

    if (this.#stroke === "stroking") {
      this.#send({ type: "moveStroke", x: point.x, z: point.z });
    }
  }

  end(): void {
    if (this.#stroke !== "stroking") {
      return;
    }

    this.#stroke = "idle";
    this.#send({ type: "endStroke" });
  }

  cancel(): void {
    this.end();
  }

  hover(point: Vector3 | null): void {
    const selection = this.#selection;

    if (point === null || selection === null) {
      this.#cursor.hide();

      return;
    }

    this.#cursor.show(point, cursorRadius(selection), false);
  }
}
