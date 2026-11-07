/** Direction beats: a scene written as a list of beats, one per line
 * ("walk 3 steps", "face the camera", "wave twice — says hi", "pause
 * 1 s", "sit down"), played one after another by one figure.
 *
 * Each line is read as a move or pose from the motion library (the same
 * search as typing a move), a hold, or a turn on the spot. The planner
 * lays them out in time and space, each starting where the one before
 * ended, with a short blend between them; the result is ordinary
 * keyframes, and each beat is kept as a timeline marker with its note. */

import { roundTime } from "./animation";
import { findMotion, planMotion, type MotionOptions } from "./motions";
import { describeOptions, searchMotions } from "./motionSearch";
import { keepFace, type PoseJoints } from "./pose";
import { LIMITS, type Figure } from "./schema";

/** What a beat does. */
export type BeatDo =
  | ({ kind: "motion"; motion: string } & MotionOptions)
  | { kind: "hold"; seconds: number }
  | { kind: "turn"; to: TurnTarget };

export const TURN_TARGETS = ["camera", "left", "right", "away"] as const;
export type TurnTarget = (typeof TURN_TARGETS)[number];

export interface BeatSpec {
  /** The line as written (without its note). */
  text: string;
  note?: string;
  do: BeatDo;
}

/** A line read: the beat, or why it wasn't understood. */
export type ParsedBeat =
  | { ok: true; beat: BeatSpec; label: string }
  | { ok: false; text: string; error: string };

/** Seconds to blend from one beat's last pose into the next's first. */
export const BLEND = 0.4;
/** Seconds to take up a pose, or turn on the spot. */
export const POSE_TIME = 0.8;
export const MAX_BEATS = 24;
/** A search score below this isn't a confident reading of the line:
 * a typo in a move's name passes, a line only half of which matches
 * doesn't. */
const MIN_SCORE = 1.85;

/** Where a line's note starts: " — ", " -- " or "//". */
const NOTE = /\s+(?:—|--)\s+|\s*\/\/\s*/;

export function splitBeats(script: string): string[] {
  return script
    .split(/\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);
}

const HOLD = /^(?:pause|hold|wait|freeze|stay|stop|beat|still)\b/i;
const TURN =
  /^(?:turn|face|spin)\s+(?:to(?:wards?)?\s+|round\s+to\s+)?(?:the\s+|its\s+)?(camera|front|us|audience|left|right|away|back)\b/i;
const SECONDS = /(\d+(?:[.,]\d+)?)\s*(?:s|sec|secs|second|seconds)\b/i;

/** Read one line. */
export function parseBeat(line: string): ParsedBeat {
  const [what, ...rest] = line.split(NOTE);
  const text = what.trim().slice(0, 80);
  const note = rest.join(" ").trim().slice(0, 120) || undefined;
  if (!text) return { ok: false, text: line, error: "Write what happens." };
  const withNote = (beat: Omit<BeatSpec, "text" | "note">, label: string) =>
    ({
      ok: true,
      beat: { text, ...(note ? { note } : {}), ...beat },
      label,
    }) as const;

  if (HOLD.test(text)) {
    const m = SECONDS.exec(text);
    const seconds = Math.min(
      30,
      Math.max(0.2, m ? Number(m[1].replace(",", ".")) : 1),
    );
    return withNote({ do: { kind: "hold", seconds } }, `Hold ${seconds} s`);
  }
  const turn = TURN.exec(text);
  if (turn) {
    const w = turn[1].toLowerCase();
    const to: TurnTarget =
      w === "left" || w === "right"
        ? w
        : w === "away" || w === "back"
          ? "away"
          : "camera";
    const label = {
      camera: "Face the camera",
      left: "Turn to its left",
      right: "Turn to its right",
      away: "Turn away",
    }[to];
    return withNote({ do: { kind: "turn", to } }, label);
  }
  const [best] = searchMotions(text + " ", 1);
  if (!best || best.score < MIN_SCORE)
    return {
      ok: false,
      text,
      error: `"${text}" isn't a move the figure knows.`,
    };
  const options = Object.fromEntries(
    Object.entries(best.options).filter(([, v]) => v !== undefined),
  ) as MotionOptions;
  const extra = describeOptions(best);
  return withNote(
    { do: { kind: "motion", motion: best.motion.id, ...options } },
    extra ? `${best.motion.name} (${extra})` : best.motion.name,
  );
}

/** What a key records for a figure. */
export interface FigureState {
  x: number;
  y: number;
  z: number;
  rotation: number;
  joints: PoseJoints;
}

export interface BeatMarker {
  t: number;
  length: number;
  text: string;
  note?: string;
}

export interface BeatPlan {
  /** Keys for the figure, in time order, the first at the start. */
  entries: Array<{ t: number; entry: FigureState }>;
  markers: BeatMarker[];
  end: number;
}

const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const same = (a: FigureState, b: FigureState) =>
  Math.abs(a.x - b.x) < 0.01 &&
  Math.abs(a.y - b.y) < 0.01 &&
  Math.abs(a.z - b.z) < 0.01 &&
  Math.abs(wrap180(a.rotation - b.rotation)) < 0.5 &&
  JSON.stringify(a.joints) === JSON.stringify(b.joints);

/** Lay beats out from `t0`, starting from the figure as it is. */
export function planBeats(
  figure: Figure,
  t0: number,
  beats: BeatSpec[],
): BeatPlan | { error: string } {
  let state: FigureState = {
    x: figure.x,
    y: figure.y,
    z: figure.z,
    rotation: figure.rotation,
    joints: figure.pose.joints,
  };
  const face = figure.pose.joints;
  let t = roundTime(t0);
  const entries: BeatPlan["entries"] = [{ t, entry: state }];
  const markers: BeatMarker[] = [];
  const add = (at: number, entry: FigureState) => {
    entries.push({ t: roundTime(at), entry });
    state = entry;
  };
  for (const b of beats) {
    const start = t;
    const d = b.do;
    if (d.kind === "hold") add(t + d.seconds, state);
    else if (d.kind === "turn") {
      const rotation =
        d.to === "camera"
          ? 0
          : d.to === "away"
            ? 180
            : wrap180(state.rotation + (d.to === "left" ? 90 : -90));
      add(t + POSE_TIME, { ...state, rotation });
    } else {
      const motion = findMotion(d.motion);
      if (!motion) return { error: `Unknown move "${d.motion}"` };
      const { kind: _kind, motion: _id, ...opts } = d;
      // Body only: the face stays as it was set.
      const steps = planMotion(motion, state, opts).steps.map((s) => ({
        x: s.x,
        y: s.y,
        z: s.z,
        rotation: s.rotation,
        joints: keepFace(s.joints, face),
        at: s.at,
      }));
      if (motion.kind === "pose") {
        const [{ at: _at, ...pose }] = steps;
        add(t + (opts.seconds ?? POSE_TIME), pose);
      } else {
        // Blend into the move's first pose, then play it.
        const begin = same(state, steps[0]) ? t : t + BLEND;
        for (const { at, ...s } of steps) add(begin + at, s);
      }
    }
    t = roundTime(entries[entries.length - 1].t);
    markers.push({
      t: start,
      length: roundTime(t - start),
      text: b.text,
      ...(b.note ? { note: b.note } : {}),
    });
    if (t > LIMITS.duration[1])
      return {
        error: `"${b.text}" would end at ${Math.round(t * 10) / 10} s; animations are at most ${LIMITS.duration[1]} s`,
      };
  }
  return { entries, markers, end: t };
}

/** The script for a figure's beats, as written: one line each, with
 * its note. */
export function beatScript(
  beats: Array<{ text: string; note?: string }>,
): string {
  return beats
    .map((b) => (b.note ? `${b.text} — ${b.note}` : b.text))
    .join("\n");
}
