import { ACTION_RANK } from "../../audio/interface-sounds.ts";
import { SOUNDS } from "../../audio/sound-catalog.ts";
import { type InterfaceStore, useInterfaceStore } from "../interface/interface-store.ts";
import { isPowerPicked, type PowerStore, usePowerStore } from "../powers/power-store.ts";
import { interfaceSounds } from "./sound.ts";

function isPicked(state: PowerStore, previous: PowerStore): boolean {
  return isPowerPicked(state, previous) || (state.isHandSelected && !previous.isHandSelected);
}

function openedPanels(state: InterfaceStore): number {
  return [state.isJournalOpen, state.isMapOpen, state.isSettingsOpen].filter(Boolean).length;
}

export function connectInterfaceSounds(): () => void {
  const unsubscribePowers = usePowerStore.subscribe((state, previous) => {
    if (isPicked(state, previous)) {
      interfaceSounds.request(SOUNDS.uiPower, ACTION_RANK);
    }
  });
  const unsubscribePanels = useInterfaceStore.subscribe((state, previous) => {
    const change = openedPanels(state) - openedPanels(previous);

    if (change !== 0) {
      interfaceSounds.request(change > 0 ? SOUNDS.uiOpen : SOUNDS.uiClose, ACTION_RANK);
    }
  });

  return () => {
    unsubscribePowers();
    unsubscribePanels();
  };
}
