/** Keyframe animation over the scene document. Pure; no React or
 * Three.js.
 *
 * A keyframe is a snapshot, at a time, of everything that moves: each
 * figure's place, turn and joint angles, each light's settings, and
 * (optionally) the camera. Between two keys values ease in and out;
 * angles that wrap (turn, light azimuth) take the short way round and
 * on/off switches at the key. Before the first key and after the last,
 * the nearest key holds.
 *
 * Figures, lights and their ids are structure, not animation: a key
 * only covers what existed when it was set, and anything a key doesn't
 * mention keeps its current value. */

import { flattenJoints, unflattenJoints, type PoseJoints } from "./pose";
import {
  LIMITS,
  type Animation,
  type CameraView,
  type Keyframe,
  type LightKey,
  type SceneDoc,
} from "./schema";

/** Two keys closer than this (seconds) are the same key. */
export const KEY_EPSILON = 0.005;

export const roundTime = (t: number) => Math.round(t * 100) / 100;

export function snapshot(
  scene: SceneDoc,
  t: number,
  camera?: CameraView,
): Keyframe {
  return {
    t: roundTime(t),
    figures: Object.fromEntries(
      scene.figures.map((f) => [
        f.id,
        {
          x: f.x,
          z: f.z,
          rotation: f.rotation,
          joints: structuredClone(f.pose.joints),
        },
      ]),
    ),
    lights: Object.fromEntries(
      scene.lights.map((l) => [
        l.id,
        {
          on: l.on,
          azimuth: l.azimuth,
          elevation: l.elevation,
          distance: l.distance,
          intensity: l.intensity,
          temperature: l.temperature,
          softness: l.softness,
          spotAngle: l.spotAngle,
          size: l.size,
        },
      ]),
    ),
    ...(camera
      ? {
          camera: {
            view: {
              position: [...camera.position],
              target: [...camera.target],
            },
            focalMm: scene.camera.focalMm,
          },
        }
      : {}),
  };
}

export function keyAt(anim: Animation, t: number): Keyframe | undefined {
  return anim.keys.find((k) => Math.abs(k.t - t) < KEY_EPSILON);
}

/** Insert `key`, replacing one at the same time. */
export function upsertKey(
  anim: Animation,
  key: Keyframe,
): { ok: true; animation: Animation } | { ok: false; error: string } {
  if (key.t > anim.duration)
    return { ok: false, error: "That time is past the end of the animation" };
  const others = anim.keys.filter((k) => Math.abs(k.t - key.t) >= KEY_EPSILON);
  if (others.length >= LIMITS.maxKeys)
    return { ok: false, error: `At most ${LIMITS.maxKeys} keyframes` };
  return {
    ok: true,
    animation: {
      ...anim,
      keys: [...others, key].sort((a, b) => a.t - b.t),
    },
  };
}

/** Ease in and out (smoothstep). */
const ease = (u: number) => u * u * (3 - 2 * u);
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
/** Degrees, the short way round. */
function lerpAngle(a: number, b: number, u: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * u;
}
/** Back into [-180, 180] (figure turn) or [0, 360) (light azimuth). */
const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
const wrap360 = (a: number) => ((a % 360) + 360) % 360;

/** The two keys around `t` that mention `pick`, and how far between. */
function bracket<T>(
  keys: Keyframe[],
  t: number,
  pick: (k: Keyframe) => T | undefined,
): { a: T; b: T; u: number } | null {
  let before: { k: Keyframe; v: T } | null = null;
  let after: { k: Keyframe; v: T } | null = null;
  for (const k of keys) {
    const v = pick(k);
    if (v === undefined) continue;
    if (k.t <= t) before = { k, v };
    else {
      after = { k, v };
      break;
    }
  }
  if (!before && !after) return null;
  if (!before) return { a: after!.v, b: after!.v, u: 0 };
  if (!after) return { a: before.v, b: before.v, u: 0 };
  return {
    a: before.v,
    b: after.v,
    u: ease((t - before.k.t) / (after.k.t - before.k.t)),
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** The scene as it is at time `t`, plus the camera view if any key has
 * one. Values are rounded like the UI's, so evaluating twice at the
 * same time gives an identical scene. With no keys, returns `scene`. */
export function evaluate(
  scene: SceneDoc,
  t: number,
): { scene: SceneDoc; view: CameraView | null } {
  const keys = scene.animation.keys;
  if (keys.length === 0) return { scene, view: null };
  const figures = scene.figures.map((f) => {
    const s = bracket(keys, t, (k) => k.figures[f.id]);
    if (!s) return f;
    const ja = flattenJoints(s.a.joints);
    const jb = flattenJoints(s.b.joints);
    const angles = ja.map((v, i) => r1(lerp(v, jb[i], s.u)));
    // Keep the preset name only while the pose is exactly that preset.
    const same = flattenJoints(f.pose.joints).every((v, i) => v === angles[i]);
    return {
      ...f,
      x: r2(lerp(s.a.x, s.b.x, s.u)),
      z: r2(lerp(s.a.z, s.b.z, s.u)),
      rotation: r1(wrap180(lerpAngle(s.a.rotation, s.b.rotation, s.u))),
      pose: {
        preset: same ? f.pose.preset : "custom",
        // Interpolated between two valid keys: within every limit.
        joints: unflattenJoints(angles) as PoseJoints,
      },
    };
  });
  const lights = scene.lights.map((l) => {
    const s = bracket<LightKey>(keys, t, (k) => k.lights[l.id]);
    if (!s) return l;
    const n = (key: Exclude<keyof LightKey, "on">) =>
      lerp(s.a[key], s.b[key], s.u);
    return {
      ...l,
      on: s.u < 1 ? s.a.on : s.b.on,
      azimuth: r1(wrap360(lerpAngle(s.a.azimuth, s.b.azimuth, s.u))),
      elevation: r1(n("elevation")),
      distance: r2(n("distance")),
      intensity: r2(n("intensity")),
      temperature: Math.round(n("temperature")),
      softness: r1(n("softness")),
      spotAngle: r1(n("spotAngle")),
      size: r2(n("size")),
    };
  });
  const cam = bracket(keys, t, (k) => k.camera);
  const view = cam && {
    position: cam.a.view.position.map((v, i) =>
      lerp(v, cam.b.view.position[i], cam.u),
    ) as CameraView["position"],
    target: cam.a.view.target.map((v, i) =>
      lerp(v, cam.b.view.target[i], cam.u),
    ) as CameraView["target"],
  };
  return {
    scene: {
      ...scene,
      figures,
      lights,
      camera: cam
        ? {
            ...scene.camera,
            focalMm: Math.round(lerp(cam.a.focalMm, cam.b.focalMm, cam.u)),
          }
        : scene.camera,
    },
    view,
  };
}

/** Drop a figure or light from every key (it was removed). */
export function forget(
  anim: Animation,
  what: { figure?: string; light?: string },
): Animation {
  if (anim.keys.length === 0) return anim;
  return {
    ...anim,
    keys: anim.keys.map((k) => {
      const figures = { ...k.figures };
      const lights = { ...k.lights };
      if (what.figure) delete figures[what.figure];
      if (what.light) delete lights[what.light];
      return { ...k, figures, lights };
    }),
  };
}
