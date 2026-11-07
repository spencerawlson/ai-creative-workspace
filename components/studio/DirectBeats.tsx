"use client";

import { useId, useMemo, useState } from "react";
import { Clapperboard } from "lucide-react";
import {
  MAX_BEATS,
  beatScript,
  parseBeat,
  splitBeats,
} from "@/lib/studio/beats";
import { tryApplyAction, type SceneAction } from "@/lib/studio/actions";
import { roundTime } from "@/lib/studio/animation";
import type { Figure } from "@/lib/studio/schema";
import type { Studio } from "./useStudio";
import { Button, SectionTitle, cx } from "./ui";

const secs = (t: number) => `${Math.round(t * 10) / 10} s`;

/** Direct a scene: beats written one per line, played one after another
 * by this figure from the playhead (lib/studio/beats.ts). */
export function DirectBeats({
  studio,
  figure,
  time,
  onPlayFrom,
}: {
  studio: Studio;
  figure: Figure;
  time: number;
  onPlayFrom?: (t: number) => void;
}) {
  const { scene, dispatch, notify } = studio;
  const id = useId();
  const mine = scene.beats.filter((b) => b.figure === figure.id);
  // Starts from the figure's beats as directed, if it has any.
  const [script, setScript] = useState(() => beatScript(mine));
  const [error, setError] = useState<string | null>(null);
  const lines = useMemo(() => splitBeats(script).map(parseBeat), [script]);
  const problems = lines.filter((l) => !l.ok);
  const tooMany = lines.length > MAX_BEATS;

  function direct() {
    const start = roundTime(time);
    const action: SceneAction = {
      type: "directBeats",
      figure: figure.id,
      t: start,
      beats: lines.flatMap((l) => (l.ok ? [l.beat] : [])),
    };
    // Checked first, so a problem shows here and nothing plays.
    const r = tryApplyAction(scene, action);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    dispatch(action);
    onPlayFrom?.(start);
    const n = action.beats.length;
    notify(`Directed ${n} beat${n === 1 ? "" : "s"} from ${secs(start)}.`);
  }

  return (
    <section aria-label="Direct beats" data-testid="beats" className="mt-3">
      <SectionTitle>Direct</SectionTitle>
      <label htmlFor={id} className="text-2xs leading-relaxed text-ink-300">
        Write the scene as beats, one per line: a move, &ldquo;face the
        camera&rdquo;, &ldquo;turn left&rdquo;, or &ldquo;pause 1 s&rdquo;. Add
        a note after &ldquo;—&rdquo;. They play one after another from the
        playhead.
      </label>
      <textarea
        id={id}
        rows={4}
        value={script}
        onChange={(e) => setScript(e.target.value)}
        placeholder={
          "walk 2 times\nface the camera\nwave — says hi\npause 1 s\nsit down"
        }
        className="mt-1.5 w-full resize-y rounded-md border border-ink-700 bg-ink-850 px-2 py-1.5 text-xs text-ink-100 placeholder:text-ink-500 focus:border-accent focus:outline-none"
        data-testid="beats-script"
      />
      {lines.length > 0 && (
        <ol className="mt-1 space-y-0.5" data-testid="beats-preview">
          {lines.map((l, i) => (
            <li
              key={i}
              className={cx(
                "flex gap-1.5 text-2xs",
                l.ok ? "text-ink-300" : "text-danger",
              )}
            >
              <span className="w-4 shrink-0 text-right tabular-nums text-ink-500">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                {l.ok ? l.label : l.error}
                {l.ok && l.beat.note && (
                  <span className="text-ink-500"> · {l.beat.note}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      {error && (
        <p
          role="alert"
          className="mt-1 text-2xs text-danger"
          data-testid="beats-error"
        >
          {error}
        </p>
      )}
      {tooMany && (
        <p role="alert" className="mt-1 text-2xs text-danger">
          At most {MAX_BEATS} beats at once.
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          icon={Clapperboard}
          disabled={lines.length === 0 || problems.length > 0 || tooMany}
          onClick={direct}
          data-testid="beats-direct"
        >
          Direct from {secs(time)}
        </Button>
        {mine.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => dispatch({ type: "clearBeats", figure: figure.id })}
            data-testid="beats-clear"
          >
            Clear markers
          </Button>
        )}
      </div>
    </section>
  );
}
