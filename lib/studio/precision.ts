/** Precision preferences: the floor grid, snapping and the units
 * distances are shown in. They belong to this device (like render
 * quality), not to the scene: a share link opens in the viewer's own
 * units. The scene always stores metres. Pure, apart from load/save. */

import { z } from "zod";

export const UNITS = ["m", "cm", "ft"] as const;
export type Units = (typeof UNITS)[number];

/** Grid spacing and snap step, in metres. */
export const SNAP_STEPS = [0.1, 0.25, 0.5] as const;
export type SnapStep = (typeof SNAP_STEPS)[number];

export const PrecisionSchema = z.object({
  grid: z.boolean(),
  snap: z.boolean(),
  step: z.union([z.literal(0.1), z.literal(0.25), z.literal(0.5)]),
  units: z.enum(UNITS),
});
export type Precision = z.infer<typeof PrecisionSchema>;

export const DEFAULT_PRECISION: Precision = {
  grid: false,
  snap: false,
  step: 0.25,
  units: "m",
};

const KEY = "iko3d.precision";

export function loadPrecision(storage?: Pick<Storage, "getItem">): Precision {
  try {
    const raw = (storage ?? window.localStorage).getItem(KEY);
    if (!raw) return DEFAULT_PRECISION;
    const parsed = PrecisionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_PRECISION;
  } catch {
    return DEFAULT_PRECISION;
  }
}

export function savePrecision(
  p: Precision,
  storage?: Pick<Storage, "setItem">,
): void {
  try {
    (storage ?? window.localStorage).setItem(KEY, JSON.stringify(p));
  } catch {
    // Private mode or storage full: the preference lasts this visit.
  }
}

/** `v` to the nearest multiple of `step` (and clean of float dust). */
export function snapTo(v: number, step: number): number {
  const s = Math.round(v / step) * step;
  return Math.round(s * 1e6) / 1e6;
}

const FOOT = 0.3048;

/** How a distance field reads in these units: the factor from metres,
 * the unit label, and a slider step (from one in metres). */
export function lengthField(
  units: Units,
  stepM: number,
): { scale: number; unit: string; step: number } {
  if (units === "cm")
    return { scale: 100, unit: " cm", step: Math.max(1, stepM * 100) };
  if (units === "ft")
    return { scale: 1 / FOOT, unit: " ft", step: Math.max(0.05, stepM / FOOT) };
  return { scale: 1, unit: " m", step: stepM };
}

/** A distance in metres as text in these units: "1.25 m", "125 cm",
 * "4′ 1″" (feet and inches, to the nearest inch). */
export function formatLength(m: number, units: Units): string {
  if (units === "cm") return `${Math.round(m * 100)} cm`;
  if (units === "ft") {
    const totalIn = Math.round(Math.abs(m) / 0.0254);
    const sign = m < 0 && totalIn ? "−" : "";
    return `${sign}${Math.floor(totalIn / 12)}′ ${totalIn % 12}″`;
  }
  return `${(Math.round(m * 100) / 100).toFixed(2)} m`;
}
