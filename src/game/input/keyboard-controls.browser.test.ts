import { PerspectiveCamera } from "three/webgpu";
import { afterEach, describe, expect, it } from "vitest";
import { GodCamera } from "../camera/god-camera.ts";
import { flatGround, settle } from "../testing/view-fixtures.ts";
import { KeyboardControls } from "./keyboard-controls.ts";

const WORLD_HALF_SIZE = 4000;

interface Rig {
  readonly camera: GodCamera;
  readonly controls: KeyboardControls;
}

const rigs: Rig[] = [];

function createRig(): Rig {
  const camera = new GodCamera(new PerspectiveCamera(45, 1.5, 1, 40_000), flatGround, WORLD_HALF_SIZE);

  camera.jumpTo({ distance: 500, targetX: 0, targetZ: 0, yaw: 0 });

  const rig = { camera, controls: new KeyboardControls(camera) };

  rigs.push(rig);

  return rig;
}

function press(target: EventTarget, code: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code }));
}

function applyHeldKeys(rig: Rig): void {
  rig.controls.update(0.5);
  settle(rig.camera);
}

describe("keyboard controls", () => {
  afterEach(() => {
    for (const rig of rigs.splice(0)) {
      rig.controls.dispose();
    }

    document.body.replaceChildren();
  });

  it("moves the camera forward while an arrow is held", () => {
    const rig = createRig();

    press(window, "ArrowUp");
    applyHeldKeys(rig);

    expect(rig.camera.state.targetZ).toBeLessThan(-100);
  });

  it("takes focus off a clicked button once the camera moves", () => {
    createRig();

    const button = document.createElement("button");

    document.body.append(button);
    button.focus();
    press(button, "KeyW");

    expect(document.activeElement).not.toBe(button);
  });

  it("stops once the key is released", () => {
    const rig = createRig();

    press(window, "ArrowUp");
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowUp" }));
    applyHeldKeys(rig);

    expect(rig.camera.state.targetZ).toBeCloseTo(0, 3);
  });

  it("leaves arrows alone while someone types", () => {
    const rig = createRig();
    const field = document.createElement("input");

    document.body.append(field);
    press(field, "ArrowUp");
    applyHeldKeys(rig);

    expect(rig.camera.state.targetZ).toBeCloseTo(0, 3);
  });

  it("leaves arrows alone once a focused control has used them", () => {
    const rig = createRig();
    const tabs = document.createElement("div");

    tabs.addEventListener("keydown", (event) => {
      event.preventDefault();
    });
    document.body.append(tabs);
    press(tabs, "ArrowRight");
    applyHeldKeys(rig);

    expect(rig.camera.state.targetX).toBeCloseTo(0, 3);
  });
});
