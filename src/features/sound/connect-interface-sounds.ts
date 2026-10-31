import { ACTION_RANK, InterfaceSounds } from "../../audio/interface-sounds.ts";
import { SOUNDS } from "../../audio/sound-catalog.ts";
import { type InterfaceStore, useInterfaceStore } from "../interface/interface-store.ts";
import { isPowerPicked, type PowerStore, usePowerStore } from "../powers/power-store.ts";
import { sound } from "./sound.ts";

function isPicked(state: PowerStore, previous: PowerStore): boolean {
  return isPowerPicked(state, previous) || (state.isHandSelected && !previous.isHandSelected);
}

function openedPanels(state: InterfaceStore): number {
  return [state.isJournalOpen, state.isMapOpen, state.isSettingsOpen].filter(Boolean).length;
}

export function connectInterfaceSounds(root: Document): () => void {
  const sounds = new InterfaceSounds(sound);
  const detach = sounds.attach(root);

  const unsubscribePowers = usePowerStore.subscribe((state, previous) => {
    if (isPicked(state, previous)) {
      sounds.request(SOUNDS.uiPower, ACTION_RANK);
    }
  });
  const unsubscribePanels = useInterfaceStore.subscribe((state, previous) => {
    const change = openedPanels(state) - openedPanels(previous);

    if (change !== 0) {
      sounds.request(change > 0 ? SOUNDS.uiOpen : SOUNDS.uiClose, ACTION_RANK);
    }
  });

  return () => {
    detach();
    unsubscribePowers();
    unsubscribePanels();
  };
}
