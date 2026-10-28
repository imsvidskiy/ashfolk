export const FOCUS_RING = "outline-none focus-visible:ring-2 focus-visible:ring-dawn";

export const FOCUS_RING_OFFSET = `${FOCUS_RING} focus-visible:ring-offset-1`;

export const PAPER_SURFACE = "border border-paper-edge bg-paper";

export const FIELD_SURFACE = "rounded-full bg-white/60 px-4 text-sm ring-1 ring-ink/8 ring-inset";

export const POPUP_MOTION =
  "origin-(--transform-origin) transition-[scale,opacity] data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0";

export const SEGMENT_TRACK = "flex gap-0.5 rounded-full bg-ink/6 p-0.5";

export const SEGMENT = `inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 font-medium text-ink-soft text-xs transition-[color,background-color,box-shadow] duration-150 hover:text-ink data-active:bg-white data-pressed:bg-white data-active:text-ink data-pressed:text-ink data-active:shadow-segment data-pressed:shadow-segment ${FOCUS_RING}`;
