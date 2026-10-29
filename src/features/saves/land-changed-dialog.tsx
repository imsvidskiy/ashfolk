import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Sprout } from "lucide-react";
import { useEffect, useRef } from "react";
import { useLaunchStore } from "../../app/launch-store.ts";
import { useEngine } from "../../app/use-engine.ts";
import { TextButton } from "../../design/buttons.tsx";
import { cn } from "../../design/cn.ts";
import { Island } from "../../design/island.tsx";
import { DIALOG_BACKDROP, DIALOG_POPUP, DIALOG_VIEWPORT } from "../../design/styles.ts";
import { ignore } from "../../shared/ignore.ts";
import { markLandChanged } from "./save-database.ts";
import { useIsLandChangePending, useSavesStore } from "./saves-store.ts";

function useLandChangedDialog() {
  const engine = useEngine();
  const session = engine === null ? null : engine.session;
  const isPending = useIsLandChangePending(session);
  const launch = useLaunchStore((state) => {
    return state.launch;
  });
  const worldId = useLaunchStore((state) => {
    return state.worldId;
  });
  const chooseWorld = useLaunchStore((state) => {
    return state.chooseWorld;
  });
  const createWorld = useLaunchStore((state) => {
    return state.createWorld;
  });
  const acceptLand = useSavesStore((state) => {
    return state.acceptLand;
  });
  const wasPaused = useRef<boolean>(false);

  useEffect(() => {
    if (session === null || !isPending) {
      return;
    }

    wasPaused.current = session.frame.isPaused || launch.isPaused;
    session.send({ isPaused: true, type: "setPaused" });
    markLandChanged(worldId).catch(ignore);
  }, [isPending, launch.isPaused, session, worldId]);

  function handlePlayOn(): void {
    if (session === null) {
      return;
    }

    if (!wasPaused.current) {
      session.send({ isPaused: false, type: "setPaused" });
    }

    acceptLand(session);
  }

  function handleGrowAnew(): void {
    createWorld({ name: launch.name, seed: launch.seed, shape: launch.shape, size: launch.size });
  }

  return { handleAllWorlds: chooseWorld, handleGrowAnew, handlePlayOn, isPending, launch };
}

export function LandChangedDialog() {
  const { handleAllWorlds, handleGrowAnew, handlePlayOn, isPending, launch } = useLandChangedDialog();

  return (
    <AlertDialog.Root open={isPending}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={DIALOG_BACKDROP} />

        <AlertDialog.Viewport className={DIALOG_VIEWPORT}>
          <AlertDialog.Popup className={cn(DIALOG_POPUP, "w-notice")}>
            <Island className="flex flex-col gap-5 p-5 sm:p-6">
              <div className="flex flex-col gap-2">
                <AlertDialog.Title className="text-ink text-lg leading-tight font-semibold">
                  The land has changed
                </AlertDialog.Title>

                <AlertDialog.Description className="text-ink-soft text-sm">
                  {launch.name} was saved in an older Dawnfolk, and seed {launch.seed} now grows a different island.
                  Hills and rivers will not match what your people built.
                </AlertDialog.Description>

                <p className="text-ink-soft text-sm">
                  Play on to keep your tribes on the new land, or grow the island anew from the same seed.
                </p>
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                <TextButton onClick={handleAllWorlds} tone="quiet">
                  All worlds
                </TextButton>

                <TextButton onClick={handlePlayOn} tone="outline">
                  Play on
                </TextButton>

                <TextButton onClick={handleGrowAnew} tone="accent">
                  <Sprout aria-hidden="true" size={16} />
                  Grow anew
                </TextButton>
              </div>
            </Island>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
