import { type RefObject, useEffect, useRef } from "react";
import type { SidePanelView } from "./use-side-panel.ts";

const HEADING_SELECTOR = "section:not([hidden]) [data-panel-heading]";

interface PanelFocusOptions {
  readonly isOpeningManaged: boolean;
  readonly panelReference: RefObject<HTMLElement | null>;
  readonly view: SidePanelView;
}

interface FocusMemory {
  listItem: HTMLElement | null;
  opener: HTMLElement | null;
}

function focusHeading(panel: HTMLElement): void {
  panel.querySelector<HTMLElement>(HEADING_SELECTOR)?.focus();
}

function focusedElementIn(panel: HTMLElement): HTMLElement | null {
  const focused = document.activeElement;

  if (focused instanceof HTMLElement && panel.contains(focused)) {
    return focused;
  }

  return null;
}

function hasLostFocus(): boolean {
  const focused = document.activeElement;

  return focused === null || focused === document.body;
}

function focusIfPresent(element: HTMLElement | null): boolean {
  if (element === null || !element.isConnected) {
    return false;
  }

  element.focus();

  return document.activeElement === element;
}

function focusOnOpen(panel: HTMLElement, view: SidePanelView, memory: FocusMemory, isOpeningManaged: boolean): void {
  const focused = document.activeElement;

  memory.opener = focused instanceof HTMLElement ? focused : null;

  if (isOpeningManaged && view === "journal") {
    focusHeading(panel);
  }
}

function focusBetweenViews(panel: HTMLElement, view: SidePanelView, memory: FocusMemory): void {
  if (view === "card") {
    memory.listItem = focusedElementIn(panel);

    if (memory.listItem !== null) {
      focusHeading(panel);
    }

    return;
  }

  if (hasLostFocus() && !focusIfPresent(memory.listItem)) {
    focusHeading(panel);
  }
}

export function usePanelFocus({ isOpeningManaged, panelReference, view }: PanelFocusOptions): void {
  const previousView = useRef<SidePanelView>("closed");
  const memory = useRef<FocusMemory>({ listItem: null, opener: null });

  useEffect(() => {
    const from = previousView.current;
    const panel = panelReference.current;

    previousView.current = view;

    if (from === view) {
      return;
    }

    if (view === "closed") {
      if (isOpeningManaged && hasLostFocus()) {
        focusIfPresent(memory.current.opener);
      }

      return;
    }

    if (panel === null) {
      return;
    }

    if (from === "closed") {
      focusOnOpen(panel, view, memory.current, isOpeningManaged);

      return;
    }

    focusBetweenViews(panel, view, memory.current);
  }, [isOpeningManaged, panelReference, view]);
}
