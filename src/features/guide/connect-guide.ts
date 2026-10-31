import type { GameSession } from "../../game/game-session.ts";
import type { SimulationCommand } from "../../simulation/commands.ts";
import type { SimulationFrame } from "../../simulation/frame.ts";
import { isPowerPicked, usePowerStore } from "../powers/power-store.ts";
import { useGuideStore } from "./guide-store.ts";
import type { GuideEvent } from "./guide-tips.ts";

type GuideSession = Pick<GameSession, "frame" | "subscribe" | "subscribeToCommands">;

function record(event: GuideEvent): void {
  useGuideStore.getState().record(event);
}

function eventOfCommand(command: SimulationCommand): GuideEvent | null {
  switch (command.type) {
    case "beginStroke":
    case "usePower":
      return { kind: "powerUsed" };
    case "setSelection":
      return command.selection === null ? null : { kind: "selected" };
    case "setSpeed":
      return { kind: "speedChanged", speed: command.speed };
    default:
      return null;
  }
}

function handleCommand(command: SimulationCommand): void {
  const event = eventOfCommand(command);

  if (event !== null) {
    record(event);
  }
}

function isCanvasGesture(event: PointerEvent | WheelEvent): boolean {
  if (!(event.target instanceof HTMLCanvasElement)) {
    return false;
  }

  return event instanceof WheelEvent || event.buttons !== 0;
}

function handleGesture(event: PointerEvent | WheelEvent): void {
  if (isCanvasGesture(event)) {
    record({ kind: "cameraMoved" });
  }
}

export function connectGuide(session: GuideSession): () => void {
  let { seasonName } = session.frame.calendar;

  function handleFrame(frame: SimulationFrame): void {
    for (const entry of frame.chronicle) {
      record({ category: entry.category, kind: "chronicle" });
    }

    if (frame.calendar.seasonName !== seasonName) {
      ({ seasonName } = frame.calendar);
      record({ kind: "season", name: seasonName });
    }
  }

  const unsubscribeFrames = session.subscribe(handleFrame);
  const unsubscribeCommands = session.subscribeToCommands(handleCommand);
  const unsubscribePowers = usePowerStore.subscribe((state, previous) => {
    if (isPowerPicked(state, previous)) {
      record({ kind: "powerPicked" });
    }
  });

  window.addEventListener("pointermove", handleGesture);
  window.addEventListener("wheel", handleGesture);

  return () => {
    unsubscribeFrames();
    unsubscribeCommands();
    unsubscribePowers();
    window.removeEventListener("pointermove", handleGesture);
    window.removeEventListener("wheel", handleGesture);
  };
}
