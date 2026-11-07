/** Scene actions: the only way the scene document changes.
 *
 * Every action is a plain JSON object validated by `SceneActionSchema`,
 * applied by the pure `applyAction` reducer, and labelled by
 * `describeAction` for the history panel. The same schema is what a
 * future AI assistant must emit; anything that fails it is rejected
 * before it can touch the scene.
 */

import { z } from "zod";
import { PRESETS } from "@/lib/lighting";
import {
  BackdropSchema,
  CameraPatchSchema,
  LIMITS,
  LightKindSchema,
  LightPatchSchema,
  MaterialSchema,
  ModelSchema,
  SceneSchema,
  AnimationSchema,
  CameraPlacementSchema,
  ChannelSchema,
  EaseSchema,
  CharacterIdSchema,
  FigureIdSchema,
  FigureSchema,
  type Figure,
  type Keyframe,
  ShadowSchema,
  SpeechSchema,
  type SceneDoc,
  type StudioLight,
} from "./schema";
import {
  BACKDROP_PRESETS,
  KIND_LABELS,
  MATERIAL_PRESETS,
  backdropFromPreset,
  defaultScene,
  materialFromPreset,
  newLight,
  presetLights,
} from "./presets";

import {
  JOINTS,
  JOINT_IDS,
  JointPatchSchema,
  POSE_GROUPS,
  isFaceJoint,
  keepFace,
  mirrorJoints,
  posePreset,
  type JointId,
} from "./pose";
import {
  KEY_EPSILON,
  channelId,
  forget,
  keyAt,
  roundTime,
  snapshot,
  keyValue,
  upsertKey,
  withKeyValue,
} from "./animation";
import { findMotion, motionSteps, type MotionStep } from "./motions";
import { speechEnd } from "./speech";
import { MAX_BEATS, TURN_TARGETS, planBeats, type FigureState } from "./beats";
import {
  figureLabel,
  findFigure,
  freeSpot,
  newFigure,
  nextFigureId,
} from "./figures";

const lightId = z.string().min(1).max(24);
const slopeValue = z.number().finite().min(-1e5).max(1e5);
const keyTime = z.number().finite().min(0).max(LIMITS.duration[1]);
/** Which figure a pose/model action targets; omitted = the first one. */
const figureRef = FigureIdSchema.optional();

/** How a library move is done (lib/studio/motions.ts MotionOptions). */
const MotionOptionFields = {
  mirror: z.boolean().optional(),
  repeat: z.number().int().min(1).max(100).optional(),
  slow: z.number().finite().min(0.25).max(4).optional(),
  inPlace: z.boolean().optional(),
  backwards: z.boolean().optional(),
  /** How long the move lasts (it repeats to fill it). */
  seconds: z.number().finite().min(0.2).max(LIMITS.duration[1]).optional(),
};

/** One direction beat (lib/studio/beats.ts). */
const BeatSpecSchema = z
  .object({
    text: z.string().trim().min(1).max(80),
    note: z.string().trim().min(1).max(120).optional(),
    /** Lip sync from the beat's start (a "say" beat lasts as long). */
    speech: SpeechSchema.pick({ name: true, sound: true, mouth: true })
      .strict()
      .optional(),
    do: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("motion"),
          motion: z.string().max(32),
          ...MotionOptionFields,
        })
        .strict(),
      z
        .object({
          kind: z.literal("hold"),
          seconds: z.number().finite().min(0.2).max(30),
        })
        .strict(),
      z.object({ kind: z.literal("turn"), to: z.enum(TURN_TARGETS) }).strict(),
      z.object({ kind: z.literal("say") }).strict(),
    ]),
  })
  .strict();

const FigurePatchSchema = FigureSchema.pick({
  x: true,
  y: true,
  z: true,
  rotation: true,
})
  .partial()
  .strict();

export const SceneActionSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("applyPreset"), presetId: z.string().max(32) })
    .strict(),
  z
    .object({
      type: z.literal("updateLight"),
      id: lightId,
      patch: LightPatchSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("addLight"),
      kind: LightKindSchema,
      patch: LightPatchSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal("removeLight"), id: lightId }).strict(),
  z.object({ type: z.literal("duplicateLight"), id: lightId }).strict(),
  z
    .object({
      type: z.literal("setModel"),
      model: ModelSchema,
      figure: figureRef,
    })
    .strict(),
  z
    .object({
      type: z.literal("setCharacter"),
      figure: figureRef,
      /** null: back to the mannequin. */
      character: CharacterIdSchema.nullable(),
      /** The character's name, for history labels only. */
      name: z.string().max(80).optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("addFigure"), model: ModelSchema.optional() })
    .strict(),
  z
    .object({ type: z.literal("duplicateFigure"), figure: FigureIdSchema })
    .strict(),
  z
    .object({ type: z.literal("removeFigure"), figure: FigureIdSchema })
    .strict(),
  z
    .object({
      type: z.literal("updateFigure"),
      figure: FigureIdSchema,
      patch: FigurePatchSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("updateCamera"),
      patch: CameraPatchSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("applyMaterialPreset"),
      presetId: z.string().max(32),
    })
    .strict(),
  z
    .object({
      type: z.literal("updateMaterial"),
      patch: MaterialSchema.omit({ preset: true }).partial().strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("applyBackdropPreset"),
      presetId: z.string().max(32),
    })
    .strict(),
  z
    .object({
      type: z.literal("updateBackdrop"),
      patch: BackdropSchema.omit({ preset: true }).partial().strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("updateShadows"),
      patch: ShadowSchema.partial().strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("loadScene"),
      scene: SceneSchema,
      label: z.string().max(48).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("applyPosePreset"),
      presetId: z.string().max(32),
      figure: figureRef,
    })
    .strict(),
  z
    .object({
      type: z.literal("updateJoint"),
      joint: z.enum(JOINT_IDS as [JointId, ...JointId[]]),
      patch: JointPatchSchema,
      figure: figureRef,
    })
    .strict(),
  z
    .object({
      // Several joints at once, e.g. a hand dragged in the viewport moves
      // the shoulder and elbow together as one undo step.
      type: z.literal("updateJoints"),
      patches: z.partialRecord(
        z.enum(JOINT_IDS as [JointId, ...JointId[]]),
        JointPatchSchema,
      ),
      figure: figureRef,
    })
    .strict(),
  z.object({ type: z.literal("mirrorPose"), figure: figureRef }).strict(),
  z
    .object({
      // A pose or move from the motion library (lib/studio/motions.ts).
      // A move becomes keyframes on this figure from time `t`.
      type: z.literal("applyMotion"),
      motion: z.string().max(32),
      figure: figureRef,
      t: keyTime.optional(),
      ...MotionOptionFields,
    })
    .strict(),
  z
    .object({
      // Direction beats: played one after another by this figure from
      // time `t`, as keys, in one undo step; kept as timeline markers.
      type: z.literal("directBeats"),
      figure: FigureIdSchema,
      t: keyTime,
      beats: z.array(BeatSpecSchema).min(1).max(MAX_BEATS),
    })
    .strict(),
  z.object({ type: z.literal("clearBeats"), figure: FigureIdSchema }).strict(),
  z
    .object({
      // Drag a beat's marker: it and everything after it on this figure
      // (keys, beats, beat sounds) move to start at `to`. `index` counts
      // this figure's beats in time order (retiming never reorders them).
      type: z.literal("moveBeat"),
      figure: FigureIdSchema,
      index: z
        .number()
        .int()
        .min(0)
        .max(LIMITS.maxBeats - 1),
      to: keyTime,
    })
    .strict(),
  z
    .object({
      // Record what moves, at time `t`; replaces a key already there.
      type: z.literal("setKey"),
      t: keyTime,
      camera: CameraPlacementSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal("deleteKey"), t: keyTime }).strict(),
  z.object({ type: z.literal("moveKey"), from: keyTime, to: keyTime }).strict(),
  z
    .object({
      type: z.literal("setDuration"),
      duration: AnimationSchema.shape.duration,
    })
    .strict(),
  z.object({ type: z.literal("clearKeys") }).strict(),
  z
    .object({
      // Graph editor: one value inside one key.
      type: z.literal("setKeyValue"),
      t: keyTime,
      channel: ChannelSchema,
      value: z.number().finite(),
    })
    .strict(),
  z
    .object({ type: z.literal("setKeyEase"), t: keyTime, ease: EaseSchema })
    .strict(),
  z
    .object({
      // Graph editor tangent handle: the curve's slope through this key
      // for one channel (value units per second); null resets it.
      type: z.literal("setKeyTangent"),
      t: keyTime,
      channel: ChannelSchema,
      slope: z.number().finite().min(-1e5).max(1e5).nullable(),
      /** A broken tangent's one side; unified tangents move together. */
      side: z.enum(["in", "out"]).optional(),
    })
    .strict(),
  z
    .object({
      // Several curves' tangents at one key in one undo step (Flat,
      // Reset, Break, Unify on the curves shown). null = from the ease.
      type: z.literal("setKeyTangents"),
      t: keyTime,
      changes: z
        .array(
          z
            .object({
              channel: ChannelSchema,
              tangent: z
                .object({
                  in: slopeValue,
                  out: slopeValue,
                  broken: z.literal(true).optional(),
                })
                .strict()
                .nullable(),
            })
            .strict(),
        )
        .min(1)
        .max(400),
    })
    .strict(),
  z
    .object({
      // Lip sync from a sound (lib/studio/speech.ts), in one undo step.
      type: z.literal("addSpeech"),
      speech: SpeechSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("removeSpeech"),
      index: z
        .number()
        .int()
        .min(0)
        .max(LIMITS.maxSpeech - 1),
    })
    .strict(),
  z.object({ type: z.literal("reset") }).strict(),
]);
export type SceneAction = z.infer<typeof SceneActionSchema>;

export type ActionResult =
  { ok: true; scene: SceneDoc } | { ok: false; error: string };

function nextLightId(lights: StudioLight[]): string {
  const used = new Set(lights.map((l) => l.id));
  for (let n = lights.length + 1; ; n++) {
    if (!used.has(`light-${n}`)) return `light-${n}`;
  }
}

function findLight(scene: SceneDoc, id: string): StudioLight | undefined {
  return scene.lights.find((l) => l.id === id);
}

/** Validate an unknown value as an action, then apply it. Never throws. */
export function tryApplyAction(scene: SceneDoc, input: unknown): ActionResult {
  const parsed = SceneActionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid action",
    };
  }
  return applyAction(scene, parsed.data);
}

/** Pure reducer. Returns the same object when the action is a no-op,
 * and an error (never a partially-applied scene) when it can't apply. */
export function applyAction(
  scene: SceneDoc,
  action: SceneAction,
): ActionResult {
  const ok = (next: SceneDoc): ActionResult => {
    const checked = SceneSchema.safeParse(next);
    return checked.success
      ? { ok: true, scene: checked.data }
      : {
          ok: false,
          error: checked.error.issues[0]?.message ?? "Invalid scene",
        };
  };

  switch (action.type) {
    case "applyPreset": {
      const lights = presetLights(action.presetId);
      if (!lights)
        return { ok: false, error: `Unknown preset "${action.presetId}"` };
      return ok({ ...scene, preset: action.presetId, lights });
    }
    case "updateLight": {
      if (!findLight(scene, action.id))
        return { ok: false, error: `No light "${action.id}"` };
      return ok({
        ...scene,
        preset: "custom",
        lights: scene.lights.map((l) =>
          l.id === action.id ? { ...l, ...action.patch } : l,
        ),
      });
    }
    case "addLight": {
      if (scene.lights.length >= LIMITS.maxLights) {
        return { ok: false, error: `At most ${LIMITS.maxLights} lights` };
      }
      const id = nextLightId(scene.lights);
      const label = `${KIND_LABELS[action.kind]} ${id.slice(6)}`;
      const light = { ...newLight(id, label, action.kind), ...action.patch };
      return ok({
        ...scene,
        preset: "custom",
        lights: [...scene.lights, light],
      });
    }
    case "removeLight": {
      if (!findLight(scene, action.id))
        return { ok: false, error: `No light "${action.id}"` };
      if (scene.lights.length <= 1)
        return { ok: false, error: "A scene needs at least one light" };
      return ok({
        ...scene,
        preset: "custom",
        lights: scene.lights.filter((l) => l.id !== action.id),
        animation: forget(scene.animation, { light: action.id }),
      });
    }
    case "duplicateLight": {
      const src = findLight(scene, action.id);
      if (!src) return { ok: false, error: `No light "${action.id}"` };
      if (scene.lights.length >= LIMITS.maxLights) {
        return { ok: false, error: `At most ${LIMITS.maxLights} lights` };
      }
      const id = nextLightId(scene.lights);
      const copy = {
        ...src,
        id,
        label: `${src.label} copy`.slice(0, 32),
        azimuth: (src.azimuth + 30) % 360,
      };
      return ok({
        ...scene,
        preset: "custom",
        lights: [...scene.lights, copy],
      });
    }
    case "setModel":
      return withFigure(scene, action.figure, ok, (f) =>
        f.model === action.model ? f : { ...f, model: action.model },
      );
    case "setCharacter":
      return withFigure(scene, action.figure, ok, (f) => {
        if ((f.character ?? null) === action.character) return f;
        const { character: _old, ...rest } = f;
        return action.character
          ? { ...rest, character: action.character }
          : rest;
      });
    case "addFigure": {
      if (scene.figures.length >= LIMITS.maxFigures)
        return { ok: false, error: `At most ${LIMITS.maxFigures} figures` };
      const figure = newFigure(
        nextFigureId(scene.figures),
        action.model ?? "male",
        freeSpot(scene.figures),
      );
      return ok({ ...scene, figures: [...scene.figures, figure] });
    }
    case "duplicateFigure": {
      const src = findFigure(scene, action.figure);
      if (!src) return { ok: false, error: `No figure "${action.figure}"` };
      if (scene.figures.length >= LIMITS.maxFigures)
        return { ok: false, error: `At most ${LIMITS.maxFigures} figures` };
      const copy = {
        ...structuredClone(src),
        id: nextFigureId(scene.figures),
        ...freeSpot(scene.figures),
      };
      return ok({ ...scene, figures: [...scene.figures, copy] });
    }
    case "removeFigure": {
      if (!findFigure(scene, action.figure))
        return { ok: false, error: `No figure "${action.figure}"` };
      if (scene.figures.length <= 1)
        return { ok: false, error: "A scene needs at least one figure" };
      return ok({
        ...scene,
        figures: scene.figures.filter((f) => f.id !== action.figure),
        animation: forget(scene.animation, { figure: action.figure }),
        speech: scene.speech.filter((sp) => sp.figure !== action.figure),
        beats: scene.beats.filter((b) => b.figure !== action.figure),
      });
    }
    case "updateFigure":
      return withFigure(scene, action.figure, ok, (f) => ({
        ...f,
        ...action.patch,
      }));
    case "updateCamera":
      return ok({ ...scene, camera: { ...scene.camera, ...action.patch } });
    case "applyMaterialPreset": {
      const material = materialFromPreset(action.presetId);
      if (!material)
        return { ok: false, error: `Unknown material "${action.presetId}"` };
      return ok({ ...scene, material });
    }
    case "updateMaterial":
      return ok({
        ...scene,
        material: { ...scene.material, ...action.patch, preset: "custom" },
      });
    case "applyBackdropPreset": {
      const backdrop = backdropFromPreset(action.presetId);
      if (!backdrop)
        return { ok: false, error: `Unknown backdrop "${action.presetId}"` };
      return ok({ ...scene, backdrop });
    }
    case "updateBackdrop":
      return ok({
        ...scene,
        backdrop: { ...scene.backdrop, ...action.patch, preset: "custom" },
      });
    case "updateShadows":
      return ok({ ...scene, shadows: { ...scene.shadows, ...action.patch } });
    case "loadScene":
      return ok(action.scene);
    case "applyPosePreset": {
      const preset = posePreset(action.presetId);
      if (!preset)
        return { ok: false, error: `Unknown pose "${action.presetId}"` };
      return withFigure(scene, action.figure, ok, (f) => ({
        ...f,
        // A body pose; the face stays as it is.
        pose: {
          preset: preset.id,
          joints: keepFace(structuredClone(preset.joints), f.pose.joints),
        },
      }));
    }
    case "updateJoint":
      return patchJoints(
        scene,
        action.figure,
        { [action.joint]: action.patch },
        ok,
      );
    case "updateJoints":
      return patchJoints(scene, action.figure, action.patches, ok);
    case "mirrorPose":
      return withFigure(scene, action.figure, ok, (f) => ({
        ...f,
        pose: { preset: "custom", joints: mirrorJoints(f.pose.joints) },
      }));
    case "applyMotion":
      return applyMotion(scene, action, ok);
    case "directBeats":
      return directBeats(scene, action, ok);
    case "moveBeat":
      return moveBeat(scene, action, ok);
    case "clearBeats":
      return ok({
        ...scene,
        beats: scene.beats.filter((b) => b.figure !== action.figure),
      });
    case "setKey": {
      const r = upsertKey(
        scene.animation,
        snapshot(scene, action.t, action.camera),
      );
      return r.ok ? ok({ ...scene, animation: r.animation }) : r;
    }
    case "deleteKey": {
      const keys = scene.animation.keys;
      const kept = keys.filter((k) => Math.abs(k.t - action.t) >= KEY_EPSILON);
      if (kept.length === keys.length)
        return { ok: false, error: `No keyframe at ${secs(action.t)}` };
      return ok({ ...scene, animation: { ...scene.animation, keys: kept } });
    }
    case "moveKey": {
      const key = keyAt(scene.animation, action.from);
      if (!key)
        return { ok: false, error: `No keyframe at ${secs(action.from)}` };
      const to = roundTime(action.to);
      if (Math.abs(to - key.t) < KEY_EPSILON) return { ok: true, scene };
      if (keyAt(scene.animation, to))
        return {
          ok: false,
          error: `There is already a keyframe at ${secs(to)}`,
        };
      const rest = {
        ...scene.animation,
        keys: scene.animation.keys.filter((k) => k !== key),
      };
      const r = upsertKey(rest, { ...key, t: to });
      return r.ok ? ok({ ...scene, animation: r.animation }) : r;
    }
    case "setDuration": {
      const last = scene.animation.keys.at(-1);
      if (last && last.t > action.duration)
        return {
          ok: false,
          error: `A keyframe is at ${secs(last.t)}; move or delete it first`,
        };
      return ok({
        ...scene,
        animation: { ...scene.animation, duration: action.duration },
      });
    }
    case "clearKeys":
      return ok({ ...scene, animation: { ...scene.animation, keys: [] } });
    case "addSpeech": {
      const sp = action.speech;
      if (!findFigure(scene, sp.figure))
        return { ok: false, error: `No figure "${sp.figure}"` };
      if (scene.speech.length >= LIMITS.maxSpeech)
        return {
          ok: false,
          error: `At most ${LIMITS.maxSpeech} lip-sync tracks; remove one first`,
        };
      const end = speechEnd(sp);
      if (end > LIMITS.duration[1] + 0.05)
        return {
          ok: false,
          error: `That would run to ${Math.round(end * 10) / 10} s; animations are at most ${LIMITS.duration[1]} s`,
        };
      // The animation grows to hold all of it.
      const duration = Math.min(
        LIMITS.duration[1],
        Math.max(scene.animation.duration, Math.ceil(end - 0.01)),
      );
      return ok({
        ...scene,
        animation: { ...scene.animation, duration },
        speech: [...scene.speech, sp],
      });
    }
    case "removeSpeech":
      if (!scene.speech[action.index])
        return { ok: false, error: "No such lip-sync track" };
      return ok({
        ...scene,
        speech: scene.speech.filter((_, i) => i !== action.index),
      });
    case "setKeyTangent":
    case "setKeyTangents": {
      const key = keyAt(scene.animation, action.t);
      if (!key) return { ok: false, error: `No keyframe at ${secs(action.t)}` };
      const changes =
        action.type === "setKeyTangents"
          ? action.changes
          : [
              {
                channel: action.channel,
                slope: action.slope,
                side: action.side,
              },
            ];
      const tangents = { ...key.tangents };
      for (const c of changes) {
        if (keyValue(key, c.channel) === undefined)
          return { ok: false, error: "That keyframe doesn't record it" };
        const id = channelId(c.channel);
        if ("tangent" in c) {
          if (c.tangent === null) delete tangents[id];
          else tangents[id] = { ...c.tangent };
          continue;
        }
        const old = tangents[id];
        if (c.slope === null) delete tangents[id];
        else if (old?.broken && c.side)
          // Broken: only the dragged side moves.
          tangents[id] = { ...old, [c.side]: c.slope };
        // Unified tangent, as Maya's default: the curve passes smoothly.
        else tangents[id] = { in: c.slope, out: c.slope };
      }
      const next = {
        ...key,
        tangents: Object.keys(tangents).length ? tangents : undefined,
      };
      if (!next.tangents) delete next.tangents;
      return ok({
        ...scene,
        animation: {
          ...scene.animation,
          keys: scene.animation.keys.map((k) => (k === key ? next : k)),
        },
      });
    }
    case "setKeyValue":
    case "setKeyEase": {
      const key = keyAt(scene.animation, action.t);
      if (!key) return { ok: false, error: `No keyframe at ${secs(action.t)}` };
      const next =
        action.type === "setKeyEase"
          ? { ...key, ease: action.ease }
          : withKeyValue(key, action.channel, action.value);
      if (!next) return { ok: false, error: "That keyframe doesn't record it" };
      return ok({
        ...scene,
        animation: {
          ...scene.animation,
          keys: scene.animation.keys.map((k) => (k === key ? next : k)),
        },
      });
    }
    case "reset":
      return ok(defaultScene());
  }
}

const secs = (t: number) => `${t.toFixed(2)} s`;

function applyMotion(
  scene: SceneDoc,
  action: Extract<SceneAction, { type: "applyMotion" }>,
  ok: (next: SceneDoc) => ActionResult,
): ActionResult {
  const motion = findMotion(action.motion);
  if (!motion) return { ok: false, error: `Unknown motion "${action.motion}"` };
  const figure = findFigure(scene, action.figure);
  if (!figure) return { ok: false, error: `No figure "${action.figure}"` };
  // Moves are body only: every step keeps the figure's face.
  const steps = motionSteps(motion, figure, action).map((s) => ({
    ...s,
    joints: keepFace(s.joints, figure.pose.joints),
  }));
  const at = (s: MotionStep): Figure => ({
    ...figure,
    x: s.x,
    y: s.y,
    z: s.z,
    rotation: s.rotation,
    pose: { preset: "custom", joints: s.joints },
  });
  const figures = scene.figures.map((f) => (f === figure ? at(steps[0]) : f));
  if (motion.kind === "pose") return ok({ ...scene, figures });

  const t0 = roundTime(action.t ?? 0);
  const end = roundTime(t0 + steps[steps.length - 1].at);
  if (end > LIMITS.duration[1])
    return {
      ok: false,
      error: `${motion.name} would end at ${secs(end)}; animations are at most ${LIMITS.duration[1]} s`,
    };
  const entries = steps.map((s) => ({
    t: roundTime(t0 + s.at),
    entry: {
      x: s.x,
      y: s.y,
      z: s.z,
      rotation: s.rotation,
      joints: s.joints,
    },
  }));
  return withFigureKeys(scene, figure.id, t0, end, entries, figures, ok);
}

/** Direction beats as keys and markers (lib/studio/beats.ts). */
function directBeats(
  scene: SceneDoc,
  action: Extract<SceneAction, { type: "directBeats" }>,
  ok: (next: SceneDoc) => ActionResult,
): ActionResult {
  const figure = findFigure(scene, action.figure);
  if (!figure) return { ok: false, error: `No figure "${action.figure}"` };
  const plan = planBeats(figure, action.t, action.beats);
  if ("error" in plan) return { ok: false, ...plan };
  const t0 = plan.entries[0].t;
  // Beats directed again over the same span replace the old ones.
  const kept = scene.beats.filter(
    (b) =>
      b.figure !== figure.id ||
      b.t + b.length <= t0 + KEY_EPSILON ||
      b.t >= plan.end - KEY_EPSILON,
  );
  const beats = [
    ...kept,
    ...plan.markers.map((m) => ({ figure: figure.id, ...m })),
  ].sort((a, b) => a.t - b.t);
  if (beats.length > LIMITS.maxBeats)
    return {
      ok: false,
      error: `That would make ${beats.length} beats; at most ${LIMITS.maxBeats}`,
    };
  // Their sounds are lip sync from each beat's start; lip sync made by
  // beats over the same span is replaced.
  const speech = [
    ...scene.speech.filter(
      (sp) =>
        !sp.beat ||
        sp.figure !== figure.id ||
        sp.start < t0 - KEY_EPSILON ||
        sp.start >= plan.end - KEY_EPSILON,
    ),
    ...action.beats.flatMap((b, i) =>
      b.speech
        ? [
            {
              figure: figure.id,
              start: plan.markers[i].t,
              ...b.speech,
              beat: true as const,
            },
          ]
        : [],
    ),
  ];
  if (speech.length > LIMITS.maxSpeech)
    return {
      ok: false,
      error: `That would make ${speech.length} lip-sync tracks; at most ${LIMITS.maxSpeech}`,
    };
  const heard = Math.max(plan.end, ...speech.map(speechEnd));
  if (heard > LIMITS.duration[1] + 0.05)
    return {
      ok: false,
      error: `A sound would run to ${Math.round(heard * 10) / 10} s; animations are at most ${LIMITS.duration[1]} s`,
    };
  const r = withFigureKeys(
    scene,
    figure.id,
    t0,
    plan.end,
    plan.entries,
    scene.figures,
    (next) => ({ ok: true, scene: next }),
  );
  if (!r.ok) return r;
  const duration = Math.min(
    LIMITS.duration[1],
    Math.max(r.scene.animation.duration, Math.ceil(heard - 0.01)),
  );
  return ok({
    ...r.scene,
    animation: { ...r.scene.animation, duration },
    beats,
    speech,
  });
}

/** Retime a beat: it and everything after it on its figure (that
 * figure's keys, its beats, its beats' sounds) start at `to`, never
 * before the beat ahead of it ends. Moved later, the figure holds still
 * in the gap. */
function moveBeat(
  scene: SceneDoc,
  action: Extract<SceneAction, { type: "moveBeat" }>,
  ok: (next: SceneDoc) => ActionResult,
): ActionResult {
  const id = action.figure;
  const mine = scene.beats.filter((b) => b.figure === id);
  const i = action.index;
  if (!mine[i]) return { ok: false, error: "No such beat" };
  const from = mine[i].t;
  const prev = mine[i - 1];
  const floor = prev ? prev.t + prev.length : 0;
  const last = Math.max(...mine.slice(i).map((b) => b.t + b.length));
  const to = roundTime(
    Math.min(Math.max(action.to, floor), LIMITS.duration[1] - (last - from)),
  );
  const shift = roundTime(to - from);
  if (Math.abs(shift) < KEY_EPSILON) return { ok: true, scene };
  // Touching the beat ahead, the key at the start is where that beat
  // ends: it stays, and a copy holds the figure until the new start.
  // After a gap, that key is this beat's own and moves with it.
  const touching = !!prev && Math.abs(floor - from) < KEY_EPSILON;
  const moves = (t: number) =>
    touching ? t > from + KEY_EPSILON : t > from - KEY_EPSILON;
  const held = scene.animation.keys.find(
    (k) => Math.abs(k.t - from) < KEY_EPSILON,
  )?.figures[id];
  const own = (ch: string) => ch.startsWith(`${id}.`);
  const moved: Array<{
    t: number;
    entry: FigureState;
    ease?: Keyframe["ease"];
    tangents?: Keyframe["tangents"];
  }> = [];
  let keys: Keyframe[] = scene.animation.keys
    .map((k) => {
      const entry = k.figures[id];
      if (!entry || !moves(k.t)) return k;
      const all = Object.entries(k.tangents ?? {});
      const mineT = all.filter(([ch]) => own(ch));
      const rest = all.filter(([ch]) => !own(ch));
      moved.push({
        t: roundTime(k.t + shift),
        entry,
        ease: k.ease,
        ...(mineT.length ? { tangents: Object.fromEntries(mineT) } : {}),
      });
      const figures = { ...k.figures };
      delete figures[id];
      const { tangents: _old, ...key } = k;
      return {
        ...key,
        figures,
        ...(rest.length ? { tangents: Object.fromEntries(rest) } : {}),
      };
    })
    .filter(
      (k) =>
        Object.keys(k.figures).length > 0 ||
        Object.keys(k.lights).length > 0 ||
        !!k.camera,
    );
  if (touching && held) moved.push({ t: to, entry: held });
  for (const m of moved) {
    const at = keys.find((k) => Math.abs(k.t - m.t) < KEY_EPSILON);
    keys = at
      ? keys.map((k) =>
          k === at
            ? {
                ...k,
                figures: { ...k.figures, [id]: m.entry },
                ...(m.tangents
                  ? { tangents: { ...k.tangents, ...m.tangents } }
                  : {}),
              }
            : k,
        )
      : [
          ...keys,
          {
            t: m.t,
            ease: m.ease ?? "spline",
            ...(m.tangents ? { tangents: m.tangents } : {}),
            figures: { [id]: m.entry },
            lights: {},
          },
        ];
  }
  keys.sort((a, b) => a.t - b.t);
  if (keys.length > LIMITS.maxKeys)
    return {
      ok: false,
      error: `That would make ${keys.length} keyframes; at most ${LIMITS.maxKeys}`,
    };
  const beats = scene.beats.map((b) =>
    b.figure === id && b.t >= from - KEY_EPSILON
      ? { ...b, t: roundTime(b.t + shift) }
      : b,
  );
  const speech = scene.speech.map((sp) =>
    sp.beat && sp.figure === id && sp.start >= from - KEY_EPSILON
      ? { ...sp, start: roundTime(sp.start + shift) }
      : sp,
  );
  const end = Math.max(
    keys.at(-1)?.t ?? 0,
    ...beats.map((b) => b.t + b.length),
    ...speech.map(speechEnd),
  );
  return ok({
    ...scene,
    animation: {
      ...scene.animation,
      duration: Math.min(
        LIMITS.duration[1],
        Math.max(scene.animation.duration, Math.ceil(end - 0.01)),
      ),
      keys,
    },
    beats,
    speech,
  });
}

/** `entries` as this figure's keys from `t0` to `end`, replacing its
 * keys over that span; other figures, lights and the camera keep
 * theirs. The animation grows to hold them. */
function withFigureKeys(
  scene: SceneDoc,
  id: string,
  t0: number,
  end: number,
  entries: Array<{ t: number; entry: FigureState }>,
  figures: Figure[],
  ok: (next: SceneDoc) => ActionResult,
): ActionResult {
  let keys = scene.animation.keys
    .map((k) => {
      if (k.t < t0 - KEY_EPSILON || k.t > end + KEY_EPSILON) return k;
      if (!k.figures[id]) return k;
      const rest = { ...k.figures };
      delete rest[id];
      return { ...k, figures: rest };
    })
    .filter(
      (k) =>
        Object.keys(k.figures).length > 0 ||
        Object.keys(k.lights).length > 0 ||
        k.camera,
    );
  for (const { t, entry } of entries) {
    const same = keys.find((k) => Math.abs(k.t - t) < KEY_EPSILON);
    keys = same
      ? keys.map((k) =>
          k === same ? { ...k, figures: { ...k.figures, [id]: entry } } : k,
        )
      : [
          ...keys,
          { t, ease: "spline" as const, figures: { [id]: entry }, lights: {} },
        ];
  }
  if (keys.length > LIMITS.maxKeys)
    return {
      ok: false,
      error: `That would make ${keys.length} keyframes; at most ${LIMITS.maxKeys}`,
    };
  return ok({
    ...scene,
    figures,
    animation: {
      ...scene.animation,
      // A first move (or beats) sets the length (so it loops without a
      // long pause); later ones only ever lengthen it.
      duration:
        scene.animation.keys.length === 0
          ? Math.max(LIMITS.duration[0], Math.ceil(end))
          : Math.max(scene.animation.duration, Math.ceil(end)),
      keys: keys.sort((a, b) => a.t - b.t),
    },
  });
}

/** Replace one figure (the first if `id` is omitted) with `change(f)`.
 * Returning the same object is a no-op. */
function withFigure(
  scene: SceneDoc,
  id: string | undefined,
  ok: (next: SceneDoc) => ActionResult,
  change: (f: Figure) => Figure | ActionResult,
): ActionResult {
  const figure = findFigure(scene, id);
  if (!figure) return { ok: false, error: `No figure "${id}"` };
  const next = change(figure);
  if ("ok" in next) return next;
  if (next === figure) return { ok: true, scene };
  return ok({
    ...scene,
    figures: scene.figures.map((f) => (f === figure ? next : f)),
  });
}

function patchJoints(
  scene: SceneDoc,
  figure: string | undefined,
  patches: Partial<Record<JointId, Record<string, number>>>,
  ok: (next: SceneDoc) => ActionResult,
): ActionResult {
  const ids = Object.keys(patches) as JointId[];
  if (ids.length === 0) return { ok: false, error: "No joints to change" };
  return withFigure(scene, figure, ok, (f) => {
    const joints = { ...f.pose.joints };
    for (const id of ids) {
      const patch = patches[id]!;
      const unknown = Object.keys(patch).find((k) => !(k in JOINTS[id].dofs));
      if (unknown)
        return {
          ok: false,
          error: `${JOINTS[id].label} has no "${unknown}" movement`,
        };
      joints[id] = { ...joints[id], ...patch } as never;
    }
    // The preset names a body pose: a face edit keeps it.
    const preset = ids.every(isFaceJoint) ? f.pose.preset : "custom";
    return { ...f, pose: { preset, joints } };
  });
}

/** Actions that change something keyframes record (figure placement
 * and pose, light settings, focal length): with auto-key on, these also
 * set a key at the current time. */
export function isAnimatable(action: SceneAction): boolean {
  switch (action.type) {
    case "applyPreset":
    case "updateLight":
    case "applyPosePreset":
    case "updateJoint":
    case "updateJoints":
    case "mirrorPose":
    case "updateFigure":
      return true;
    case "applyMotion":
      // Moves set their own keys; a pose is an edit like any other.
      return findMotion(action.motion)?.kind === "pose";
    case "updateCamera":
      return "focalMm" in action.patch;
    default:
      return false;
  }
}

/** Actions with the same key, in quick succession, merge into one undo
 * step — so dragging a slider or a light handle is a single undo. */
export function coalesceKey(action: SceneAction): string | null {
  switch (action.type) {
    case "updateLight":
      return `light:${action.id}:${Object.keys(action.patch).sort().join(",")}`;
    case "updateCamera":
      return `camera:${Object.keys(action.patch).sort().join(",")}`;
    case "updateMaterial":
      return `material:${Object.keys(action.patch).sort().join(",")}`;
    case "updateBackdrop":
      return `backdrop:${Object.keys(action.patch).sort().join(",")}`;
    case "updateJoint":
      return `joint:${action.figure ?? ""}:${action.joint}:${Object.keys(action.patch).sort().join(",")}`;
    case "updateFigure":
      return `figure:${action.figure}:${Object.keys(action.patch).sort().join(",")}`;
    case "moveKey":
      // Dragging a key on the timeline is one undo step.
      return "moveKey";
    case "moveBeat":
      // So is dragging a beat marker.
      return `moveBeat:${action.figure}:${action.index}`;
    case "setKeyValue":
      return `keyValue:${action.t}:${channelId(action.channel)}`;
    case "setKeyTangent":
      return `keyTangent:${action.t}:${channelId(action.channel)}`;
    case "setDuration":
      return "duration";
    case "updateJoints":
      return `joints:${action.figure ?? ""}:${Object.entries(action.patches)
        .map(([id, p]) => `${id}=${Object.keys(p!).sort().join(",")}`)
        .sort()
        .join(";")}`;
    default:
      return null;
  }
}

/** Keyboard nudge for a light handle: azimuth wraps around the subject,
 * elevation clamps to the schema range. Always returns both fields so
 * mixed left/up presses coalesce into one undo step. */
export function nudgeLight(
  light: Pick<StudioLight, "azimuth" | "elevation">,
  dAzimuth: number,
  dElevation: number,
): { azimuth: number; elevation: number } {
  const azimuth = (((light.azimuth + dAzimuth) % 360) + 360) % 360;
  const [lo, hi] = LIMITS.elevation;
  const elevation = Math.min(hi, Math.max(lo, light.elevation + dElevation));
  return { azimuth, elevation };
}

const FIELD_LABELS: Record<string, string> = {
  on: "on/off",
  azimuth: "direction",
  elevation: "height",
  distance: "distance",
  intensity: "intensity",
  temperature: "colour temperature",
  softness: "shadow softness",
  shadows: "shadows",
  spotAngle: "cone angle",
  size: "softbox size",
  label: "name",
  focalMm: "focal length",
  exposureEv: "exposure",
  toneMapping: "tone mapping",
  color: "colour",
  roughness: "roughness",
  metalness: "metalness",
  style: "style",
  shadowOpacity: "shadow opacity",
  quality: "quality",
};

function fields(patch: object): string {
  return Object.keys(patch)
    .map((k) => FIELD_LABELS[k] ?? k)
    .join(", ");
}

/** Human-readable label for history and action previews. */
export function describeAction(scene: SceneDoc, action: SceneAction): string {
  const label = describeOnly(scene, action);
  // With several figures, say which one a pose/model change was for.
  const figure = "figure" in action ? action.figure : undefined;
  const perFigure = [
    "setModel",
    "setCharacter",
    "applyPosePreset",
    "updateJoint",
    "updateJoints",
    "mirrorPose",
    "applyMotion",
  ].includes(action.type);
  if (action.type === "addSpeech" && scene.figures.length > 1)
    return `${figureLabel(scene, action.speech.figure)} · ${label}`;
  if (
    (action.type === "directBeats" ||
      action.type === "clearBeats" ||
      action.type === "moveBeat") &&
    scene.figures.length > 1
  )
    return `${figureLabel(scene, action.figure)} · ${label}`;
  return perFigure && scene.figures.length > 1
    ? `${figureLabel(scene, figure ?? scene.figures[0].id)} · ${label}`
    : label;
}

function describeOnly(scene: SceneDoc, action: SceneAction): string {
  const lightName = (id: string) => findLight(scene, id)?.label ?? id;
  switch (action.type) {
    case "applyPreset":
      return `Preset: ${PRESETS.find((p) => p.id === action.presetId)?.name ?? action.presetId}`;
    case "updateLight":
      if (Object.keys(action.patch).length === 1 && "on" in action.patch) {
        return `${lightName(action.id)} ${action.patch.on ? "on" : "off"}`;
      }
      return `${lightName(action.id)}: ${fields(action.patch)}`;
    case "addLight":
      return `Add ${KIND_LABELS[action.kind].toLowerCase()} light`;
    case "removeLight":
      return `Delete ${lightName(action.id)}`;
    case "duplicateLight":
      return `Duplicate ${lightName(action.id)}`;
    case "setModel":
      return `Mannequin: ${action.model}`;
    case "setCharacter":
      return action.character
        ? `Character: ${action.name ?? "imported"}`
        : "Back to the mannequin";
    case "addFigure":
      return "Add figure";
    case "duplicateFigure":
      return `Duplicate ${figureLabel(scene, action.figure)}`;
    case "removeFigure":
      return `Remove ${figureLabel(scene, action.figure)}`;
    case "updateFigure":
      return `${figureLabel(scene, action.figure)}: ${
        "rotation" in action.patch && Object.keys(action.patch).length === 1
          ? "turn"
          : "move"
      }`;
    case "updateCamera":
      return `Camera: ${fields(action.patch)}`;
    case "applyMaterialPreset":
      return `Material: ${MATERIAL_PRESETS.find((m) => m.id === action.presetId)?.name ?? action.presetId}`;
    case "updateMaterial":
      return `Material: ${fields(action.patch)}`;
    case "applyBackdropPreset":
      return `Backdrop: ${BACKDROP_PRESETS.find((b) => b.id === action.presetId)?.name ?? action.presetId}`;
    case "updateBackdrop":
      return `Backdrop: ${fields(action.patch)}`;
    case "updateShadows":
      return `Shadows: ${fields(action.patch)}`;
    case "loadScene":
      return action.label ?? "Load scene";
    case "addSpeech":
      return `Lip sync: ${action.speech.name}`;
    case "directBeats":
      return `Direct ${action.beats.length} beat${action.beats.length === 1 ? "" : "s"} at ${secs(action.t)}`;
    case "clearBeats":
      return "Clear beat markers";
    case "moveBeat":
      return `Move beat to ${secs(action.to)}`;
    case "removeSpeech":
      return `Remove lip sync: ${scene.speech[action.index]?.name ?? "track"}`;
    case "applyPosePreset":
      return `Pose: ${posePreset(action.presetId)?.name ?? action.presetId}`;
    case "applyMotion": {
      const m = findMotion(action.motion);
      const name = m?.name ?? action.motion;
      const side = action.mirror ? " (left)" : "";
      return m?.kind === "move"
        ? `Move: ${name}${side} at ${secs(action.t ?? 0)}`
        : `Pose: ${name}${side}`;
    }
    case "updateJoint": {
      const j = JOINTS[action.joint];
      const dofs = j.dofs as Record<string, { label: string }>;
      const what = Object.keys(action.patch)
        .map((k) => dofs[k]?.label.toLowerCase() ?? k)
        .join(", ");
      return `${j.label}: ${what}`;
    }
    case "updateJoints": {
      const ids = Object.keys(action.patches) as JointId[];
      const group = POSE_GROUPS.find((g) =>
        ids.every((id) => (g.joints as readonly string[]).includes(id)),
      );
      return `Move ${(group?.label ?? ids.map((id) => JOINTS[id].label).join(" + ")).toLowerCase()}`;
    }
    case "mirrorPose":
      return "Mirror pose";
    case "setKey":
      return `Set key at ${secs(action.t)}`;
    case "deleteKey":
      return `Delete key at ${secs(action.t)}`;
    case "moveKey":
      return `Move key to ${secs(action.to)}`;
    case "setDuration":
      return `Animation length: ${action.duration} s`;
    case "clearKeys":
      return "Delete all keys";
    case "setKeyValue":
      return `Edit key at ${secs(action.t)}`;
    case "setKeyEase":
      return `Key at ${secs(action.t)}: ${action.ease}`;
    case "setKeyTangent":
      return action.slope === null
        ? `Reset tangent at ${secs(action.t)}`
        : `Tangent at ${secs(action.t)}`;
    case "setKeyTangents":
      return `Tangents at ${secs(action.t)} (${action.changes.length} curve${action.changes.length === 1 ? "" : "s"})`;
    case "reset":
      return "Reset scene";
  }
}
