"use client";

import { useEffect, useRef, useState } from "react";

/** The hero portrait being drawn, as an 8-second muted loop.
 *
 * Autoplay only when the visitor has not asked for reduced motion —
 * otherwise it sits paused on the finished portrait and the visitor
 * presses play. A pause button is always there: a loop longer than
 * five seconds should be stoppable. */
export function ProcessVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    setReducedMotion(reduced);
    const video = ref.current;
    if (video && !reduced) {
      void video
        .play()
        .then(() => setPlaying(true))
        .catch(() => {});
    }
  }, []);

  function toggle() {
    const video = ref.current;
    if (!video) return;
    if (video.paused) {
      void video
        .play()
        .then(() => setPlaying(true))
        .catch(() => {});
    } else {
      video.pause();
      setPlaying(false);
    }
  }

  return (
    <figure className="relative overflow-hidden rounded-2xl border border-ink-800 bg-ink-900">
      <video
        ref={ref}
        data-testid="process-video"
        src="/landing/drawing-process.mp4"
        poster="/landing/portrait.jpg"
        muted
        loop
        playsInline
        preload="metadata"
        autoPlay={!reducedMotion}
        aria-label="Timelapse of the hero portrait being drawn, from construction lines to finished shading"
        className="aspect-square w-full object-cover"
      />
      <figcaption className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="text-sm text-ink-300">
          Drawn line by line — the same kind of character you light and pose in
          the studio.
        </span>
        <button
          type="button"
          onClick={toggle}
          aria-label={
            playing ? "Pause the drawing video" : "Play the drawing video"
          }
          className="min-h-11 shrink-0 rounded-full border border-ink-700 bg-ink-800 px-4 py-2 text-sm font-medium text-ink-100 hover:border-ink-600"
        >
          {playing ? "Pause" : "Play"}
        </button>
      </figcaption>
    </figure>
  );
}
