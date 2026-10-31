import { describe, expect, it, onTestFinished } from "vitest";
import type { SimulationCommand } from "../../simulation/commands.ts";
import type { SimulationFrame } from "../../simulation/frame.ts";
import { usePowerStore } from "../powers/power-store.ts";
import { addCanvas } from "../testing/canvas-fixtures.ts";
import { FINISHED_INTRO } from "../testing/guide-fixtures.ts";
import { createListeners } from "../testing/listener-fixtures.ts";
import { createCalendar, createChronicleEntry, createFrame } from "../testing/world-fixtures.ts";
import { connectGuide } from "./connect-guide.ts";
import { useGuideStore } from "./guide-store.ts";
import { FRESH_GUIDE } from "./guide-tips.ts";

const CAST = { parameters: {}, powerId: "rain", x: 0, z: 0 } as const;

function connectSession(seasonName = "Autumn") {
  const frames = createListeners<SimulationFrame>();
  const commands = createListeners<SimulationCommand>();

  const disconnect = connectGuide({
    frame: createFrame({ calendar: createCalendar({ seasonName }) }),
    subscribe: frames.subscribe,
    subscribeToCommands: commands.subscribe,
  });

  onTestFinished(disconnect);

  function receive(changes: Partial<SimulationFrame>): void {
    frames.emit(createFrame(changes));
  }

  return { disconnect, receive, send: commands.emit };
}

function finishIntro(): void {
  useGuideStore.setState({ progress: FINISHED_INTRO });
}

function doneTips(): readonly string[] {
  return useGuideStore.getState().progress.done;
}

describe("connecting the guide", () => {
  it.each([
    ["a cast", "usePower"],
    ["a brush stroke", "beginStroke"],
  ] as const)("counts %s as using a power", (_, type) => {
    const { send } = connectSession();

    send({ ...CAST, type });

    expect(doneTips()).toEqual(["use"]);
  });

  it("counts selecting something but not clearing the selection", () => {
    const { send } = connectSession();

    send({ selection: null, type: "setSelection" });

    expect(doneTips()).toEqual([]);

    send({ selection: { id: 1, kind: "tribe" }, type: "setSelection" });

    expect(doneTips()).toEqual(["follow"]);
  });

  it("counts a faster speed", () => {
    const { send } = connectSession();

    send({ speed: 4, type: "setSpeed" });

    expect(doneTips()).toEqual(["speed"]);
  });

  it("counts picking a power but not the hand or putting the power away", () => {
    connectSession();

    usePowerStore.getState().selectHand();
    usePowerStore.getState().selectPower(null);

    expect(doneTips()).toEqual([]);

    usePowerStore.getState().selectPower("rain");

    expect(doneTips()).toEqual(["pick"]);
  });

  it("counts a drag or a wheel over the island but not a hover or a drag over the interface", () => {
    connectSession();

    const canvas = addCanvas();

    canvas.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, buttons: 0 }));
    document.body.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, buttons: 1 }));

    expect(doneTips()).toEqual([]);

    canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }));

    expect(doneTips()).toEqual(["look"]);

    useGuideStore.setState({ progress: FRESH_GUIDE });
    canvas.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, buttons: 1 }));

    expect(doneTips()).toEqual(["look"]);
  });

  it("shows the tip of a chronicle entry once the intro is done", () => {
    const { receive } = connectSession();

    finishIntro();
    receive({ chronicle: [createChronicleEntry({ category: "birth" }), createChronicleEntry({ category: "fire" })] });

    expect(useGuideStore.getState().progress.shown).toBe("fire");
  });

  it("shows the winter tip when the season turns to winter", () => {
    const { receive } = connectSession("Autumn");

    finishIntro();
    receive({ calendar: createCalendar({ seasonName: "Autumn" }) });

    expect(useGuideStore.getState().progress.shown).toBeNull();

    receive({ calendar: createCalendar({ seasonName: "Winter" }) });

    expect(useGuideStore.getState().progress.shown).toBe("winter");
  });

  it("waits for the season to change before a winter tip", () => {
    const { receive } = connectSession("Winter");

    finishIntro();
    receive({ calendar: createCalendar({ seasonName: "Winter" }) });

    expect(useGuideStore.getState().progress.shown).toBeNull();
  });

  it("stops listening after disconnecting", () => {
    const { disconnect, receive, send } = connectSession();

    disconnect();
    send({ ...CAST, type: "usePower" });
    usePowerStore.getState().selectPower("rain");
    addCanvas().dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }));

    expect(doneTips()).toEqual([]);

    finishIntro();
    receive({ chronicle: [createChronicleEntry({ category: "fire" })] });

    expect(useGuideStore.getState().progress).toEqual(FINISHED_INTRO);
  });
});
