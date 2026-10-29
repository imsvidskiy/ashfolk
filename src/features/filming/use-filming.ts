import { useSyncExternalStore } from "react";
import { useEngine } from "../../app/use-engine.ts";
import { FILMING_OFF, type FilmingSettings } from "../../game/filming.ts";
import { ignore } from "../../shared/ignore.ts";

export function useFilming(): FilmingSettings {
  const engine = useEngine();

  function subscribe(onChange: () => void): () => void {
    if (engine === null) {
      return ignore;
    }

    return engine.filming.subscribe(onChange);
  }

  function settingsNow(): FilmingSettings {
    return engine === null ? FILMING_OFF : engine.filming.settings;
  }

  return useSyncExternalStore(subscribe, settingsNow);
}
