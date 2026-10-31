import { describe, expect, it, onTestFinished, vi } from "vitest";
import { ACTION_RANK, InterfaceSounds } from "../../audio/interface-sounds.ts";
import { SOUNDS } from "../../audio/sound-catalog.ts";
import { ignore } from "../../shared/ignore.ts";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { usePowerStore } from "../powers/power-store.ts";
import { connectInterfaceSounds } from "./connect-interface-sounds.ts";

function connectSounds() {
  const request = vi.spyOn(InterfaceSounds.prototype, "request").mockImplementation(ignore);
  const disconnect = connectInterfaceSounds(document);

  onTestFinished(disconnect);

  return { disconnect, request };
}

describe("connecting the interface sounds", () => {
  it("plays the power sound when a power or the hand is taken up", () => {
    const { request } = connectSounds();

    usePowerStore.getState().selectPower("rain");
    usePowerStore.getState().selectPower("rain");
    usePowerStore.getState().selectPower("fire");
    usePowerStore.getState().selectPower(null);
    usePowerStore.getState().selectHand();
    usePowerStore.getState().selectHand();

    expect(request.mock.calls).toEqual([
      [SOUNDS.uiPower, ACTION_RANK],
      [SOUNDS.uiPower, ACTION_RANK],
      [SOUNDS.uiPower, ACTION_RANK],
    ]);
  });

  it("plays the open and close sounds as panels open and close", () => {
    useInterfaceStore.setState({ isMapOpen: false });

    const { request } = connectSounds();

    useInterfaceStore.getState().openJournal("tribes");
    useInterfaceStore.getState().setJournalTab("chronicle");
    useInterfaceStore.getState().openSettings();
    useInterfaceStore.getState().closeJournal();
    useInterfaceStore.getState().toggleMap();

    expect(request.mock.calls).toEqual([
      [SOUNDS.uiOpen, ACTION_RANK],
      [SOUNDS.uiOpen, ACTION_RANK],
      [SOUNDS.uiClose, ACTION_RANK],
      [SOUNDS.uiOpen, ACTION_RANK],
    ]);
  });

  it("stays quiet after disconnecting", () => {
    const { disconnect, request } = connectSounds();
    const button = document.createElement("button");

    document.body.append(button);
    onTestFinished(() => {
      button.remove();
    });
    disconnect();
    usePowerStore.getState().selectPower("rain");
    useInterfaceStore.getState().openSettings();
    button.click();

    expect(request).not.toHaveBeenCalled();
  });
});
