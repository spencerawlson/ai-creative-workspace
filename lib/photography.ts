/** Photography M1: camera teaching controls.
 * Everything here is a teaching aid over the existing Lighting
 * Studio scene — not a real camera simulation. Focal length maps
 * to field of view; exposure presets map to a single preview
 * brightness value. The page says both of these plainly.
 */

export type FramingId = "wide" | "portrait" | "closeup";
export type CameraView = "face" | "full";

export interface FramingPreset {
  id: FramingId;
  name: string;
  /** Which scene view this framing uses (LightingScene views). */
  view: CameraView;
  /** Focal length in mm (35 mm equivalent) for this framing. */
  focalMm: number;
  note: string;
}

export const FRAMINGS: FramingPreset[] = [
  {
    id: "wide",
    name: "Wide shot",
    view: "full",
    focalMm: 28,
    note: "The whole figure, with room around it. A wide framing shows where the character stands, not just who they are. Watch the edges — a wide shot with a busy background loses the figure fast.",
  },
  {
    id: "portrait",
    name: "Portrait",
    view: "full",
    focalMm: 50,
    note: "The figure at a natural 50 mm view — closest to how a person actually sees, so features do not stretch or squash. Step in (orbit closer, or try Close-up) for a head-and-shoulders crop. Watch the headroom — a little space above the head, not a lot.",
  },
  {
    id: "closeup",
    name: "Close-up",
    view: "face",
    focalMm: 60,
    note: "The face fills the frame, so expression and light on the face carry the whole shot. A longer focal length flattens features gently. Watch the eyes — if they are not sharp in a close-up, nothing else saves the shot. Slide to 85 mm for an even tighter crop, where the frame will cut the face.",
  },
];

/** Vertical field of view, in degrees, for a focal length on a
 * 35 mm frame (24 mm image height). 24 mm -> ~53 deg, 50 mm -> ~27
 * deg, 85 mm -> ~16 deg. This is real optics for the angle of view;
 * it is not a claim about a sensor, a lens, or depth of field. */
export function focalToFov(focalMm: number): number {
  const f = Math.max(24, Math.min(85, focalMm));
  return (2 * Math.atan(12 / f) * 180) / Math.PI;
}

export interface ExposurePreset {
  id: string;
  name: string;
  aperture: string;
  iso: number;
  shutter: string;
  /** Preview brightness multiplier applied to tone mapping. */
  exposure: number;
  note: string;
}

export const EXPOSURES: ExposurePreset[] = [
  {
    id: "daylight",
    name: "Bright daylight",
    aperture: "f/8",
    iso: 100,
    shutter: "1/250",
    exposure: 1.0,
    note: "Plenty of light, so the aperture can stay small (sharp everywhere) and the ISO low (clean picture). A fast shutter freezes movement. This is the balanced starting point.",
  },
  {
    id: "lowlight",
    name: "Low light",
    aperture: "f/2.8",
    iso: 800,
    shutter: "1/60",
    exposure: 1.35,
    note: "Little light, so every part of the triangle gives something up: the aperture opens wide (less in focus), the ISO rises (more grain), the shutter slows (movement blurs). Brightness is bought with trade-offs — that is the whole lesson.",
  },
  {
    id: "moody",
    name: "Moody / underexposed",
    aperture: "f/5.6",
    iso: 100,
    shutter: "1/125",
    exposure: 0.7,
    note: "Deliberately darker than 'correct'. Shadows hold mood and a bright edge still reads. Underexposure is a choice here, not a mistake — but it only works if something in the frame is still bright enough to look at.",
  },
];

export const EXPOSURE_HONEST_NOTE =
  "This exposure control brightens or darkens the 3D preview. It is a teaching aid for the aperture / ISO / shutter triangle, not a real camera sensor simulation: it does not model depth of field, grain, or motion blur.";
