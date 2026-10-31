import { Info } from "lucide-react";
import { useEffect } from "react";
import { cn } from "../../design/cn.ts";
import { GameIcon } from "../../design/game-icon.tsx";
import { PAPER_SURFACE } from "../../design/styles.ts";
import { CHRONICLE_ICONS } from "../journal/chronicle-icons.ts";
import { dismissNotice, useWorldStore, type WorldNotice } from "../world/world-store.ts";

const NOTICE_MILLISECONDS = 7000;

function useDismissLater(noticeId: number): void {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      dismissNotice(noticeId);
    }, NOTICE_MILLISECONDS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [noticeId]);
}

function NoticeIcon({ notice }: { readonly notice: WorldNotice }) {
  if (notice.category === "notice") {
    return <Info aria-hidden="true" className="text-ink-soft shrink-0" size={20} />;
  }

  return <GameIcon name={CHRONICLE_ICONS[notice.category]} />;
}

function NoticeItem({ notice }: { readonly notice: WorldNotice }) {
  useDismissLater(notice.id);

  return (
    <li
      className={cn(
        PAPER_SURFACE,
        "text-ink motion-safe:animate-notice-in sm:max-w-notice pointer-events-auto flex max-w-full items-center gap-2.5 rounded-full px-4 py-2 text-sm"
      )}
    >
      <NoticeIcon notice={notice} />

      <span className="leading-snug">{notice.text}</span>
    </li>
  );
}

export function NoticeFeed({ className }: { readonly className?: string | undefined }) {
  const notices = useWorldStore((state) => {
    return state.notices;
  });

  return (
    <ol aria-live="polite" className={cn("flex flex-col items-center gap-2", className)}>
      {notices.map((notice) => {
        return <NoticeItem key={notice.id} notice={notice} />;
      })}
    </ol>
  );
}
