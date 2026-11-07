"use client";

/** Keyframe timeline: play/pause, scrub, keys as diamonds (click to jump,
 * drag to retime), set/delete key, auto-key, camera keying, loop and
 * length. Playback runs here and draws frames straight to the viewport
 * (no React update per frame); the studio is told the time when it
 * stops. In preview mode only the playback controls show. */

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ChartSpline,
  ChevronDown,
  Ellipsis,
  Clapperboard,
  Film,
  Diamond,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Trash2,
  Video,
} from "lucide-react";
import { evaluate, keyAt } from "@/lib/studio/animation";
import { isAnimated, speechEnd, withSpeech } from "@/lib/studio/speech";
import { SpeechPlayer, preloadSpeech, wakeAudio } from "./speechAudio";
import { LIMITS } from "@/lib/studio/schema";
import type { ViewportHandle } from "./StudioViewport";
import type { Studio } from "./useStudio";
import { IconButton, cx } from "./ui";

/** Half the range thumb's width: diamonds line up with the thumb. */
const THUMB = 8;

export function Timeline({
  studio,
  viewport,
  time,
  onSeek,
  autoKey,
  onAutoKey,
  keyCamera,
  onKeyCamera,
  loop,
  onLoop,
  preview = false,
  onPreview,
  graphOpen = false,
  onGraph,
  mini = false,
  expanded = false,
  onVideo,
  playRequest = 0,
}: {
  studio: Studio;
  viewport: RefObject<ViewportHandle | null>;
  /** The studio's current time (where edits are keyed). */
  time: number;
  /** Move the studio to a time: shows the animation there. */
  onSeek: (t: number) => void;
  autoKey: boolean;
  onAutoKey: (v: boolean) => void;
  keyCamera: boolean;
  onKeyCamera: (v: boolean) => void;
  loop: boolean;
  onLoop: (v: boolean) => void;
  /** Preview mode: playback controls only. */
  preview?: boolean;
  onPreview: (v: boolean) => void;
  graphOpen?: boolean;
  /** Phones, outside the Animate tab: one slim row (play, scrub, key). */
  mini?: boolean;
  /** Phones, in the Animate tab: every control, no "More". */
  expanded?: boolean;
  onGraph?: (v: boolean) => void;
  /** Open the video export dialog. */
  onVideo?: () => void;
  /** Bumped by the parent to toggle playback (Space). */
  playRequest?: number;
}) {
  const { scene, dispatch, seal } = studio;
  const { duration, keys } = scene.animation;
  const animated = isAnimated(scene);
  const [playing, setPlaying] = useState(false);
  // Phones: the secondary controls fold away behind "More".
  const [moreToggle, setMore] = useState(false);
  const more = expanded || moreToggle;
  const extra = more ? undefined : "hidden sm:inline-flex";
  const [playT, setPlayT] = useState(time);
  const shown = playing ? playT : time;
  const onKey = keyAt(scene.animation, time);

  // Read at frame time without restarting the loop.
  const live = useRef({ scene, keyCamera, loop, duration, onSeek });
  live.current = { scene, keyCamera, loop, duration, onSeek };

  // Lip sync's sounds: ready before playing, started with it.
  const speaker = useRef<SpeechPlayer | null>(null);
  useEffect(() => preloadSpeech(scene), [scene]);

  function play() {
    if (!animated) return;
    // Inside the tap or key press: phones only start sound from one.
    if (scene.speech.length) wakeAudio();
    setPlayT(time >= duration - 0.01 ? 0 : time);
    setPlaying(true);
  }
  function pause() {
    setPlaying(false);
  }
  const toggle = () => (playing ? pause() : play());

  // Only a new request toggles: a timeline shown later (another phone
  // tab) doesn't replay an old one.
  const seenRequest = useRef(playRequest);
  useEffect(() => {
    if (playRequest === seenRequest.current) return;
    seenRequest.current = playRequest;
    toggle();
    // Only on a new request, not when toggle's closure changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playRequest]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let t = playT;
    const player = (speaker.current ??= new SpeechPlayer());
    player.start(live.current.scene, t);
    const step = (now: number) => {
      const l = live.current;
      t += (now - last) / 1000;
      last = now;
      let done = false;
      if (t >= l.duration) {
        if (l.loop) {
          t %= l.duration;
          player.start(l.scene, t);
        } else {
          t = l.duration;
          done = true;
        }
      }
      const frame = evaluate(l.scene, t);
      viewport.current?.preview(withSpeech(frame.scene, t));
      if (l.keyCamera && frame.view)
        viewport.current?.setCameraPlacement(frame.view);
      setPlayT(t);
      if (done) setPlaying(false);
      else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // However playback stops (pause, the end, leaving preview), the
    // studio moves to where it stopped.
    return () => {
      cancelAnimationFrame(raf);
      player.stop();
      live.current.onSeek(Math.round(t * 100) / 100);
    };
    // playT is the start time; later changes come from this loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, viewport]);

  // Preview mode starts playing; leaving it stops.
  useEffect(() => {
    if (preview && animated) {
      setPlayT(0);
      setPlaying(true);
    }
    if (!preview) setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  const prev = [...keys].reverse().find((k) => k.t < time - 0.005);
  const next = keys.find((k) => k.t > time + 0.005);
  const camera = () =>
    keyCamera ? viewport.current?.cameraPlacement() : undefined;

  // Dragging a diamond retimes the key; a click without moving jumps.
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ at: number; x: number; moved: boolean } | null>(null);
  const beatDrag = useRef<{ x: number; moved: boolean } | null>(null);
  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const u = (clientX - r.left - THUMB) / Math.max(1, r.width - 2 * THUMB);
    return Math.round(Math.min(1, Math.max(0, u)) * duration * 100) / 100;
  };

  if (mini)
    // Phones, while animating, outside the Animate tab: one row so you
    // can scrub and pose without switching tabs.
    return (
      <div
        data-testid="timeline"
        className="flex items-center gap-1 border-t border-ink-800 bg-ink-900/95 px-2 py-0.5"
      >
        <IconButton
          icon={playing ? Pause : Play}
          size="sm"
          label={playing ? "Pause" : "Play"}
          onClick={toggle}
          data-testid="timeline-play"
        />
        <input
          type="range"
          aria-label="Time"
          min={0}
          max={duration}
          step={0.01}
          value={shown}
          disabled={playing}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="h-8 min-w-0 flex-1 cursor-pointer accent-accent"
          data-testid="timeline-scrub"
        />
        <IconButton
          icon={Diamond}
          size="sm"
          label={onKey ? "Update keyframe" : "Set keyframe"}
          disabled={playing}
          onClick={() =>
            dispatch({ type: "setKey", t: time, camera: camera() })
          }
          data-testid="timeline-set-key"
        />
        <span
          className="w-11 shrink-0 text-right font-mono text-2xs tabular-nums text-ink-200"
          data-testid="timeline-time"
        >
          {shown.toFixed(1)} s
        </span>
      </div>
    );

  return (
    <div
      data-testid="timeline"
      className={cx(
        "pointer-events-auto flex flex-wrap items-center gap-x-1 gap-y-0.5 border-t border-ink-800 bg-ink-900/95 px-2 py-1 backdrop-blur",
      )}
    >
      <IconButton
        icon={playing ? Pause : Play}
        size="sm"
        label={playing ? "Pause" : "Play"}
        shortcut="Space"
        disabled={!animated}
        onClick={toggle}
        data-testid="timeline-play"
      />
      {!preview && (
        <>
          <IconButton
            icon={SkipBack}
            className={extra}
            size="sm"
            label="Previous keyframe"
            shortcut=","
            disabled={!prev || playing}
            onClick={() => prev && onSeek(prev.t)}
            data-testid="timeline-prev"
          />
          <IconButton
            icon={SkipForward}
            className={extra}
            size="sm"
            label="Next keyframe"
            shortcut="."
            disabled={!next || playing}
            onClick={() => next && onSeek(next.t)}
            data-testid="timeline-next"
          />
        </>
      )}
      <span
        className="w-[5.5rem] shrink-0 text-center font-mono text-2xs tabular-nums text-ink-200"
        data-testid="timeline-time"
      >
        {shown.toFixed(2)} / {duration.toFixed(0)} s
      </span>

      <div
        ref={track}
        className="relative order-last h-7 min-w-0 basis-full sm:order-none sm:basis-0 sm:flex-1"
      >
        <input
          type="range"
          aria-label="Time"
          min={0}
          max={duration}
          step={0.01}
          value={shown}
          disabled={playing}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer accent-accent"
          data-testid="timeline-scrub"
        />
        {/* Direction beats: a marker at the top where each starts. */}
        {scene.beats.map((b, i) => {
          const where = `${b.text} at ${b.t.toFixed(1)} s${b.note ? ` — ${b.note}` : ""}`;
          // Which of its figure's beats: stays the same while retiming.
          const index = scene.beats
            .slice(0, i)
            .filter((o) => o.figure === b.figure).length;
          const move = (to: number) =>
            dispatch(
              { type: "moveBeat", figure: b.figure, index, to },
              { gesture: true },
            );
          return (
            <button
              key={`${b.figure}-${index}`}
              type="button"
              aria-label={`Beat: ${where}`}
              title={`${where} — drag to retime it and what follows`}
              disabled={playing || preview}
              data-testid={`timeline-beat-${i}`}
              style={{
                left: `calc(${THUMB}px + (100% - ${2 * THUMB}px) * ${Math.min(1, b.t / duration)})`,
              }}
              // Above the keys (a beat usually starts on one), with a
              // finger-sized area round the small flag.
              className="absolute -top-1 z-10 h-3 w-2.5 -translate-x-1/2 touch-none rounded-b-sm border border-ink-950 bg-emerald-400 before:absolute before:-inset-x-2 before:-inset-y-2 before:content-[''] hover:bg-emerald-300"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                beatDrag.current = { x: e.clientX, moved: false };
              }}
              onPointerMove={(e) => {
                const d = beatDrag.current;
                if (!d || (!d.moved && Math.abs(e.clientX - d.x) < 3)) return;
                d.moved = true;
                move(timeAt(e.clientX));
              }}
              onPointerUp={() => {
                const d = beatDrag.current;
                beatDrag.current = null;
                if (d?.moved) seal();
                else onSeek(b.t);
              }}
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                e.stopPropagation();
                move(b.t + (e.key === "ArrowRight" ? 0.1 : -0.1));
                seal();
              }}
            />
          );
        })}
        {/* Where lip sync speaks: a strip under the keys. */}
        {scene.speech.map((sp, i) => {
          const a = Math.min(1, sp.start / duration);
          const b = Math.min(1, speechEnd(sp) / duration);
          return (
            <span
              key={i}
              aria-hidden
              title={`Lip sync: ${sp.name}`}
              data-testid={`timeline-speech-${i}`}
              style={{
                left: `calc(${THUMB}px + (100% - ${2 * THUMB}px) * ${a})`,
                width: `calc((100% - ${2 * THUMB}px) * ${b - a})`,
              }}
              className="pointer-events-none absolute bottom-0.5 h-1 rounded-full bg-sky-400/70"
            />
          );
        })}
        {keys.map((k) => {
          const current = Math.abs(k.t - time) < 0.005;
          return (
            <button
              key={k.t}
              type="button"
              aria-label={`Keyframe at ${k.t.toFixed(2)} s`}
              aria-pressed={current}
              title={`Keyframe at ${k.t.toFixed(2)} s — drag to move, Delete to remove`}
              data-testid={`timeline-key-${k.t.toFixed(2)}`}
              disabled={playing || preview}
              style={{
                left: `calc(${THUMB}px + (100% - ${2 * THUMB}px) * ${k.t / duration})`,
              }}
              className={cx(
                "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border transition-colors",
                current
                  ? "border-white bg-accent"
                  : "border-ink-950 bg-amber-300 hover:bg-accent",
              )}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { at: k.t, x: e.clientX, moved: false };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d || (!d.moved && Math.abs(e.clientX - d.x) < 3)) return;
                d.moved = true;
                const to = timeAt(e.clientX);
                if (to === d.at || keyAt(scene.animation, to)) return;
                dispatch(
                  { type: "moveKey", from: d.at, to },
                  { gesture: true },
                );
                d.at = to;
              }}
              onPointerUp={() => {
                const d = drag.current;
                drag.current = null;
                if (!d) return;
                if (d.moved) seal();
                onSeek(d.at);
              }}
              onKeyDown={(e) => {
                if (e.key === "Delete" || e.key === "Backspace") {
                  e.preventDefault();
                  e.stopPropagation();
                  dispatch({ type: "deleteKey", t: k.t });
                }
              }}
            />
          );
        })}
      </div>

      {!preview && (
        <>
          <IconButton
            icon={Diamond}
            size="sm"
            label={onKey ? "Update keyframe" : "Set keyframe"}
            shortcut="K"
            disabled={playing}
            onClick={() =>
              dispatch({ type: "setKey", t: time, camera: camera() })
            }
            data-testid="timeline-set-key"
          />
          <IconButton
            icon={Trash2}
            className={extra}
            size="sm"
            label="Delete keyframe"
            disabled={!onKey || playing}
            onClick={() => onKey && dispatch({ type: "deleteKey", t: onKey.t })}
            data-testid="timeline-delete-key"
          />
          <button
            type="button"
            aria-pressed={autoKey}
            title="Auto-key: every change records a keyframe at the current time"
            onClick={() => onAutoKey(!autoKey)}
            data-testid="timeline-autokey"
            className={cx(
              "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-2xs font-medium transition-colors",
              autoKey
                ? "bg-red-500/20 text-red-300"
                : "text-ink-300 hover:bg-ink-750 hover:text-ink-100",
            )}
          >
            <span
              aria-hidden
              className={cx(
                "h-2 w-2 rounded-full",
                autoKey ? "bg-red-500" : "bg-ink-500",
              )}
            />
            Auto-key
          </button>
          <IconButton
            icon={Video}
            className={extra}
            size="sm"
            label={keyCamera ? "Camera is keyed" : "Camera is not keyed"}
            active={keyCamera}
            aria-pressed={keyCamera}
            onClick={() => onKeyCamera(!keyCamera)}
            data-testid="timeline-camera"
          />
        </>
      )}
      <IconButton
        icon={Repeat}
        className={extra}
        size="sm"
        label="Loop"
        active={loop}
        aria-pressed={loop}
        onClick={() => onLoop(!loop)}
        data-testid="timeline-loop"
      />
      {!preview && (
        <>
          <label
            className={cx(
              "shrink-0 items-center gap-1 text-2xs text-ink-300",
              more ? "flex" : "hidden sm:flex",
            )}
          >
            Length
            <input
              type="number"
              min={LIMITS.duration[0]}
              max={LIMITS.duration[1]}
              step={1}
              value={duration}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= LIMITS.duration[0] && v <= LIMITS.duration[1])
                  dispatch({ type: "setDuration", duration: v });
              }}
              className="h-6 w-12 rounded border border-ink-700 bg-ink-850 px-1 text-right text-ink-100"
              data-testid="timeline-duration"
            />
            s
          </label>
          {onGraph && (
            <IconButton
              icon={ChartSpline}
              className={extra}
              size="sm"
              label={graphOpen ? "Hide graph editor" : "Show graph editor"}
              shortcut="G"
              active={graphOpen}
              aria-pressed={graphOpen}
              onClick={() => onGraph(!graphOpen)}
              data-testid="timeline-graph"
            />
          )}
          <IconButton
            icon={Clapperboard}
            className={extra}
            size="sm"
            label="Preview animation"
            shortcut="V"
            disabled={!animated}
            onClick={() => onPreview(true)}
            data-testid="timeline-preview"
          />
          {onVideo && (
            <IconButton
              icon={Film}
              className={extra}
              size="sm"
              label="Export video"
              disabled={!animated}
              onClick={() => {
                // Rendering takes over the view: stop playing first.
                if (playing) toggle();
                onVideo();
              }}
              data-testid="timeline-video"
            />
          )}
        </>
      )}
      <IconButton
        icon={more ? ChevronDown : Ellipsis}
        size="sm"
        label={more ? "Fewer timeline controls" : "More timeline controls"}
        aria-expanded={more}
        className={expanded ? "hidden" : "sm:hidden"}
        onClick={() => setMore(!moreToggle)}
        data-testid="timeline-more"
      />
    </div>
  );
}
