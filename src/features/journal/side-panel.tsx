import { X } from "lucide-react";
import { type RefObject, useEffect, useRef } from "react";
import { IconButton } from "../../design/buttons.tsx";
import { Island } from "../../design/island.tsx";
import type { Inspection } from "../../simulation/inspection.ts";
import { InspectorCard } from "../inspector/inspector-card.tsx";
import { JournalPanel } from "./journal-panel.tsx";
import { usePanelFocus } from "./use-panel-focus.ts";
import { useSidePanel } from "./use-side-panel.ts";

export interface PanelContents {
  readonly inspection: Inspection | null;
  readonly isJournalOpen: boolean;
}

interface SidePanelContentProps {
  readonly contents: PanelContents;
  readonly onBack: () => void;
  readonly onClose: () => void;
}

interface JournalSectionProps {
  readonly isHidden: boolean;
  readonly onClose: () => void;
}

function useCloseOnEscape(panelReference: RefObject<HTMLElement | null>, isOpen: boolean, close: () => void): void {
  useEffect(() => {
    const panel = panelReference.current;

    if (!isOpen || panel === null) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") {
        return;
      }

      event.stopPropagation();
      close();
    }

    panel.addEventListener("keydown", handleKeyDown);

    return () => {
      panel.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, isOpen, panelReference]);
}

function JournalSection({ isHidden, onClose }: JournalSectionProps) {
  return (
    <section aria-label="Journal" className="flex min-h-0 flex-1 flex-col gap-3" hidden={isHidden}>
      <header className="flex items-center justify-between gap-2 pl-1">
        <h2 className="text-ink text-lg leading-tight font-semibold outline-none" data-panel-heading="" tabIndex={-1}>
          Journal
        </h2>

        <IconButton icon={<X aria-hidden="true" size={18} />} label="Close the journal" onClick={onClose} />
      </header>

      <JournalPanel />
    </section>
  );
}

export function SidePanelContent({ contents, onBack, onClose }: SidePanelContentProps) {
  const { inspection, isJournalOpen } = contents;

  return (
    <>
      {isJournalOpen ? <JournalSection isHidden={inspection !== null} onClose={onClose} /> : null}

      {inspection === null ? null : (
        <InspectorCard inspection={inspection} onBack={isJournalOpen ? onBack : undefined} onClose={onClose} />
      )}
    </>
  );
}

export function SidePanel() {
  const { back, close, inspection, isJournalOpen, view } = useSidePanel();
  const panelReference = useRef<HTMLDivElement>(null);

  usePanelFocus({ isOpeningManaged: true, panelReference, view });
  useCloseOnEscape(panelReference, view !== "closed", close);

  if (view === "closed") {
    return null;
  }

  return (
    <Island className="w-journal flex max-h-full flex-col self-start">
      <div className="flex min-h-0 flex-1 flex-col p-3" ref={panelReference}>
        <SidePanelContent contents={{ inspection, isJournalOpen }} onBack={back} onClose={close} />
      </div>
    </Island>
  );
}
