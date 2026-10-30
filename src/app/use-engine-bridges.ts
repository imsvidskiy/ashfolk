import { useEffect } from "react";
import { connectWorldSounds } from "../audio/world-sounds.ts";
import { connectGuide } from "../features/guide/connect-guide.ts";
import { useInterfaceStore } from "../features/interface/interface-store.ts";
import { connectPowers } from "../features/powers/connect-powers.ts";
import { connectAutosave, useIsLandChangePending, useSavesStore } from "../features/saves/saves-store.ts";
import { connectInterfaceSounds } from "../features/sound/connect-interface-sounds.ts";
import { sound } from "../features/sound/sound.ts";
import { connectWorldStore } from "../features/world/world-store.ts";
import { rememberWorldInAddress, useLaunchStore } from "./launch-store.ts";
import { useEngine } from "./use-engine.ts";

export function useEngineBridges(): void {
  const engine = useEngine();
  const worldId = useLaunchStore((state) => {
    return state.worldId;
  });
  const name = useLaunchStore((state) => {
    return state.launch.name;
  });
  const areOutlinesShown = useInterfaceStore((state) => {
    return state.areOutlinesShown;
  });
  const isLandChangePending = useIsLandChangePending(engine === null ? null : engine.session);

  useEffect(() => {
    if (engine === null) {
      return;
    }

    const disconnectWorld = connectWorldStore(engine.session);
    const disconnectPowers = connectPowers(engine);
    const disconnectGuide = connectGuide(engine.session);
    const disconnectWorldSounds = connectWorldSounds(engine, sound);
    const disconnectInterfaceSounds = connectInterfaceSounds(document);

    return () => {
      disconnectWorld();
      disconnectPowers();
      disconnectGuide();
      disconnectWorldSounds();
      disconnectInterfaceSounds();

      if (useSavesStore.getState().acceptedLand === engine.session) {
        useSavesStore.setState({ acceptedLand: null });
      }
    };
  }, [engine]);

  useEffect(() => {
    if (engine === null) {
      return;
    }

    rememberWorldInAddress(worldId);

    if (isLandChangePending) {
      return;
    }

    return connectAutosave(engine.session, { id: worldId, name });
  }, [engine, isLandChangePending, name, worldId]);

  useEffect(() => {
    if (engine === null) {
      return;
    }

    engine.setOutlinesShown(areOutlinesShown);
  }, [areOutlinesShown, engine]);
}
