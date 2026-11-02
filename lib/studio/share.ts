/** Share-link codec for full scenes (`?s=` param), version 2.
 *
 * v2 payload, base64url JSON with positional arrays to keep links short:
 *   { v: 2, p: preset, m: model,
 *     l: [[id, label, kind, on, az, el, dist, int, temp, soft, shadows, spot, size], ...],
 *     c: [focalMm, exposureEv, toneMapping],
 *     mt: [preset, color, roughness, metalness],
 *     b: [preset, color, style, shadowOpacity],
 *     q: shadowQuality,
 *     po?: [posePreset, [joint angles in pose.ts order, whole degrees]] }
 *
 * `po` is omitted for the scan's A-pose, so unposed links are unchanged
 * and links made before posing existed open in the A-pose.
 *
 * Links made by M3 (v1: three lights, no `v`) still open: they are
 * decoded by the original strict v1 decoder and upgraded with defaults.
 * Decoding always ends in SceneSchema validation; anything malformed
 * returns null and the caller keeps its current scene.
 */

import { decodeSetup } from "@/lib/share";
import { defaultScene, fromLegacyLight, presetLights } from "./presets";
import { flattenJoints, isNeutral, unflattenJoints } from "./pose";
import { LIGHT_KINDS, SceneSchema, type SceneDoc } from "./schema";

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Values are rounded so links stay short; rounding keeps them in range
 * because every range bound is itself a round number. */
export function encodeScene(scene: SceneDoc): string {
  const payload = {
    v: 2,
    p: scene.preset,
    m: scene.model,
    l: scene.lights.map((l) => [
      l.id,
      l.label,
      LIGHT_KINDS.indexOf(l.kind),
      l.on ? 1 : 0,
      Math.round(l.azimuth),
      Math.round(l.elevation),
      round1(l.distance),
      round2(l.intensity),
      Math.round(l.temperature),
      Math.round(l.softness),
      l.shadows ? 1 : 0,
      Math.round(l.spotAngle),
      round1(l.size),
    ]),
    c: [
      Math.round(scene.camera.focalMm),
      round1(scene.camera.exposureEv),
      scene.camera.toneMapping,
    ],
    mt: [
      scene.material.preset,
      scene.material.color,
      round2(scene.material.roughness),
      round2(scene.material.metalness),
    ],
    b: [
      scene.backdrop.preset,
      scene.backdrop.color,
      scene.backdrop.style,
      round2(scene.backdrop.shadowOpacity),
    ],
    q: scene.shadows.quality,
    ...(isNeutral(scene.pose.joints)
      ? {}
      : {
          po: [
            scene.pose.preset,
            flattenJoints(scene.pose.joints).map((v) => Math.round(v)),
          ],
        }),
  };
  return toBase64Url(JSON.stringify(payload));
}

export function decodeScene(param: string | null): SceneDoc | null {
  if (!param || param.length > 4096) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(param));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  if (!("v" in parsed)) return upgradeV1(param);
  if ((parsed as { v: unknown }).v !== 2) return null;
  const p = parsed as Record<string, unknown>;
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const bool = (v: unknown) => (v === 1 ? true : v === 0 ? false : v);
  const candidate = {
    version: 2,
    preset: p.p,
    model: p.m,
    lights: arr(p.l).map((row) => {
      const r = arr(row);
      return {
        id: r[0],
        label: r[1],
        kind: typeof r[2] === "number" ? LIGHT_KINDS[r[2]] : undefined,
        on: bool(r[3]),
        azimuth: r[4],
        elevation: r[5],
        distance: r[6],
        intensity: r[7],
        temperature: r[8],
        softness: r[9],
        shadows: bool(r[10]),
        spotAngle: r[11],
        size: r[12],
      };
    }),
    camera: {
      focalMm: arr(p.c)[0],
      exposureEv: arr(p.c)[1],
      toneMapping: arr(p.c)[2],
    },
    material: {
      preset: arr(p.mt)[0],
      color: arr(p.mt)[1],
      roughness: arr(p.mt)[2],
      metalness: arr(p.mt)[3],
    },
    backdrop: {
      preset: arr(p.b)[0],
      color: arr(p.b)[1],
      style: arr(p.b)[2],
      shadowOpacity: arr(p.b)[3],
    },
    shadows: { quality: p.q },
    ...("po" in p
      ? {
          pose: {
            preset: arr(p.po)[0],
            joints: unflattenJoints(arr(arr(p.po)[1])),
          },
        }
      : {}),
  };
  const checked = SceneSchema.safeParse(candidate);
  return checked.success ? checked.data : null;
}

function upgradeV1(param: string): SceneDoc | null {
  const legacy = decodeSetup(param);
  if (!legacy) return null;
  // A v1 link only names a preset while its lights are unedited, and v1
  // rounds intensity to 0.1 (Rembrandt's 0.35 fill came back as 0.4),
  // so restore the preset's exact lights rather than the rounded copy.
  const exact = legacy.preset === "custom" ? null : presetLights(legacy.preset);
  return {
    ...defaultScene(),
    preset: legacy.preset,
    lights: exact ?? legacy.lights.map(fromLegacyLight),
  };
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(param: string): string {
  const base64 = param.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(bin, (c) => c.charCodeAt(0)),
  );
}
