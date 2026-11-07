/** Studio defaults and presets: lighting (from lib/lighting.ts, the
 * six curated M2 presets, unchanged), mannequin materials, backdrops.
 */

import { PRESETS, type LightState } from "@/lib/lighting";
import { newFigure } from "./figures";
import { defaultAnimation } from "./schema";
import type {
  BackdropSettings,
  CameraSettings,
  LightKind,
  MaterialSettings,
  SceneDoc,
  StudioLight,
} from "./schema";

/** Exposure multiplier at 0 EV — the M1–M3 tone-mapping exposure. */
export const BASE_EXPOSURE = 1.1;
/** ≈ 40° vertical FOV on a 24 mm-high frame, the M1–M3 camera. */
export const DEFAULT_FOCAL_MM = 33;

export const DEFAULT_SPOT_ANGLE = 40;
export const DEFAULT_AREA_SIZE = 1;

export function fromLegacyLight(l: LightState): StudioLight {
  return {
    ...l,
    kind: "directional",
    spotAngle: DEFAULT_SPOT_ANGLE,
    size: DEFAULT_AREA_SIZE,
  };
}

export function presetLights(presetId: string): StudioLight[] | null {
  const p = PRESETS.find((x) => x.id === presetId);
  return p ? p.lights.map(fromLegacyLight) : null;
}

export const KIND_LABELS: Record<LightKind, string> = {
  directional: "Directional",
  spot: "Spot",
  point: "Point",
  area: "Softbox",
};

/** A sensible new light of each kind: front-left, above eye level. */
export function newLight(
  id: string,
  label: string,
  kind: LightKind,
): StudioLight {
  return {
    id,
    label,
    kind,
    on: true,
    azimuth: 300,
    elevation: 30,
    distance: kind === "area" ? 2.5 : 3.5,
    intensity: kind === "area" ? 1.5 : 1.2,
    temperature: 5600,
    softness: 4,
    shadows: false,
    spotAngle: DEFAULT_SPOT_ANGLE,
    size: kind === "area" ? 1.2 : DEFAULT_AREA_SIZE,
  };
}

export interface MaterialPreset extends Omit<MaterialSettings, "preset"> {
  id: string;
  name: string;
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  {
    id: "studio-grey",
    name: "Studio grey",
    color: "#d8d8de",
    roughness: 0.65,
    metalness: 0,
  },
  {
    id: "plaster",
    name: "White plaster",
    color: "#f1eee8",
    roughness: 0.95,
    metalness: 0,
  },
  {
    id: "clay",
    name: "Terracotta clay",
    color: "#b0705a",
    roughness: 0.85,
    metalness: 0,
  },
  {
    id: "satin",
    name: "Satin",
    color: "#c7c8d2",
    roughness: 0.32,
    metalness: 0,
  },
  {
    id: "warm-skin",
    name: "Warm skin tone",
    color: "#d9a98c",
    roughness: 0.55,
    metalness: 0,
  },
  {
    id: "deep-skin",
    name: "Deep skin tone",
    color: "#7a5240",
    roughness: 0.5,
    metalness: 0,
  },
  {
    id: "bronze",
    name: "Bronze",
    color: "#a8794a",
    roughness: 0.35,
    metalness: 1,
  },
  {
    id: "chrome",
    name: "Chrome",
    color: "#e6e6ea",
    roughness: 0.08,
    metalness: 1,
  },
];

export interface BackdropPreset extends Omit<BackdropSettings, "preset"> {
  id: string;
  name: string;
}

export const BACKDROP_PRESETS: BackdropPreset[] = [
  {
    id: "studio-dark",
    name: "Studio dark",
    color: "#111118",
    style: "catcher",
    shadowOpacity: 0.4,
  },
  {
    id: "black-void",
    name: "Black void",
    color: "#000000",
    style: "catcher",
    shadowOpacity: 0.5,
  },
  {
    id: "grey-seamless",
    name: "Grey seamless",
    color: "#6e6e74",
    style: "cyc",
    shadowOpacity: 0.4,
  },
  {
    id: "white-cyc",
    name: "White cyclorama",
    color: "#e9e9ec",
    style: "cyc",
    shadowOpacity: 0.4,
  },
  {
    id: "warm-paper",
    name: "Warm paper",
    color: "#8d6c50",
    style: "cyc",
    shadowOpacity: 0.4,
  },
  {
    id: "deep-blue",
    name: "Deep blue",
    color: "#1c2a44",
    style: "cyc",
    shadowOpacity: 0.4,
  },
];

function stripName<T extends { id: string; name: string }>({
  id,
  name: _name,
  ...rest
}: T) {
  return { preset: id, ...rest };
}

export function materialFromPreset(id: string): MaterialSettings | null {
  const p = MATERIAL_PRESETS.find((x) => x.id === id);
  return p ? stripName(p) : null;
}

export function backdropFromPreset(id: string): BackdropSettings | null {
  const p = BACKDROP_PRESETS.find((x) => x.id === id);
  return p ? stripName(p) : null;
}

export const DEFAULT_CAMERA: CameraSettings = {
  focalMm: DEFAULT_FOCAL_MM,
  exposureEv: 0,
  toneMapping: "aces",
  aperture: 0,
  bloom: 0,
  vignette: 0,
  grain: 0,
};

/** The M1–M3 look: Three-point, male figure, studio grey, dark stage. */
export function defaultScene(): SceneDoc {
  return {
    version: 2,
    preset: PRESETS[0].id,
    lights: presetLights(PRESETS[0].id)!,
    camera: { ...DEFAULT_CAMERA },
    material: materialFromPreset("studio-grey")!,
    backdrop: backdropFromPreset("studio-dark")!,
    shadows: { quality: "medium" },
    figures: [newFigure("fig-1", "male", { x: 0, z: 0 })],
    animation: defaultAnimation(),
    speech: [],
    beats: [],
  };
}

/** 35 mm-equivalent focal length → vertical FOV in degrees (24 mm frame). */
export function focalToVerticalFov(focalMm: number): number {
  return (2 * Math.atan(12 / focalMm) * 180) / Math.PI;
}

export function exposureMultiplier(ev: number): number {
  return BASE_EXPOSURE * Math.pow(2, ev);
}
