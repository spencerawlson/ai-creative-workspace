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
  CameraSchema,
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
  FigureIdSchema,
  FigureSchema,
  type Figure,
  ShadowSchema,
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
import {
  figureLabel,
  findFigure,
  freeSpot,
  newFigure,
  nextFigureId,
} from "./figures";

const lightId = z.string().min(1).max(24);
const keyTime = z.number().finite().min(0).max(LIMITS.duration[1]);
/** Which figure a pose/model action targets; omitted = the first one. */
const figureRef = FigureIdSchema.optional();

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
      patch: CameraSchema.partial().strict(),
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
        pose: { preset: preset.id, joints: structuredClone(preset.joints) },
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
    case "setKeyTangent": {
      const key = keyAt(scene.animation, action.t);
      if (!key) return { ok: false, error: `No keyframe at ${secs(action.t)}` };
      if (keyValue(key, action.channel) === undefined)
        return { ok: false, error: "That keyframe doesn't record it" };
      const id = channelId(action.channel);
      const tangents = { ...key.tangents };
      if (action.slope === null) delete tangents[id];
      // Unified tangent, as Maya's default: the curve passes smoothly.
      else tangents[id] = { in: action.slope, out: action.slope };
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
    return { ...f, pose: { preset: "custom", joints } };
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
    "applyPosePreset",
    "updateJoint",
    "updateJoints",
    "mirrorPose",
  ].includes(action.type);
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
    case "applyPosePreset":
      return `Pose: ${posePreset(action.presetId)?.name ?? action.presetId}`;
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
    case "reset":
      return "Reset scene";
  }
}
