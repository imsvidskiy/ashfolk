import { Tooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn.ts";
import { POPUP_MOTION } from "./styles.ts";

type TooltipSide = "bottom" | "left" | "right" | "top";

const OPEN_DELAY = 450;

export function TooltipProvider({ children }: { readonly children: ReactNode }) {
  return <Tooltip.Provider delay={OPEN_DELAY}>{children}</Tooltip.Provider>;
}

interface WithTooltipProps {
  readonly children: ReactElement;
  readonly content: ReactNode;
  readonly side?: TooltipSide | undefined;
}

export function WithTooltip({ children, content, side = "top" }: WithTooltipProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />

      <Tooltip.Portal>
        <Tooltip.Positioner className="z-50" side={side} sideOffset={10}>
          <Tooltip.Popup
            className={cn(
              POPUP_MOTION,
              "bg-ink/92 max-w-64 rounded-xl px-3 py-2 text-xs leading-snug text-white duration-100 pointer-coarse:hidden"
            )}
          >
            {content}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
