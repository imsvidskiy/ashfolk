export const FOCUS_RING = "outline-none focus-visible:ring-2 focus-visible:ring-dawn";

export const FOCUS_RING_OFFSET = `${FOCUS_RING} focus-visible:ring-offset-1`;

export const PAPER_SURFACE = "border border-paper-edge bg-paper";

export const FIELD_SURFACE = "rounded-full bg-white/60 px-4 text-sm ring-1 ring-ink/8 ring-inset";

export const DIALOG_BACKDROP =
  "bg-ink/12 fixed inset-0 z-40 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0";

export const DIALOG_VIEWPORT =
  "fixed inset-0 z-50 flex items-center justify-center px-3 pt-(--dialog-inset-top) pb-(--dialog-inset-bottom)";

export const DIALOG_POPUP =
  "ease-glide transition-[scale,opacity] duration-200 outline-none data-ending-style:scale-97 data-ending-style:opacity-0 data-starting-style:scale-97 data-starting-style:opacity-0";

export const MENU_ITEM =
  "flex h-11 cursor-default items-center gap-3 rounded-xl px-3 text-sm text-ink outline-none select-none data-highlighted:bg-paper-hover";

export const POPUP_MOTION =
  "origin-(--transform-origin) transition-[scale,opacity] data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0";

export const MENU_POPUP = `${PAPER_SURFACE} ${POPUP_MOTION} rounded-island p-1.5 duration-150 outline-none`;

export const SEGMENT_CHOSEN = "text-ink shadow-segment bg-white";

export const SEGMENT_TRACK = "flex gap-0.5 rounded-full bg-ink/6 p-0.5";

export const SEGMENT = `inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 font-medium text-ink-soft text-xs transition-[color,background-color,box-shadow] duration-150 hover:text-ink data-active:bg-white data-pressed:bg-white data-active:text-ink data-pressed:text-ink data-active:shadow-segment data-pressed:shadow-segment ${FOCUS_RING}`;
