"use client";

import { Search, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { tryApplyAction, type SceneAction } from "@/lib/studio/actions";
import {
  MOTIONS,
  planMotion,
  repeatable,
  type Motion,
  type MotionCategory,
} from "@/lib/studio/motions";
import {
  describeOptions,
  searchMotions,
  type MotionMatch,
} from "@/lib/studio/motionSearch";
import type { Figure } from "@/lib/studio/schema";
import type { Studio } from "./useStudio";
import { SectionTitle, cx } from "./ui";

/** Things people may type that the figure can't do yet. */
const NOT_YET =
  /\b(lie|lying|lay|laying|crawl|swim|sleep|push ?ups?|plank|roll|cartwheel|flip|handstand)/;

const CATEGORIES: MotionCategory[] = [
  "Standing",
  "Gestures",
  "Everyday",
  "Getting around",
  "Sitting and kneeling",
  "Sport and action",
  "Dance and exercise",
];

/** Type a pose or a move ("walk", "left kick", "eat twice") and put it
 * on the figure: a pose right away, a move as keyframes from the
 * current time, played straight after. With nothing typed, the whole
 * library is listed by kind. */
export function MotionSearch({
  studio,
  figure,
  time,
  onPlayFrom,
}: {
  studio: Studio;
  figure: Figure;
  /** Where a move starts (the timeline's current time). */
  time: number;
  /** Show and play the animation from a time. */
  onPlayFrom?: (t: number) => void;
}) {
  const { scene, dispatch } = studio;
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState("");
  // Optional length for moves, in seconds (typing "for 10 s" also works).
  const [seconds, setSeconds] = useState("");

  const matches = useMemo(() => searchMotions(text, 8), [text]);
  const browsing = text.trim() === "";
  const list: MotionMatch[] = browsing
    ? CATEGORIES.flatMap((c) =>
        MOTIONS.filter((m) => m.category === c).map((motion) => ({
          motion,
          score: 0,
          options: {},
        })),
      )
    : matches;

  function apply(match: MotionMatch) {
    const typed = Number(seconds.replace(",", "."));
    const m =
      match.options.seconds || !(typed > 0)
        ? match
        : { ...match, options: { ...match.options, seconds: typed } };
    const action: SceneAction = {
      type: "applyMotion",
      motion: m.motion.id,
      figure: figure.id,
      ...(m.motion.kind === "move" ? { t: time } : {}),
      ...(m.options.mirror && m.motion.sided ? { mirror: true } : {}),
      ...(m.options.repeat && repeatable(m.motion)
        ? { repeat: m.options.repeat }
        : {}),
      ...(m.options.seconds && m.motion.kind === "move"
        ? { seconds: Math.min(120, m.options.seconds) }
        : {}),
      ...(m.options.slow ? { slow: m.options.slow } : {}),
      ...(m.options.inPlace ? { inPlace: true } : {}),
      ...(m.options.backwards ? { backwards: true } : {}),
    };
    const check = tryApplyAction(scene, action);
    if (!check.ok) {
      setStatus(check.error);
      return;
    }
    dispatch(action);
    if (m.motion.kind === "move") {
      const plan = planMotion(m.motion, figure, m.options);
      const room =
        plan.path === "spot"
          ? " On the spot: no room to walk (move the figure towards the middle)."
          : plan.path === "circle"
            ? " Round a circle, to stay in the studio."
            : "";
      const capped = plan.capped ? " (as long as one move can be)" : "";
      setStatus(
        `${m.motion.name}: ${plan.length.toFixed(1)} s${capped} from ${time.toFixed(1)} s.${room}`,
      );
      onPlayFrom?.(time);
    } else setStatus(`Pose: ${m.motion.name}`);
    setText("");
    setOpen(false);
  }

  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  const shown = open ? list : [];
  const unsupported = !browsing && matches.length === 0 && NOT_YET.test(text);

  return (
    <div className="relative" data-testid="motion-search">
      <SectionTitle>Type a pose or move</SectionTitle>
      <div className="relative mt-1.5">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
        />
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded={shown.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            shown.length
              ? optionId(Math.min(active, shown.length - 1))
              : undefined
          }
          aria-label="Pose or move"
          placeholder="walk, sit, wave, left kick, eat…"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          value={text}
          data-testid="motion-input"
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
            setStatus("");
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, list.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const m = list[Math.min(active, list.length - 1)];
              if (m && !browsing) apply(m);
              else if (m && open) apply(m);
            } else if (e.key === "Escape") {
              if (text) setText("");
              else input.current?.blur();
              setOpen(false);
            }
            // Studio shortcuts (Space, K...) stay out of the text box.
            e.stopPropagation();
          }}
          className="h-10 w-full rounded-lg border border-ink-700 bg-ink-850 pl-8 pr-8 text-base text-ink-100 placeholder:text-ink-500 focus:border-accent focus:outline-none sm:h-9 sm:text-sm"
        />
        {text && (
          <button
            type="button"
            aria-label="Clear"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setText("");
              input.current?.focus();
            }}
            className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-ink-400 hover:text-ink-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      <label className="mt-1.5 flex items-center gap-2 text-xs text-ink-300">
        Seconds
        <input
          type="number"
          inputMode="decimal"
          min={0.5}
          max={120}
          step={0.5}
          placeholder="auto"
          value={seconds}
          onChange={(e) => setSeconds(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          data-testid="motion-seconds"
          className="h-9 w-20 rounded-md border border-ink-700 bg-ink-850 px-2 text-base text-ink-100 placeholder:text-ink-500 focus:border-accent focus:outline-none sm:h-8 sm:text-sm"
        />
        <span className="text-2xs text-ink-400">
          how long a move lasts (or type &ldquo;walk for 10 s&rdquo;)
        </span>
      </label>
      {shown.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label={
            browsing ? "All poses and moves" : "Matching poses and moves"
          }
          data-testid="motion-results"
          className="absolute inset-x-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-ink-700 bg-ink-900 py-1 shadow-xl"
        >
          {shown.map((m, i) => {
            const header =
              browsing &&
              (i === 0 || shown[i - 1].motion.category !== m.motion.category);
            return (
              <li key={m.motion.id} role="presentation">
                {header && (
                  <div
                    role="presentation"
                    className="px-3 pb-0.5 pt-2 text-2xs font-semibold uppercase tracking-wide text-ink-400"
                  >
                    {m.motion.category}
                  </div>
                )}
                <div
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  data-testid={`motion-option-${m.motion.id}`}
                  // Keep focus in the box so the list doesn't close first.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => apply(m)}
                  onMouseEnter={() => setActive(i)}
                  className={cx(
                    "flex cursor-pointer items-baseline gap-2 px-3 py-2 sm:py-1.5",
                    i === active ? "bg-ink-800" : "",
                  )}
                >
                  <span className="text-sm text-ink-100">{m.motion.name}</span>
                  <Badge motion={m.motion} />
                  {describeOptions(m) && (
                    <span className="text-2xs text-accent">
                      {describeOptions(m)}
                    </span>
                  )}
                  <span className="ml-auto hidden truncate text-2xs text-ink-400 sm:inline">
                    {m.motion.note}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p
        className="mt-1 min-h-[1rem] text-2xs text-ink-400"
        aria-live="polite"
        data-testid="motion-status"
      >
        {open && !browsing && matches.length === 0
          ? unsupported
            ? "Lying down, crawling and swimming need the figure tipped over, which it can't do yet."
            : `Nothing called “${text.trim()}” yet. Try walk, run, sit, wave or eat.`
          : status}
      </p>
    </div>
  );
}

function Badge({ motion }: { motion: Motion }) {
  return (
    <span
      className={cx(
        "shrink-0 rounded px-1 text-2xs",
        motion.kind === "pose"
          ? "bg-ink-800 text-ink-300"
          : "bg-accent-soft text-accent",
      )}
    >
      {motion.kind === "pose" ? "Pose" : "Move"}
    </span>
  );
}
