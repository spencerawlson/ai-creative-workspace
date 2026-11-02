/** M2: light state, colour-temperature mapping, and curated presets.
 * Preset notes are static data written once — no LLM, no network calls.
 */

export type LightId = "key" | "fill" | "rim";

export interface LightState {
  id: LightId;
  label: string;
  on: boolean;
  /** Degrees, 0 = front (toward the camera), 90 = subject's left, 180 = back. */
  azimuth: number;
  /** Degrees above the horizon. */
  elevation: number;
  /** Distance from the mannequin centre, in scene units. */
  distance: number;
  intensity: number;
  /** Kelvin, 2700–6500. */
  temperature: number;
  /** Shadow softness, 0 (hard) – 10 (soft). Only meaningful when shadows on. */
  softness: number;
  shadows: boolean;
}

export interface Preset {
  id: string;
  name: string;
  note: string;
  lights: LightState[];
}

function light(
  id: LightId,
  label: string,
  on: boolean,
  azimuth: number,
  elevation: number,
  distance: number,
  intensity: number,
  temperature: number,
  softness: number,
  shadows: boolean,
): LightState {
  return {
    id,
    label,
    on,
    azimuth,
    elevation,
    distance,
    intensity,
    temperature,
    softness,
    shadows,
  };
}

/** Approximate colour for a colour temperature, as [r, g, b] in 0–1.
 * Supported range is 2000–9000K; the 2700–6500K stops are unchanged
 * from M2 so existing presets and share links render identically. */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const k = Math.max(2000, Math.min(9000, kelvin));
  // Piecewise-linear stops: candle → tungsten → neutral → daylight → shade.
  const stops: Array<[number, [number, number, number]]> = [
    [2000, [1.0, 0.5, 0.18]],
    [2700, [1.0, 0.62, 0.32]],
    [3500, [1.0, 0.78, 0.55]],
    [4500, [1.0, 0.89, 0.74]],
    [5600, [1.0, 0.97, 0.92]],
    [6500, [0.94, 0.96, 1.0]],
    [9000, [0.8, 0.88, 1.0]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [k0, c0] = stops[i];
    const [k1, c1] = stops[i + 1];
    if (k >= k0 && k <= k1) {
      const t = (k - k0) / (k1 - k0);
      return [
        c0[0] + (c1[0] - c0[0]) * t,
        c0[1] + (c1[1] - c0[1]) * t,
        c0[2] + (c1[2] - c0[2]) * t,
      ];
    }
  }
  return stops[stops.length - 1][1];
}

/** Height of the point every light orbits and aims at (mannequin centre). */
export const LIGHT_PIVOT_Y = 0.95;

/** Position of a light in world space, aimed at the mannequin centre. */
export function lightPosition(
  l: Pick<LightState, "azimuth" | "elevation" | "distance">,
): [number, number, number] {
  const az = (l.azimuth * Math.PI) / 180;
  const el = (l.elevation * Math.PI) / 180;
  const d = l.distance;
  return [
    d * Math.cos(el) * Math.sin(az),
    LIGHT_PIVOT_Y + d * Math.sin(el),
    d * Math.cos(el) * Math.cos(az),
  ];
}

export const PRESETS: Preset[] = [
  {
    id: "three-point",
    name: "Three-point",
    note: "The standard studio setup: a key light shapes the face, a softer fill from the opposite side opens up the shadows, and a rim light from behind separates the subject from the background. Watch that the fill never overpowers the key — the face should still have one clear bright side and one shadow side.",
    lights: [
      light("key", "Key", true, 45, 35, 4, 2.4, 5600, 4, true),
      light("fill", "Fill", true, 315, 20, 4, 0.9, 5600, 4, false),
      light("rim", "Rim", true, 180, 40, 4, 2.0, 6500, 4, false),
    ],
  },
  {
    id: "rembrandt",
    name: "Rembrandt",
    note: "The key sits high and about 45° to one side, so a small triangle of light appears on the shadow-side cheek. That triangle is the tell — if it closes up into a full patch, the key is too far to the front; if the eye on the shadow side goes dark, it is too far to the side.",
    lights: [
      light("key", "Key", true, 45, 30, 3.5, 2.6, 5000, 3, true),
      light("fill", "Fill", true, 330, 15, 4, 0.35, 5600, 4, false),
      light("rim", "Rim", true, 160, 35, 4, 0.8, 6000, 4, false),
    ],
  },
  {
    id: "split",
    name: "Split",
    note: "The key sits at 90° to the side, so the face is split exactly in half: one side lit, one side in shadow. It is dramatic and unforgiving — any fill kills the effect, so the fill stays off here. Watch the nose shadow: it should run straight across, not creep toward the lit eye.",
    lights: [
      light("key", "Key", true, 90, 25, 3.5, 2.8, 5600, 2, true),
      light("fill", "Fill", false, 315, 20, 4, 0.9, 5600, 4, false),
      light("rim", "Rim", true, 180, 35, 4, 1.2, 6500, 4, false),
    ],
  },
  {
    id: "butterfly",
    name: "Butterfly",
    note: "The key sits high and directly in front, casting a small butterfly-shaped shadow under the nose. It flatters symmetrical faces and is the classic beauty setup. Watch for deep shadows under the chin and brow — if they go too dark, bring the fill up from below rather than moving the key.",
    lights: [
      light("key", "Key", true, 0, 45, 3.5, 2.6, 5600, 3, true),
      light("fill", "Fill", true, 0, 10, 4, 0.7, 5600, 4, false),
      light("rim", "Rim", true, 180, 35, 4, 1.5, 6500, 4, false),
    ],
  },
  {
    id: "low-key",
    name: "Low-key",
    note: "Most of the frame stays dark on purpose: one warm key shapes the face and a cool rim picks out an edge, with no fill at all. This is mood over detail. Watch the shadow side — it should fall to near-black, but the rim must still be strong enough that the subject does not melt into the background.",
    lights: [
      light("key", "Key", true, 60, 30, 3.5, 2.2, 4000, 2, true),
      light("fill", "Fill", false, 315, 20, 4, 0.9, 5600, 4, false),
      light("rim", "Rim", true, 180, 35, 4, 1.8, 6500, 4, false),
    ],
  },
  {
    id: "high-key",
    name: "High-key",
    note: "Everything is bright and shadows are kept faint: a strong key plus a nearly equal fill from the other side, with a rim to hold the outline. This is the clean, airy look used for beauty and product work. Watch for flatness — if the face loses all modelling, pull the fill back a little until one side reads slightly brighter.",
    lights: [
      light("key", "Key", true, 30, 35, 4, 2.2, 6500, 6, true),
      light("fill", "Fill", true, 330, 25, 4, 1.8, 6500, 6, false),
      light("rim", "Rim", true, 180, 35, 4, 1.2, 6500, 4, false),
    ],
  },
];

export const CUSTOM_NOTE =
  "Custom setup — you changed a light after choosing a preset. Drag the sliders and watch how the shadows move across the face; the note for a preset returns when you tap its chip again.";

export function cloneLights(lights: LightState[]): LightState[] {
  return lights.map((l) => ({ ...l }));
}
