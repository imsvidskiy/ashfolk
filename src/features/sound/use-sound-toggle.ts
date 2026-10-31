import { Volume2, VolumeX } from "lucide-react";
import { useSoundStore } from "./sound-store.ts";

export function useSoundToggle() {
  const isMuted = useSoundStore((state) => {
    return state.levels.isMuted;
  });
  const setMuted = useSoundStore((state) => {
    return state.setMuted;
  });

  function toggleSound(): void {
    setMuted(!isMuted);
  }

  return {
    icon: isMuted ? VolumeX : Volume2,
    isMuted,
    label: isMuted ? "Turn the sound on" : "Turn the sound off",
    toggleSound,
  };
}
