/** M3: URL share encoding for a light setup.
 * Format: a single `s` query param holding base64url-encoded JSON:
 *   {"p": "<preset id or 'custom'>", "l": [[on, azimuth, elevation, distance,
 *    intensity, temperature, softness, shadows], ...key, fill, rim...]}
 * Numbers are rounded on encode so links stay short and copy/paste-safe.
 * Decoding is strict: anything malformed, out of range, or incomplete
 * returns null and the caller falls back to the default setup.
 */

import { PRESETS, type LightId, type LightState } from "./lighting";

export interface SharedSetup {
  preset: string;
  lights: LightState[];
}

const LABELS: Record<LightId, string> = {
  key: "Key",
  fill: "Fill",
  rim: "Rim",
};
const IDS: LightId[] = ["key", "fill", "rim"];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function encodeSetup(preset: string, lights: LightState[]): string {
  const payload = {
    p: preset,
    l: lights.map((l) => [
      l.on ? 1 : 0,
      Math.round(l.azimuth),
      Math.round(l.elevation),
      round1(l.distance),
      round1(l.intensity),
      Math.round(l.temperature),
      Math.round(l.softness),
      l.shadows ? 1 : 0,
    ]),
  };
  const json = JSON.stringify(payload);
  // JSON here is ASCII-only, so btoa is safe.
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function inRange(v: number, min: number, max: number): boolean {
  return v >= min && v <= max;
}

export function decodeSetup(param: string | null): SharedSetup | null {
  if (!param) return null;
  try {
    const base64 = param.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const parsed: unknown = JSON.parse(atob(padded));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { p, l } = parsed as { p?: unknown; l?: unknown };
    if (typeof p !== "string") return null;
    if (p !== "custom" && !PRESETS.some((x) => x.id === p)) return null;
    if (!Array.isArray(l) || l.length !== 3) return null;
    const lights: LightState[] = [];
    for (let i = 0; i < 3; i++) {
      const row: unknown = l[i];
      if (!Array.isArray(row) || row.length !== 8) return null;
      const [on, az, el, dist, inten, temp, soft, shad] = row;
      if (
        (on !== 0 && on !== 1) ||
        !isNum(az) ||
        !inRange(az, 0, 360) ||
        !isNum(el) ||
        !inRange(el, 0, 80) ||
        !isNum(dist) ||
        !inRange(dist, 2, 7) ||
        !isNum(inten) ||
        !inRange(inten, 0, 4) ||
        !isNum(temp) ||
        !inRange(temp, 2700, 6500) ||
        !isNum(soft) ||
        !inRange(soft, 0, 10) ||
        (shad !== 0 && shad !== 1)
      ) {
        return null;
      }
      lights.push({
        id: IDS[i],
        label: LABELS[IDS[i]],
        on: on === 1,
        azimuth: az,
        elevation: el,
        distance: dist,
        intensity: inten,
        temperature: temp,
        softness: soft,
        shadows: shad === 1,
      });
    }
    return { preset: p, lights };
  } catch {
    return null;
  }
}
