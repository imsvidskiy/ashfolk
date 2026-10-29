import { Vector3 } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import type { SimulationCommand } from "../../simulation/commands.ts";
import type { GrabTarget, HeldView } from "../../simulation/hand/grab-target.ts";
import { HandTool } from "./hand-tool.ts";

const DEER: GrabTarget = { id: 7, kind: "animal" };
const SCREEN = { x: 40, y: 30 };
const PRESSED = new Vector3(10, 0, 20);
const CARRIED = new Vector3(30, 5, -12);
const PLACEABLE: HeldView = { ...DEER, isPlaceable: true, x: 30, z: -12 };
const BLOCKED: HeldView = { ...PLACEABLE, isPlaceable: false };

function createHand(target: GrabTarget | null = DEER) {
  const send = vi.fn<(command: SimulationCommand) => void>();
  const pick = vi.fn<() => GrabTarget | null>().mockReturnValue(target);

  const hand = new HandTool(send, pick);

  hand.select(true);

  return { hand, pick, send };
}

function press(hand: HandTool): void {
  if (hand.canBegin(PRESSED, SCREEN)) {
    hand.begin();
  }
}

function hoveredAfter(hand: HandTool): GrabTarget | null {
  hand.hover(PRESSED, SCREEN);

  return hand.hovered;
}

function isCarry(command: SimulationCommand): boolean {
  return command.type === "carry";
}

describe("hand tool", () => {
  it("is active only while the hand is chosen", () => {
    const { hand } = createHand();

    expect(hand.isActive()).toBe(true);

    hand.select(false);

    expect(hand.isActive()).toBe(false);
    expect(hand.canBegin(PRESSED, SCREEN)).toBe(false);
  });

  it("begins only on something it can pick up", () => {
    expect(createHand().hand.canBegin(PRESSED, SCREEN)).toBe(true);
    expect(createHand(null).hand.canBegin(PRESSED, SCREEN)).toBe(false);
  });

  it("grabs, carries and drops", () => {
    const { hand, pick, send } = createHand();

    press(hand);
    hand.move(CARRIED);
    hand.end();

    expect(pick).toHaveBeenCalledOnce();
    expect(pick).toHaveBeenCalledWith(PRESSED, SCREEN);
    expect(send.mock.calls.flat()).toEqual([
      { target: DEER, type: "grab" },
      { type: "carry", x: CARRIED.x, z: CARRIED.z },
      { type: "drop" },
    ]);
  });

  it("cancels a grab and then has nothing left to drop", () => {
    const { hand, send } = createHand();

    press(hand);
    hand.cancel();
    hand.end();
    hand.move(CARRIED);

    expect(send.mock.calls.flat()).toEqual([{ target: DEER, type: "grab" }, { type: "cancelGrab" }]);
  });

  it("sends nothing when the press found nothing to pick up", () => {
    const { hand, send } = createHand(null);

    hand.canBegin(PRESSED, SCREEN);
    hand.begin();
    hand.move(CARRIED);
    hand.end();

    expect(send).not.toHaveBeenCalled();
  });

  it("returns what it holds when the hand is put away", () => {
    const { hand, send } = createHand();

    press(hand);
    hand.select(false);

    expect(send).toHaveBeenLastCalledWith({ type: "cancelGrab" });
    expect(hand.isActive()).toBe(false);
  });

  it("reaches for a crown against the sky, where no ground lies under the pointer", () => {
    const { hand, pick } = createHand();

    hand.hover(null, SCREEN);

    expect(hand.hovered).toEqual(DEER);
    expect(pick).toHaveBeenCalledWith(null, SCREEN);
    expect(hand.canBegin(null, SCREEN)).toBe(true);
  });

  it("hovers what lies under the pointer while the hand is empty", () => {
    const { hand, pick } = createHand();

    hand.hover(PRESSED, SCREEN);

    expect(hand.hovered).toEqual(DEER);
    expect(pick).toHaveBeenCalledWith(PRESSED, SCREEN);

    hand.hover(null, null);

    expect(hand.hovered).toBeNull();
  });

  it("hovers nothing when nothing is under the pointer, while carrying or once put away", () => {
    expect(hoveredAfter(createHand(null).hand)).toBeNull();

    const carrying = createHand();

    press(carrying.hand);

    expect(hoveredAfter(carrying.hand)).toBeNull();

    const putAway = createHand();

    putAway.hand.select(false);

    expect(hoveredAfter(putAway.hand)).toBeNull();
  });

  it("forgets the hover once it grabs", () => {
    const { hand } = createHand();

    hand.hover(PRESSED, SCREEN);
    press(hand);

    expect(hand.hovered).toBeNull();
  });

  it("shows an open hand, a closed one while carrying and a blocked one over a refused spot", () => {
    const { hand } = createHand();

    expect(hand.cursor(null)).toBe("open");

    press(hand);

    expect(hand.cursor(null)).toBe("closed");
    expect(hand.cursor(PLACEABLE)).toBe("closed");
    expect(hand.cursor(BLOCKED)).toBe("blocked");

    hand.end();

    expect(hand.cursor(null)).toBe("open");

    hand.select(false);

    expect(hand.cursor(null)).toBe("none");
  });

  it("sends a carry only when the point changes", () => {
    const { hand, send } = createHand();

    press(hand);
    hand.move(CARRIED);
    hand.move(CARRIED.clone());
    hand.move(PRESSED);

    expect(send.mock.calls.flat().filter(isCarry)).toHaveLength(2);
  });
});
