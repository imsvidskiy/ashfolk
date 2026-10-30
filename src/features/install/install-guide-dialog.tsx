import { Dialog } from "@base-ui/react/dialog";
import { Share } from "lucide-react";
import { TextButton } from "../../design/buttons.tsx";
import { cn } from "../../design/cn.ts";
import { Island } from "../../design/island.tsx";
import { DIALOG_BACKDROP, DIALOG_POPUP, DIALOG_VIEWPORT } from "../../design/styles.ts";
import { useInstallStore } from "./install-store.ts";

function useInstallGuide() {
  const isGuideOpen = useInstallStore((state) => {
    return state.isGuideOpen;
  });
  const setGuideOpen = useInstallStore((state) => {
    return state.setGuideOpen;
  });

  return { isGuideOpen, setGuideOpen };
}

export function InstallGuideDialog() {
  const { isGuideOpen, setGuideOpen } = useInstallGuide();

  return (
    <Dialog.Root onOpenChange={setGuideOpen} open={isGuideOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />

        <Dialog.Viewport className={DIALOG_VIEWPORT}>
          <Dialog.Popup className={cn(DIALOG_POPUP, "w-notice")}>
            <Island className="flex flex-col gap-5 p-5 sm:p-6">
              <div className="flex flex-col gap-2">
                <Dialog.Title className="text-ink text-lg leading-tight font-semibold">Install Dawnfolk</Dialog.Title>

                <Dialog.Description className="text-ink-soft text-sm">
                  Tap Share <Share aria-hidden="true" className="inline align-text-bottom" size={16} />, then Add to
                  Home Screen. Dawnfolk will open from your home screen like an app, without the browser around it.
                </Dialog.Description>
              </div>

              <div className="flex justify-end">
                <Dialog.Close render={<TextButton tone="accent">Got it</TextButton>} />
              </div>
            </Island>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
