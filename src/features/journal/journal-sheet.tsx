import { Drawer } from "@base-ui/react/drawer";
import { useRef, useState } from "react";
import { titleOf } from "../inspector/inspector-card.tsx";
import { type PanelContents, SidePanelContent } from "./side-panel.tsx";
import { usePanelFocus } from "./use-panel-focus.ts";
import { useSidePanel } from "./use-side-panel.ts";

function useShownContents(contents: PanelContents, isOpen: boolean): PanelContents {
  const [shown, setShown] = useState(contents);

  const isChanged = shown.inspection !== contents.inspection || shown.isJournalOpen !== contents.isJournalOpen;

  if (isOpen && isChanged) {
    setShown(contents);
  }

  return isOpen ? contents : shown;
}

function useJournalSheet() {
  const { back, close, inspection, isJournalOpen, view } = useSidePanel();
  const panelReference = useRef<HTMLDivElement>(null);

  const isOpen = view !== "closed";
  const contents = useShownContents({ inspection, isJournalOpen }, isOpen);

  usePanelFocus({ isOpeningManaged: false, panelReference, view });

  const label = contents.inspection === null ? "Journal" : titleOf(contents.inspection);

  function handleOpenChange(isNowOpen: boolean): void {
    if (!isNowOpen) {
      close();
    }
  }

  return { back, close, contents, handleOpenChange, isOpen, label, panelReference };
}

export function JournalSheet() {
  const { back, close, contents, handleOpenChange, isOpen, label, panelReference } = useJournalSheet();

  return (
    <Drawer.Root disablePointerDismissal={true} modal={false} onOpenChange={handleOpenChange} open={isOpen}>
      <Drawer.Portal>
        <Drawer.Viewport className="pointer-events-none fixed inset-0 z-30 flex items-end">
          <Drawer.Popup
            aria-label={label}
            className="max-h-sheet rounded-t-sheet border-paper-edge bg-paper pb-sheet ease-glide pointer-events-auto flex w-full [transform:translateY(var(--drawer-swipe-movement-y))] flex-col gap-2 border-t px-4 pt-2 transition-transform duration-450 outline-none data-ending-style:[transform:translateY(100%)] data-starting-style:[transform:translateY(100%)]"
          >
            <div aria-hidden="true" className="bg-ink/20 h-1 w-10 shrink-0 self-center rounded-full" />

            <Drawer.Content className="flex min-h-0 flex-1 flex-col" ref={panelReference}>
              <SidePanelContent contents={contents} onBack={back} onClose={close} />
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
