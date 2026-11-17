import type { GameSession } from "../../game/game-session.ts";
import type { SimulationCommand } from "../../simulation/commands.ts";
import type { SimulationFrame } from "../../simulation/frame.ts";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { useGuideStore } from "./guide-store.ts";

type GuideSession = Pick<GameSession, "frame" | "subscribe" | "subscribeToCommands">;

function handleCommand(command: SimulationCommand): void {
  const { record } = useGuideStore.getState();

  switch (command.type) {
    case "beginStroke":
    case "usePower":
      record({ kind: "cast", powerId: command.powerId });
      break;
    case "setSelection":
      if (command.selection?.kind === "tribe") {
        record({ kind: "step", step: "follow" });
      }
      break;
    case "setSpeed":
      if (command.speed > 1) {
        record({ kind: "step", step: "speed" });
      }
      break;
    default:
      break;
  }
}

export function connectGuide(session: GuideSession): () => void {
  let { seasonName } = session.frame.calendar;

  function handleFrame(frame: SimulationFrame): void {
    const { record } = useGuideStore.getState();

    for (const entry of frame.chronicle) {
      if (entry.category === "gift") {
        record({ kind: "step", step: "use" });
      } else {
        record({ category: entry.category, kind: "chronicle" });
      }
    }

    if (frame.calendar.seasonName !== seasonName) {
      ({ seasonName } = frame.calendar);
      record({ kind: "season", name: seasonName });
    }
  }

  const unsubscribeFrames = session.subscribe(handleFrame);
  const unsubscribeCommands = session.subscribeToCommands(handleCommand);
  const unsubscribeJournal = useInterfaceStore.subscribe((state, previous) => {
    if (
      state.isJournalOpen &&
      state.journalTab === "chronicle" &&
      (!previous.isJournalOpen || previous.journalTab !== "chronicle")
    ) {
      useGuideStore.getState().record({ kind: "step", step: "chronicle" });
    }
  });

  return () => {
    unsubscribeFrames();
    unsubscribeCommands();
    unsubscribeJournal();
  };
}
