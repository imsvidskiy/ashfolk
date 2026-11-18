import { type PointerEvent, type RefObject, useEffect, useRef } from "react";
import { useEngine } from "../../app/use-engine.ts";
import { cn } from "../../design/cn.ts";
import { Island } from "../../design/island.tsx";
import type { EngineHandle } from "../../game/engine-handle.ts";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { MinimapPainter } from "./minimap-painter.ts";

function useMinimapPainter(canvasReference: RefObject<HTMLCanvasElement | null>, engine: EngineHandle): void {
  useEffect(() => {
    const canvas = canvasReference.current;

    if (canvas === null) {
      return;
    }

    const painter = new MinimapPainter(canvas, engine);

    painter.start();

    return () => {
      painter.stop();
    };
  }, [canvasReference, engine]);
}

function useMinimapNavigation(engine: EngineHandle) {
  function focusAt(event: PointerEvent<HTMLCanvasElement>): void {
    const { grid } = engine.session.mirror;

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * grid.worldSize - grid.halfSize;
    const z = ((event.clientY - bounds.top) / bounds.height) * grid.worldSize - grid.halfSize;

    engine.focusOn(x, z);
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    focusAt(event);
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      focusAt(event);
    }
  }

  return { handlePointerDown, handlePointerMove };
}

function MinimapCanvas({ engine, isCompact }: { readonly engine: EngineHandle; readonly isCompact: boolean }) {
  const canvasReference = useRef<HTMLCanvasElement>(null);
  const { handlePointerDown, handlePointerMove } = useMinimapNavigation(engine);

  useMinimapPainter(canvasReference, engine);

  return (
    <canvas
      aria-label="Map of the island. Click to move the camera."
      className={cn("size-44 cursor-crosshair touch-none rounded-2xl", {
        "size-[clamp(4.5rem,12dvh,7.5rem)]": isCompact,
      })}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      ref={canvasReference}
      role="img"
    />
  );
}

export function MinimapIsland({
  className,
  isCompact = false,
}: {
  readonly className?: string | undefined;
  readonly isCompact?: boolean;
}) {
  const engine = useEngine();
  const isMapOpen = useInterfaceStore((state) => {
    return state.isMapOpen;
  });

  if (!isMapOpen || engine === null) {
    return null;
  }

  return (
    <Island className={className}>
      <div className="p-1.5">
        <MinimapCanvas engine={engine} isCompact={isCompact} />
      </div>
    </Island>
  );
}
