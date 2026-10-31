import { create } from "zustand";
import { type EngineStatus, WAKING_STATUS } from "./engine-launcher.ts";

interface EngineStore {
  readonly setStatus: (status: EngineStatus) => void;
  readonly status: EngineStatus;
}

export const useEngineStore = create<EngineStore>()((set) => {
  return {
    setStatus: (status) => {
      set({ status });
    },
    status: WAKING_STATUS,
  };
});
