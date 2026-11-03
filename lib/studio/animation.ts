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

import {
  JOINTS,
  JOINT_IDS,
  flattenJoints,
  unflattenJoints,
  type PoseJoints,
} from "./pose";
import { channelRange } from "./channels";
import {
  LIMITS,
  LIGHT_CHANNELS,
  type Animation,
  type CameraPlacement,
  type Channel,
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
  camera?: CameraPlacement,
): Keyframe {
  return {
    t: roundTime(t),
    figures: Object.fromEntries(
      scene.figures.map((f) => [
        f.id,
        {
          x: f.x,
          y: f.y,
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
  // Re-keying (auto-key does it on every edit) keeps the interpolation
  // and any graph-editor tangents.
  const old = keyAt(anim, key.t);
  if (old?.ease && !key.ease) key = { ...key, ease: old.ease };
  if (old?.tangents && !key.tangents) key = { ...key, tangents: old.tangents };
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

/** The keys around `t` that record `pick`, and how far between them
 * (0..1). Outside the keyed range one side is null: the value holds. */
interface Segment<T> {
  a: T;
  b: T;
  ka: Keyframe | null;
  kb: Keyframe | null;
  raw: number;
}

function bracket<T>(
  keys: Keyframe[],
  t: number,
  pick: (k: Keyframe) => T | undefined,
): Segment<T> | null {
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
  if (!before) return { a: after!.v, b: after!.v, ka: null, kb: null, raw: 0 };
  if (!after) return { a: before.v, b: before.v, ka: null, kb: null, raw: 0 };
  return {
    a: before.v,
    b: after.v,
    ka: before.k,
    kb: after.k,
    raw: (t - before.k.t) / (after.k.t - before.k.t),
  };
}

/** Degrees from `a` to `b` the short way round, in [-180, 180). */
const shortest = (a: number, b: number) =>
  ((((b - a) % 360) + 540) % 360) - 180;

/** One value along a segment: a cubic Hermite curve through the two
 * keys. With the default tangents it is exactly the key's ease (flat
 * slopes give smoothstep; the straight-line slope gives linear); graph
 * editor tangents bend it. `wrap` angles go the short way round. The
 * result is clamped to the channel's range, so an overshooting curve
 * never breaks a joint limit. */
function curve<T>(
  seg: Segment<T>,
  va: number,
  vb: number,
  ch: Channel,
  wrap = false,
): number {
  const { ka, kb, raw: u } = seg;
  if (!ka || !kb || ka.ease === "step") return va;
  if (wrap) vb = va + shortest(va, vb);
  const dt = kb.t - ka.t;
  const id = channelId(ch);
  const straight = (vb - va) / dt;
  const m0 = ka.tangents?.[id]?.out ?? (ka.ease === "linear" ? straight : 0);
  const m1 = kb.tangents?.[id]?.in ?? (ka.ease === "linear" ? straight : 0);
  const u2 = u * u;
  const u3 = u2 * u;
  const v =
    (2 * u3 - 3 * u2 + 1) * va +
    (u3 - 2 * u2 + u) * dt * m0 +
    (-2 * u3 + 3 * u2) * vb +
    (u3 - u2) * dt * m1;
  if (wrap) return v;
  const { min, max } = channelRange(ch);
  return Math.min(max, Math.max(min, v));
}

/** Back into [-180, 180] (figure turn) or [0, 360) (light azimuth). */
const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
const wrap360 = (a: number) => ((a % 360) + 360) % 360;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Joint channels in flattenJoints order. */
const JOINT_DOFS = JOINT_IDS.flatMap((joint) =>
  Object.keys(JOINTS[joint].dofs).map((dof) => ({ joint, dof })),
);

/** The scene as it is at time `t`, plus the camera view if any key has
 * one. Values are rounded like the UI's, so evaluating twice at the
 * same time gives an identical scene. With no keys, returns `scene`. */
export function evaluate(
  scene: SceneDoc,
  t: number,
): { scene: SceneDoc; view: CameraPlacement | null } {
  const keys = scene.animation.keys;
  if (keys.length === 0) return { scene, view: null };
  const figures = scene.figures.map((f) => {
    const s = bracket(keys, t, (k) => k.figures[f.id]);
    if (!s) return f;
    const ja = flattenJoints(s.a.joints);
    const jb = flattenJoints(s.b.joints);
    const angles = JOINT_DOFS.map(({ joint, dof }, i) =>
      r1(curve(s, ja[i], jb[i], { kind: "joint", figure: f.id, joint, dof })),
    );
    const place = (field: "x" | "y" | "z" | "rotation") =>
      curve(
        s,
        s.a[field],
        s.b[field],
        { kind: "figure", figure: f.id, field },
        field === "rotation",
      );
    // Keep the preset name only while the pose is exactly that preset.
    const same = flattenJoints(f.pose.joints).every((v, i) => v === angles[i]);
    return {
      ...f,
      x: r2(place("x")),
      y: r2(place("y")),
      z: r2(place("z")),
      rotation: r1(wrap180(place("rotation"))),
      pose: {
        preset: same ? f.pose.preset : "custom",
        // Clamped to every joint's limits by curve().
        joints: unflattenJoints(angles) as PoseJoints,
      },
    };
  });
  const lights = scene.lights.map((l) => {
    const s = bracket<LightKey>(keys, t, (k) => k.lights[l.id]);
    if (!s) return l;
    const n = (field: (typeof LIGHT_CHANNELS)[number]) =>
      curve(
        s,
        s.a[field],
        s.b[field],
        { kind: "light", light: l.id, field },
        field === "azimuth",
      );
    return {
      ...l,
      // Switches change at the next key.
      on: s.kb && s.raw >= 1 ? s.b.on : s.a.on,
      azimuth: r1(wrap360(n("azimuth"))),
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
  // The camera path follows the focal-length channel's timing shape.
  const along = (va: number, vb: number) => {
    if (!cam || !cam.ka || !cam.kb || cam.ka.ease === "step") return va;
    const u =
      cam.ka.ease === "linear"
        ? cam.raw
        : cam.raw * cam.raw * (3 - 2 * cam.raw);
    return va + (vb - va) * u;
  };
  const view = cam && {
    position: cam.a.view.position.map((v, i) =>
      along(v, cam.b.view.position[i]),
    ) as CameraPlacement["position"],
    target: cam.a.view.target.map((v, i) =>
      along(v, cam.b.view.target[i]),
    ) as CameraPlacement["target"],
  };
  return {
    scene: {
      ...scene,
      figures,
      lights,
      camera: cam
        ? {
            ...scene.camera,
            focalMm: Math.round(
              curve(cam, cam.a.focalMm, cam.b.focalMm, {
                kind: "camera",
                field: "focalMm",
              }),
            ),
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

// ------------------------------------------------------------- channels

/** A channel's value in a scene, or undefined if it doesn't exist. */
export function channelValue(scene: SceneDoc, ch: Channel): number | undefined {
  switch (ch.kind) {
    case "figure":
      return scene.figures.find((f) => f.id === ch.figure)?.[ch.field];
    case "joint": {
      const f = scene.figures.find((x) => x.id === ch.figure);
      const j = (f?.pose.joints as Record<string, Record<string, number>>)?.[
        ch.joint
      ];
      return j?.[ch.dof];
    }
    case "light":
      return scene.lights.find((l) => l.id === ch.light)?.[ch.field];
    case "camera":
      return scene.camera.focalMm;
  }
}

/** A channel's value stored in a key, or undefined if the key doesn't
 * record it. */
export function keyValue(key: Keyframe, ch: Channel): number | undefined {
  switch (ch.kind) {
    case "figure":
      return key.figures[ch.figure]?.[ch.field];
    case "joint":
      return (
        key.figures[ch.figure]?.joints as
          Record<string, Record<string, number>> | undefined
      )?.[ch.joint]?.[ch.dof];
    case "light":
      return key.lights[ch.light]?.[ch.field];
    case "camera":
      return key.camera?.focalMm;
  }
}

/** A copy of `key` with one channel set; null if the key doesn't record
 * that channel. Range checks happen when the scene is validated. */
export function withKeyValue(
  key: Keyframe,
  ch: Channel,
  value: number,
): Keyframe | null {
  if (keyValue(key, ch) === undefined) return null;
  const k = structuredClone(key);
  switch (ch.kind) {
    case "figure":
      k.figures[ch.figure][ch.field] = value;
      break;
    case "joint":
      (k.figures[ch.figure].joints as Record<string, Record<string, number>>)[
        ch.joint
      ][ch.dof] = value;
      break;
    case "light":
      k.lights[ch.light][ch.field] = value;
      break;
    case "camera":
      k.camera!.focalMm = value;
      break;
  }
  return k;
}

/** Stable id for a channel (selection, React keys, colours). */
export function channelId(ch: Channel): string {
  switch (ch.kind) {
    case "figure":
      return `${ch.figure}.${ch.field}`;
    case "joint":
      return `${ch.figure}.${ch.joint}.${ch.dof}`;
    case "light":
      return `light.${ch.light}.${ch.field}`;
    case "camera":
      return "camera.focalMm";
  }
}
