import { ArrowLeft } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import tallPoster from "../../app/start-backdrop/tall.webp";
import widePoster from "../../app/start-backdrop/wide.webp";
import { cn } from "../../design/cn.ts";
import { FOCUS_RING, PAPER_SURFACE } from "../../design/styles.ts";
import privacyText from "./privacy.md?raw";

const ISLAND_CLASS = cn(PAPER_SURFACE, "rounded-island");

export function PrivacyPage() {
  return (
    <div className="relative min-h-dvh">
      <picture>
        <source media="(orientation: portrait)" srcSet={tallPoster} />

        <img alt="" className="fixed inset-0 size-full object-cover" height={1080} src={widePoster} width={1920} />
      </picture>

      <div className="relative mx-auto flex max-w-4xl flex-col gap-3 px-4 py-6 sm:py-12">
        <a
          className={cn(
            ISLAND_CLASS,
            FOCUS_RING,
            "text-ink hover:text-dawn-strong inline-flex h-11 items-center gap-2 self-start px-4 text-sm font-semibold transition-colors duration-150"
          )}
          href="/"
        >
          <ArrowLeft aria-hidden="true" size={16} />
          Back to the game
        </a>

        <main className={ISLAND_CLASS}>
          <article className="prose max-w-none p-6 sm:p-12">
            <Markdown remarkPlugins={[remarkGfm]}>{privacyText}</Markdown>
          </article>
        </main>
      </div>
    </div>
  );
}
