import { describe, expect, it, onTestFinished } from "vitest";
import type { SimulationCommand } from "../../simulation/commands.ts";
import type { SimulationFrame } from "../../simulation/frame.ts";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { FINISHED_INTRO } from "../testing/guide-fixtures.ts";
import { createListeners } from "../testing/listener-fixtures.ts";
import { createCalendar, createChronicleEntry, createFrame } from "../testing/world-fixtures.ts";
import { connectGuide } from "./connect-guide.ts";
import { useGuideStore } from "./guide-store.ts";

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
  it("credits the gift when a tribe receives it, including while paused", () => {
    const { receive, send } = connectSession();

    send({ parameters: {}, powerId: "abundance", type: "usePower", x: 0, z: 0 });
    receive({ effects: [{ kind: "blessing", radius: 10, style: "abundance", x: 0, z: 0 }] });

    expect(doneTips()).toEqual([]);

    receive({ chronicle: [createChronicleEntry({ category: "gift" })], isPaused: true });

    expect(doneTips()).toEqual(["use"]);
  });

  it("credits a camp visit when a tribe is inspected", () => {
    const { send } = connectSession();

    send({ selection: { kind: "cell", x: 10, z: 20 }, type: "setSelection" });
    send({ selection: null, type: "setSelection" });

    expect(doneTips()).toEqual([]);

    send({ selection: { id: 3, kind: "tribe" }, type: "setSelection" });

    expect(doneTips()).toEqual(["follow"]);
  });

  it("credits speeding up and opening the chronicle through the regular HUD", () => {
    const { send } = connectSession();

    send({ speed: 1, type: "setSpeed" });
    useInterfaceStore.getState().openJournal("tribes");

    expect(doneTips()).toEqual([]);

    send({ speed: 4, type: "setSpeed" });
    useInterfaceStore.getState().setJournalTab("chronicle");

    expect(doneTips()).toEqual(["speed", "chronicle"]);
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
    send({ speed: 4, type: "setSpeed" });
    useInterfaceStore.getState().openJournal("chronicle");

    expect(doneTips()).toEqual([]);

    finishIntro();
    receive({ chronicle: [createChronicleEntry({ category: "fire" })] });

    expect(useGuideStore.getState().progress).toEqual(FINISHED_INTRO);
  });
});
