import { type RefObject, useEffect } from "react";
import type { EngineHandle } from "../../game/engine-handle.ts";
import type { LabelPlacement } from "../../game/label-projector.ts";

const LABEL_SELECTOR = "[data-label]";
const LABEL_ATTRIBUTES = ["data-label", "data-lift", "data-priority", "data-rank", "data-x", "data-z"];
const TOP_CLEARANCE = 76;
const FAR_DISTANCE = 2600;
const CROWDED_WIDTH = 150;
const CROWDED_HEIGHT = 40;

interface PlacedLabel {
  readonly isPriority: boolean;
  readonly label: HTMLElement;
  readonly placement: LabelPlacement;
  readonly rank: number;
}

function isCrowding(first: LabelPlacement, second: LabelPlacement): boolean {
  return Math.abs(first.left - second.left) < CROWDED_WIDTH && Math.abs(first.top - second.top) < CROWDED_HEIGHT;
}

function byRank(first: PlacedLabel, second: PlacedLabel): number {
  if (first.isPriority !== second.isPriority) {
    return first.isPriority ? -1 : 1;
  }

  return first.rank - second.rank;
}

function showLabel(label: HTMLElement, placement: LabelPlacement): void {
  label.style.transform = `translate3d(${placement.left.toFixed(1)}px, ${placement.top.toFixed(1)}px, 0) translate(-50%, -100%)`;
  label.toggleAttribute("data-shown", true);
}

function hideLabel(label: HTMLElement): void {
  label.toggleAttribute("data-shown", false);
}

function placeVisibleLabels(engine: EngineHandle, layer: HTMLElement): PlacedLabel[] {
  const placed: PlacedLabel[] = [];

  for (const label of layer.querySelectorAll<HTMLElement>(LABEL_SELECTOR)) {
    const { lift, rank = "0", x, z } = label.dataset;

    const placement = engine.placeLabel(Number(x), Number(z), Number(lift));

    if (placement === null || placement.top < TOP_CLEARANCE) {
      hideLabel(label);
      continue;
    }

    placed.push({
      isPriority: label.hasAttribute("data-priority"),
      label,
      placement,
      rank: Number(rank),
    });
  }

  return placed;
}

function placeLabels(engine: EngineHandle, layer: HTMLElement): void {
  layer.toggleAttribute("data-far", engine.camera.state.distance > FAR_DISTANCE);

  const placed = placeVisibleLabels(engine, layer);
  const shown: PlacedLabel[] = [];

  for (const entry of placed.toSorted(byRank)) {
    const isCrowded =
      !entry.isPriority &&
      shown.some((other) => {
        return isCrowding(other.placement, entry.placement);
      });

    if (isCrowded) {
      hideLabel(entry.label);
      continue;
    }

    shown.push(entry);
    showLabel(entry.label, entry.placement);
  }
}

function keepLabelsPlaced(engine: EngineHandle, layer: HTMLElement): () => void {
  const placedMatrix = engine.camera.camera.matrixWorld.clone();
  let placedWidth = 0;
  let placedHeight = 0;
  let placedLandVersion = 0;
  let haveLabelsChanged = true;

  const observer = new MutationObserver(() => {
    haveLabelsChanged = true;
  });

  function place(): void {
    const { matrixWorld } = engine.camera.camera;
    const { innerHeight, innerWidth } = window;
    const { landVersion } = engine.session.mirror;

    const isSameView =
      matrixWorld.equals(placedMatrix) &&
      innerWidth === placedWidth &&
      innerHeight === placedHeight &&
      landVersion === placedLandVersion;

    if (!haveLabelsChanged && isSameView) {
      return;
    }

    placedMatrix.copy(matrixWorld);
    placedWidth = innerWidth;
    placedHeight = innerHeight;
    placedLandVersion = landVersion;
    haveLabelsChanged = false;
    placeLabels(engine, layer);
  }

  observer.observe(layer, { attributeFilter: LABEL_ATTRIBUTES, attributes: true, childList: true, subtree: true });
  place();

  const unsubscribe = engine.subscribeToRenders(place);

  return () => {
    unsubscribe();
    observer.disconnect();
  };
}

export function useLabelLayout(layerReference: RefObject<HTMLElement | null>, engine: EngineHandle): void {
  useEffect(() => {
    const layer = layerReference.current;

    if (layer === null) {
      return;
    }

    return keepLabelsPlaced(engine, layer);
  }, [engine, layerReference]);
}
