import { useEngine } from "../../app/use-engine.ts";
import { useIsCompact } from "../../design/use-media-query.ts";
import type { EngineHandle } from "../../game/engine-handle.ts";
import type { TribeSummary } from "../../simulation/frame.ts";
import { useInterfaceStore } from "../interface/interface-store.ts";

const FOCUS_DISTANCE = 260;

export function focusOnCamp(engine: EngineHandle, tribe: TribeSummary): void {
  engine.focusOn(tribe.campX, tribe.campZ, FOCUS_DISTANCE);
}

export function showTribe(engine: EngineHandle, tribe: TribeSummary): void {
  focusOnCamp(engine, tribe);
  engine.session.send({ selection: { id: tribe.id, kind: "tribe" }, type: "setSelection" });
}

export function useShowTribe(tribe: TribeSummary) {
  const engine = useEngine();

  return () => {
    if (engine !== null) {
      showTribe(engine, tribe);
    }
  };
}

export function useShowSpot(x: number, z: number) {
  const engine = useEngine();
  const isCompact = useIsCompact();
  const closeJournal = useInterfaceStore((state) => {
    return state.closeJournal;
  });

  return () => {
    engine?.focusOn(x, z, FOCUS_DISTANCE);

    if (isCompact) {
      closeJournal();
    }
  };
}
