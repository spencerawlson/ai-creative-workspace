/** Scene document schema for the Lighting Studio.
 *
 * Zod is the single source of truth for scene types, numeric ranges and
 * validation. Everything that enters the scene — UI edits, keyboard
 * shortcuts, share links, autosave recovery, imported project files and
 * (later) AI-proposed actions — is parsed against these schemas, so an
 * out-of-range or unknown value can never reach the renderer.
 */

import { z } from "zod";
import { PoseSchema, defaultPose } from "./pose";

export const LIMITS = {
  maxLights: 8,
  /** Each mannequin is ~240k triangles; four keeps phones interactive. */
  maxFigures: 4,
  /** Where a figure may stand on the floor (metres from the centre). */
  figureX: [-3, 3],
  figureZ: [-3, 3],
  /** Which way a figure faces, degrees about the vertical (0 = camera). */
  rotation: [-180, 180],
  azimuth: [0, 360],
  elevation: [-45, 85],
  distance: [1.5, 8],
  intensity: [0, 4],
  temperature: [2000, 9000],
  softness: [0, 10],
  spotAngle: [10, 90],
  size: [0.3, 3],
  focalMm: [18, 135],
  exposureEv: [-3, 3],
  roughness: [0, 1],
  metalness: [0, 1],
  shadowOpacity: [0, 1],
} as const satisfies Record<string, number | readonly [number, number]>;

type RangeKey = Exclude<keyof typeof LIMITS, "maxLights" | "maxFigures">;

const num = (key: RangeKey) =>
  z.number().finite().min(LIMITS[key][0]).max(LIMITS[key][1]);

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, "Expected #rrggbb");

export const LIGHT_KINDS = ["directional", "spot", "point", "area"] as const;
export const LightKindSchema = z.enum(LIGHT_KINDS);
export type LightKind = z.infer<typeof LightKindSchema>;

export const LightSchema = z.object({
  /** Stable id: "key", "fill", "rim", or "light-N" for added lights. */
  id: z.string().regex(/^[a-z][a-z0-9-]{0,23}$/),
  /** Display name; user-editable. */
  label: z.string().trim().min(1).max(32),
  kind: LightKindSchema,
  on: z.boolean(),
  azimuth: num("azimuth"),
  elevation: num("elevation"),
  distance: num("distance"),
  intensity: num("intensity"),
  temperature: num("temperature"),
  softness: num("softness"),
  shadows: z.boolean(),
  /** Spot lights only: full cone angle in degrees. */
  spotAngle: num("spotAngle"),
  /** Area lights only: softbox edge length in scene units (metres). */
  size: num("size"),
});
export type StudioLight = z.infer<typeof LightSchema>;

/** Fields an edit may change on a light (id and kind are fixed). */
export const LightPatchSchema = LightSchema.omit({ id: true, kind: true })
  .partial()
  .strict();
export type LightPatch = z.infer<typeof LightPatchSchema>;

export const TONE_MAPPINGS = ["aces", "agx", "neutral"] as const;
export const CameraSchema = z.object({
  /** 35 mm-equivalent focal length; drives vertical field of view. */
  focalMm: num("focalMm"),
  /** Exposure compensation in stops, relative to the studio default. */
  exposureEv: num("exposureEv"),
  toneMapping: z.enum(TONE_MAPPINGS),
});
export type CameraSettings = z.infer<typeof CameraSchema>;

export const MaterialSchema = z.object({
  /** Material preset id, or "custom" after a manual edit. */
  preset: z.string().max(32),
  color: hexColor,
  roughness: num("roughness"),
  metalness: num("metalness"),
});
export type MaterialSettings = z.infer<typeof MaterialSchema>;

export const BACKDROP_STYLES = ["catcher", "cyc"] as const;
export const BackdropSchema = z.object({
  /** Backdrop preset id, or "custom" after a manual edit. */
  preset: z.string().max(32),
  color: hexColor,
  /** catcher: invisible floor that only shows shadows; cyc: seamless sweep. */
  style: z.enum(BACKDROP_STYLES),
  shadowOpacity: num("shadowOpacity"),
});
export type BackdropSettings = z.infer<typeof BackdropSchema>;

export const SHADOW_QUALITIES = ["low", "medium", "high"] as const;
export const ShadowSchema = z.object({
  quality: z.enum(SHADOW_QUALITIES),
});
export type ShadowSettings = z.infer<typeof ShadowSchema>;

export const MODELS = ["male", "female"] as const;
export const ModelSchema = z.enum(MODELS);
export type MannequinModel = z.infer<typeof ModelSchema>;

export const FigureIdSchema = z.string().regex(/^fig-\d{1,3}$/);

/** One mannequin in the scene: which model, where it stands, which way
 * it faces, and its pose. */
export const FigureSchema = z.object({
  id: FigureIdSchema,
  model: ModelSchema,
  x: num("figureX"),
  z: num("figureZ"),
  rotation: num("rotation"),
  /** Optional on input: scenes saved before posing existed load in
   * the scan's A-pose. */
  pose: PoseSchema.default(defaultPose),
});
export type Figure = z.infer<typeof FigureSchema>;

/** Scenes saved before several characters existed had one mannequin as
 * top-level `model` + `pose`; they become a one-figure scene. */
function upgradeSingleFigure(input: unknown): unknown {
  if (typeof input !== "object" || input === null || "figures" in input)
    return input;
  if (!("model" in input)) return input;
  const { model, pose, ...rest } = input as Record<string, unknown>;
  return {
    ...rest,
    figures: [{ id: "fig-1", model, x: 0, z: 0, rotation: 0, pose }],
  };
}

export const SceneSchema = z
  .preprocess(
    upgradeSingleFigure,
    z.object({
      version: z.literal(2),
      /** Lighting preset id, or "custom" once a light is edited. */
      preset: z.string().max(32),
      lights: z.array(LightSchema).min(1).max(LIMITS.maxLights),
      camera: CameraSchema,
      material: MaterialSchema,
      backdrop: BackdropSchema,
      shadows: ShadowSchema,
      figures: z.array(FigureSchema).min(1).max(LIMITS.maxFigures),
    }),
  )
  .refine((s) => new Set(s.lights.map((l) => l.id)).size === s.lights.length, {
    message: "Light ids must be unique",
    path: ["lights"],
  })
  .refine(
    (s) => new Set(s.figures.map((f) => f.id)).size === s.figures.length,
    { message: "Figure ids must be unique", path: ["figures"] },
  );
export type SceneDoc = z.infer<typeof SceneSchema>;

export function clampTo(key: RangeKey, value: number): number {
  const [min, max] = LIMITS[key];
  return Math.min(max, Math.max(min, value));
}
