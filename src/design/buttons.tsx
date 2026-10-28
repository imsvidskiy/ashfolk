import { Button as BaseButton } from "@base-ui/react/button";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn.ts";
import { FOCUS_RING_OFFSET } from "./styles.ts";

type ButtonTone = "accent" | "danger" | "outline" | "quiet";

const BUTTON_TONES: Readonly<Record<ButtonTone, string>> = {
  accent: "bg-dawn hover:bg-dawn-strong text-white",
  danger: "bg-ember hover:bg-ember/90 text-white",
  outline: "border border-paper-edge text-ink-soft hover:bg-paper-hover hover:text-ink",
  quiet: "text-ink-soft hover:bg-paper-hover hover:text-ink",
};

interface IconButtonProps extends Omit<ComponentProps<typeof BaseButton>, "aria-label" | "children"> {
  readonly icon: ReactNode;
  readonly isPressed?: boolean | undefined;
  readonly label: string;
}

export function IconButton({ className, icon, isPressed, label, ...props }: IconButtonProps) {
  return (
    <BaseButton
      {...props}
      aria-label={label}
      aria-pressed={isPressed}
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-full transition-colors duration-150 pointer-coarse:size-11",
        {
          "bg-dawn-soft text-dawn-strong": isPressed === true,
          "text-ink-soft hover:bg-paper-hover hover:text-ink active:bg-paper-press": isPressed !== true,
        },
        FOCUS_RING_OFFSET,
        className
      )}
    >
      {icon}
    </BaseButton>
  );
}

interface TextButtonProps extends ComponentProps<typeof BaseButton> {
  readonly tone: ButtonTone;
}

export function TextButton({ className, tone, ...props }: TextButtonProps) {
  return (
    <BaseButton
      {...props}
      className={cn(
        "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors duration-150 pointer-coarse:h-10",
        "disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON_TONES[tone],
        FOCUS_RING_OFFSET,
        className
      )}
    />
  );
}
