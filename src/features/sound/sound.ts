import { SoundEngine } from "../../audio/sound-engine.ts";
import { useSoundStore } from "./sound-store.ts";

export const sound = new SoundEngine();

export function connectSound(target: Window): () => void {
  const detach = sound.attach(target);

  sound.setLevels(useSoundStore.getState().levels);

  const unsubscribe = useSoundStore.subscribe((state) => {
    sound.setLevels(state.levels);
  });

  return () => {
    detach();
    unsubscribe();
  };
}
