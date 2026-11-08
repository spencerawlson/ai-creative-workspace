"use client";

import { useId, useMemo, useRef, useState } from "react";
import { AudioLines, Clapperboard, X } from "lucide-react";
import {
  MAX_BEATS,
  beatScript,
  parseBeat,
  splitBeats,
  type BeatSpec,
} from "@/lib/studio/beats";
import { tryApplyAction, type SceneAction } from "@/lib/studio/actions";
import { roundTime } from "@/lib/studio/animation";
import { LIMITS, type Figure } from "@/lib/studio/schema";
import { speechLength } from "@/lib/studio/speech";
import { readVoice } from "./speechAudio";
import type { Studio } from "./useStudio";
import { Button, IconButton, SectionTitle, cx } from "./ui";

const secs = (t: number) => `${Math.round(t * 10) / 10} s`;

type BeatSound = NonNullable<BeatSpec["speech"]>;

/** Direct a scene: beats written one per line, played one after another
 * by this figure from the playhead (lib/studio/beats.ts). Any line can
 * carry a sound the figure says (lip sync); a "say" line needs one. */
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
  // Starts from the figure's beats as directed, and their sounds.
  const [script, setScript] = useState(() => beatScript(mine));
  const [sounds, setSounds] = useState<Record<string, BeatSound>>(() =>
    Object.fromEntries(
      mine.flatMap((b) => {
        const sp = scene.speech.find(
          (s) =>
            s.beat && s.figure === figure.id && Math.abs(s.start - b.t) < 0.005,
        );
        return sp
          ? [[b.text, { name: sp.name, sound: sp.sound, mouth: sp.mouth }]]
          : [];
      }),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const picking = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const lines = useMemo(() => splitBeats(script).map(parseBeat), [script]);
  const unsaid = lines.filter(
    (l) => l.ok && l.beat.do.kind === "say" && !sounds[l.beat.text],
  );
  const problems = lines.filter((l) => !l.ok);
  const tooMany = lines.length > MAX_BEATS;

  async function attach(text: string, file: File) {
    setReading(text);
    setError(null);
    try {
      const voice = await readVoice(file, LIMITS.duration[1] - roundTime(time));
      setSounds((s) => ({ ...s, [text]: voice.speech }));
      if (voice.kept)
        notify(`${voice.kept} The mouth moves; the sound won't play.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that sound.");
    } finally {
      setReading(null);
    }
  }

  function direct() {
    const start = roundTime(time);
    const action: SceneAction = {
      type: "directBeats",
      figure: figure.id,
      t: start,
      beats: lines.flatMap((l) =>
        l.ok
          ? [
              sounds[l.beat.text]
                ? { ...l.beat, speech: sounds[l.beat.text] }
                : l.beat,
            ]
          : [],
      ),
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
        camera&rdquo;, &ldquo;turn left&rdquo;, &ldquo;pause 1 s&rdquo;, or
        &ldquo;say hello&rdquo; with a sound. Add a note after &ldquo;—&rdquo;.
        They play one after another from the playhead; drag a marker on the
        timeline to retime one.
      </label>
      <textarea
        id={id}
        rows={4}
        value={script}
        onChange={(e) => setScript(e.target.value)}
        placeholder={
          "walk 2 times\nface the camera\nsay hello — friendly\npause 1 s\nsit down"
        }
        className="mt-1.5 w-full resize-y rounded-md border border-ink-700 bg-ink-850 px-2 py-1.5 text-xs text-ink-100 placeholder:text-ink-500 focus:border-accent focus:outline-none"
        data-testid="beats-script"
      />
      <input
        ref={input}
        type="file"
        accept="audio/*"
        className="sr-only"
        tabIndex={-1}
        aria-label="Sound for a beat"
        data-testid="beats-sound-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file && picking.current) void attach(picking.current, file);
        }}
      />
      {lines.length > 0 && (
        <ol className="mt-1 space-y-0.5" data-testid="beats-preview">
          {lines.map((l, i) => {
            const sound = l.ok ? sounds[l.beat.text] : undefined;
            const needs = l.ok && l.beat.do.kind === "say" && !sound;
            return (
              <li
                key={i}
                className={cx(
                  "flex items-center gap-1.5 text-2xs",
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
                  {sound && (
                    <span
                      className="text-sky-300"
                      data-testid={`beats-sound-${i}`}
                    >
                      {" "}
                      · says {sound.name} ({secs(speechLength(sound))})
                    </span>
                  )}
                  {needs && (
                    <span className="text-amber-300"> · pick its sound</span>
                  )}
                </span>
                {l.ok &&
                  (sound ? (
                    <IconButton
                      icon={X}
                      size="sm"
                      label={`Remove the sound from line ${i + 1}`}
                      onClick={() =>
                        setSounds((s) => {
                          const next = { ...s };
                          delete next[l.beat.text];
                          return next;
                        })
                      }
                      data-testid={`beats-sound-remove-${i}`}
                    />
                  ) : (
                    <IconButton
                      icon={AudioLines}
                      size="sm"
                      label={
                        reading === l.beat.text
                          ? "Reading the sound…"
                          : `A sound for line ${i + 1}`
                      }
                      disabled={reading !== null}
                      className={needs ? "text-amber-300" : undefined}
                      onClick={() => {
                        picking.current = l.beat.text;
                        input.current?.click();
                      }}
                      data-testid={`beats-sound-add-${i}`}
                    />
                  ))}
              </li>
            );
          })}
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
          disabled={
            lines.length === 0 ||
            problems.length > 0 ||
            unsaid.length > 0 ||
            tooMany ||
            reading !== null
          }
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
