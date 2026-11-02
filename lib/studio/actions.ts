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
  mirrorJoints,
  posePreset,
  type JointId,
} from "./pose";

const lightId = z.string().min(1).max(24);

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
  z.object({ type: z.literal("setModel"), model: ModelSchema }).strict(),
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
    })
    .strict(),
  z
    .object({
      type: z.literal("updateJoint"),
      joint: z.enum(JOINT_IDS as [JointId, ...JointId[]]),
      patch: JointPatchSchema,
    })
    .strict(),
  z.object({ type: z.literal("mirrorPose") }).strict(),
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
      if (scene.model === action.model) return { ok: true, scene };
      return ok({ ...scene, model: action.model });
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
      return ok({
        ...scene,
        pose: { preset: preset.id, joints: structuredClone(preset.joints) },
      });
    }
    case "updateJoint": {
      const dofs = JOINTS[action.joint].dofs;
      const unknown = Object.keys(action.patch).find((k) => !(k in dofs));
      if (unknown)
        return {
          ok: false,
          error: `${JOINTS[action.joint].label} has no "${unknown}" movement`,
        };
      return ok({
        ...scene,
        pose: {
          preset: "custom",
          joints: {
            ...scene.pose.joints,
            [action.joint]: {
              ...scene.pose.joints[action.joint],
              ...action.patch,
            },
          },
        },
      });
    }
    case "mirrorPose":
      return ok({
        ...scene,
        pose: { preset: "custom", joints: mirrorJoints(scene.pose.joints) },
      });
    case "reset":
      return ok(defaultScene());
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
      return `joint:${action.joint}:${Object.keys(action.patch).sort().join(",")}`;
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
    case "mirrorPose":
      return "Mirror pose";
    case "reset":
      return "Reset scene";
  }
}
