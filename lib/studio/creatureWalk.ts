/** A creature's baked walk cycle: the stride it travels per loop, the
 * planning options that make the studio's walk command play it, and the
 * clip phase for a creature at a time in the animation.
 *
 * The served GLBs (public/creatures/) each carry exactly one animation,
 * named "walk", 1.0 s per stride (24 frames @ 24 fps, frame 24 == frame
 * 0). The studio never poses a creature through the human joint system:
 * a creature walk is planned as keyframes for where the body goes, and
 * the engine plays the baked clip alongside (lib/engine/StudioEngine,
 * lib/engine/creatureWalkPlayer.ts). Pure; no React or Three.js. */

import type { Motion, MotionOptions } from "./motions";
import type { Figure, SceneDoc } from "./schema";

/** The baked clip's name in every served creature GLB. */
export const CREATURE_WALK_CLIP_NAME = "walk";
/** Seconds per stride: the clip is 24 frames @ 24 fps. */
export const CREATURE_WALK_CLIP_SECONDS = 1;

/** Metres the body advances per stride (one 1 s clip loop), per
 * creature. Derived, not tuned: stride = 4 × leg × sin(21°), where leg
 * is the hip height in scene metres (the leg is a pendulum swinging
 * ±21° — the clip's measured swing is ±20–22° — so one step carries the
 * body 2 × leg × sin(21°) and a full cycle has two steps). Hip heights
 * come from assets/creatures/rigged/<species>.joints.json (hip head
 * above ground, in raw mesh units) scaled by heightMeters / raw height
 * from public/creatures/creatures.json. At that stride the feet meet
 * the ground where the clip puts them; a shorter stride would slide the
 * feet backwards, a longer one forwards. Speeds follow: the lion
 * strolls at 0.49 m/s, the elephant at 1.55 m/s, the bird creeps at
 * 0.08 m/s (its legs are 5.5 cm long and the clip is fixed at 1 s per
 * stride — small animals step slowly here). */
export const CREATURE_STRIDES: Record<string, number> = {
  "creature-lion": 0.49,
  "creature-elephant": 1.55,
  "creature-hippo": 0.64,
  "creature-rhino": 0.82,
  "creature-tiger": 0.6,
  "creature-gorilla": 1.26,
  "creature-monkey": 0.34,
  "creature-rat": 0.11,
  "creature-bird": 0.08,
  "creature-cat": 0.21,
  "creature-dog-standing": 0.39,
  "creature-dog-side": 0.42,
};

/** A creature not in the table (a future addition) still walks, at a
 * lion-scale stride, rather than gliding. */
export function creatureStrideMeters(creatureId: string | undefined): number {
  return (creatureId ? CREATURE_STRIDES[creatureId] : undefined) ?? 0.5;
}

/** The only move a creature can do. Everything else in the motion
 * library is written for human joints a creature doesn't have. */
export function motionAllowedForCreature(motion: Motion): boolean {
  return motion.id === "walk";
}

export const creatureCantDo = (motion: Motion): string =>
  `A creature can't ${motion.name.toLowerCase()} — creatures can only walk.`;

/** Planning options for a walk by `figure`: a creature walks on its
 * baked clip's timing (1 s per stride, its own stride length, a neutral
 * pose — the clip, not human joints, moves its legs); a human walks as
 * before. */
export function creatureWalkOptions(
  figure: Figure,
  motion: Motion,
  opts: MotionOptions,
): MotionOptions {
  if (!figure.creature || motion.id !== "walk") return opts;
  return {
    ...opts,
    cycle: CREATURE_WALK_CLIP_SECONDS,
    travel: creatureStrideMeters(figure.creature),
    neutral: true,
  };
}

/** What the clip is doing at a time: its phase (0..1 of the loop) and
 * how far in it is blended (0 = the bind pose). */
export interface CreatureWalkState {
  phase: number;
  /** 0..1: eases in over the first steps and out after the last. */
  weight: number;
}

/** Seconds to blend in from standing and out to standing, so the legs
 * don't snap between the bind pose and the clip's first stride pose
 * (frame 0 of the clip is mid-stride, not rest). */
export const CREATURE_WALK_FADE_SECONDS = 0.3;
/** Keys closer than this in time, with no travel between them, are one
 * planned move on the spot (a walk "in place", or one that had no room
 * and stayed put). */
const DENSE_GAP_SECONDS = 0.35;
const DENSE_KEYS = 4;
const DENSE_SPAN_SECONDS = 0.75;
/** Metres between two keys: below this the figure is standing still. */
const MOVE_EPSILON = 0.005;

const mod1 = (n: number) => ((n % 1) + 1) % 1;

type KeyPoint = { t: number; x: number; z: number };

function keyPoints(scene: SceneDoc, figureId: string): KeyPoint[] {
  return scene.animation.keys
    .filter((k) => k.figures[figureId])
    .map((k) => ({
      t: k.t,
      x: k.figures[figureId]!.x,
      z: k.figures[figureId]!.z,
    }))
    .sort((a, b) => a.t - b.t);
}

const dist = (a: KeyPoint, b: KeyPoint) => Math.hypot(a.x - b.x, a.z - b.z);

/** The baked clip's state for a creature figure at time `t`, or null
 * when it is standing: the phase comes from how far the body has
 * travelled since the walk began, so scrubbing, pausing and recording
 * all show the legs where the body is. A walk is a run of keys the
 * figure travels along; a run that goes nowhere (walk in place, or no
 * room to walk) is a run of keys ~0.25 s apart, and its phase comes
 * from the clock instead. Anything else that moves a creature — a drag
 * across the floor, a key edited by hand — reads as a walk too, because
 * the body is travelling; that is the honest reading of the keys. */
export function creatureWalkPhase(
  scene: SceneDoc,
  figureId: string,
  t: number,
): CreatureWalkState | null {
  const figure = scene.figures.find((f) => f.id === figureId);
  if (!figure?.creature) return null;
  const stride = creatureStrideMeters(figure.creature);
  const keys = keyPoints(scene, figureId);
  if (keys.length < 2) return null;

  // The segment `t` is in, if any (past the last key the figure holds
  // its last pose: the walk is over).
  let i = -1;
  for (let k = 0; k < keys.length - 1; k++) {
    if (keys[k].t <= t && t < keys[k + 1].t) {
      i = k;
      break;
    }
  }
  const fadeOut = (endT: number): CreatureWalkState | null => {
    const dt = t - endT;
    if (dt < 0 || dt > CREATURE_WALK_FADE_SECONDS) return null;
    return { phase: 0, weight: 1 - dt / CREATURE_WALK_FADE_SECONDS };
  };

  if (i === -1) {
    // Past the last key: still settling after a walk that travelled.
    const last = keys[keys.length - 1];
    if (keys.length >= 2 && dist(keys[keys.length - 2], last) > MOVE_EPSILON)
      return fadeOut(last.t);
    return null;
  }

  if (dist(keys[i], keys[i + 1]) > MOVE_EPSILON) {
    // Travelling: the run is the maximal stretch of travelling keys
    // around this segment; the phase is the distance from its start.
    let start = i;
    while (start > 0 && dist(keys[start - 1], keys[start]) > MOVE_EPSILON)
      start--;
    let d = 0;
    for (let k = start; k < i; k++) d += dist(keys[k], keys[k + 1]);
    const seg = dist(keys[i], keys[i + 1]);
    d += seg * ((t - keys[i].t) / (keys[i + 1].t - keys[i].t));
    return {
      phase: mod1(d / stride),
      weight: Math.min(1, (t - keys[start].t) / CREATURE_WALK_FADE_SECONDS),
    };
  }

  // Standing in this segment. A walk on the spot is a dense run of
  // keys going nowhere; anything sparser is a hold, a turn, or the
  // settling after a walk.
  let start = i;
  while (
    start > 0 &&
    keys[start].t - keys[start - 1].t <= DENSE_GAP_SECONDS &&
    dist(keys[start - 1], keys[start]) <= MOVE_EPSILON
  )
    start--;
  let end = i + 1;
  while (
    end < keys.length - 1 &&
    keys[end + 1].t - keys[end].t <= DENSE_GAP_SECONDS &&
    dist(keys[end], keys[end + 1]) <= MOVE_EPSILON
  )
    end++;
  const count = end - start + 1;
  if (count >= DENSE_KEYS && keys[end].t - keys[start].t >= DENSE_SPAN_SECONDS)
    return {
      phase: mod1((t - keys[start].t) / CREATURE_WALK_CLIP_SECONDS),
      weight: Math.min(1, (t - keys[start].t) / CREATURE_WALK_FADE_SECONDS),
    };
  // Settling after a walk that ended on this key.
  if (i > 0 && dist(keys[i - 1], keys[i]) > MOVE_EPSILON)
    return fadeOut(keys[i].t);
  return null;
}
