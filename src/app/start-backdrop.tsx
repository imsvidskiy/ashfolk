import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "../design/buttons.tsx";
import { useIsPortrait, useShouldReduceMotion } from "../design/use-media-query.ts";
import tallVideo from "./start-backdrop/tall.mp4";
import tallPoster from "./start-backdrop/tall.webp";
import tallCompactVideo from "./start-backdrop/tall-av1.mp4";
import wideVideo from "./start-backdrop/wide.mp4";
import widePoster from "./start-backdrop/wide.webp";
import wideCompactVideo from "./start-backdrop/wide-av1.mp4";

const BACKDROP_CLASS = "absolute inset-0 size-full object-cover";
const COMPACT_TYPE = 'video/mp4; codecs="av01.0.08M.08"';
const FALLBACK_TYPE = 'video/mp4; codecs="avc1.640028"';

interface Backdrop {
  readonly compactVideo: string;
  readonly height: number;
  readonly poster: string;
  readonly video: string;
  readonly width: number;
}

const TALL: Backdrop = {
  compactVideo: tallCompactVideo,
  height: 1920,
  poster: tallPoster,
  video: tallVideo,
  width: 1080,
};
const WIDE: Backdrop = {
  compactVideo: wideCompactVideo,
  height: 1080,
  poster: widePoster,
  video: wideVideo,
  width: 1920,
};

export function StartBackdrop() {
  const shouldReduceMotion = useShouldReduceMotion();
  const isPortrait = useIsPortrait();
  const video = useRef<HTMLVideoElement>(null);
  const [playback, setPlayback] = useState<boolean | null>(null);
  const isPlaying = playback === null ? !shouldReduceMotion : playback;

  const backdrop = isPortrait ? TALL : WIDE;

  useEffect(() => {
    const film = video.current;

    if (film === null) {
      return;
    }

    if (!isPlaying) {
      film.pause();
      return;
    }

    film.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setPlayback(false);
      }
    });
  }, [isPlaying]);

  const handlePlayback = useCallback(() => {
    setPlayback(!isPlaying);
  }, [isPlaying]);

  return (
    <div className="bg-canvas absolute inset-0">
      {shouldReduceMotion && playback === null ? (
        <img alt="" className={BACKDROP_CLASS} height={backdrop.height} src={backdrop.poster} width={backdrop.width} />
      ) : (
        <video
          autoPlay={isPlaying}
          className={BACKDROP_CLASS}
          key={backdrop.video}
          loop
          muted
          playsInline
          poster={backdrop.poster}
          ref={video}
          tabIndex={-1}
        >
          <source src={backdrop.compactVideo} type={COMPACT_TYPE} />

          <source src={backdrop.video} type={FALLBACK_TYPE} />
        </video>
      )}

      <IconButton
        className="absolute right-5 bottom-3 size-10 bg-[#faf7ed] text-[#3e5142] shadow-sm hover:bg-white sm:right-10 sm:bottom-5 lg:right-16"
        icon={isPlaying ? <Pause aria-hidden="true" size={16} /> : <Play aria-hidden="true" size={16} />}
        label={isPlaying ? "Pause island film" : "Play island film"}
        onClick={handlePlayback}
      />
    </div>
  );
}
