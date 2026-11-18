import { InterfaceSounds } from "../../audio/interface-sounds.ts";
import { SoundEngine } from "../../audio/sound-engine.ts";
import { useSoundStore } from "./sound-store.ts";

export const sound = new SoundEngine();
export const interfaceSounds = new InterfaceSounds(sound);

export function connectSound(target: Window): () => void {
  const detach = sound.attach(target);
  const detachInterface = interfaceSounds.attach(target.document);

  sound.setLevels(useSoundStore.getState().levels);

  const unsubscribe = useSoundStore.subscribe((state) => {
    sound.setLevels(state.levels);
  });

  return () => {
    detach();
    detachInterface();
    unsubscribe();
  };
}
