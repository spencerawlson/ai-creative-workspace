/** Share-link codec for full scenes (`?s=` param), version 2.
 *
 * v2 payload, base64url JSON with positional arrays to keep links short:
 *   { v: 2, p: preset, m: model,
 *     l: [[id, label, kind, on, az, el, dist, int, temp, soft, shadows, spot, size], ...],
 *     c: [focalMm, exposureEv, toneMapping, aperture, bloom, vignette,
 *         grain],
 *     mt: [preset, color, roughness, metalness],
 *     b: [preset, color, style, shadowOpacity],
 *     q: shadowQuality,
 *     po?: [posePreset, [joint angles in pose.ts order, whole degrees]],
 *     fg?: [[model, x, z, rotation, y?, posePreset?, [joint angles]?], ...],
 *     ch?: [characterId | null, ...] }  (one per fg row)
 *
 * `y` (up/down) is only written when it isn't 0; older rows have the
 * pose preset (a string) in that place.
 *
 * One figure standing in the centre facing the camera is written as
 * `m` (+ `po`, omitted for the scan's A-pose), exactly as before several
 * figures existed, so those links are unchanged and old links still
 * open. Anything else is written as `fg`, one row per figure.
 *
 * `ch` names each figure's imported character. The files stay on the
 * device that imported them, so elsewhere the mannequin stands in; on
 * that device a reload (which reopens the address) keeps them.
 *
 * Links made by M3 (v1: three lights, no `v`) still open: they are
 * decoded by the original strict v1 decoder and upgraded with defaults.
 * Decoding always ends in SceneSchema validation; anything malformed
 * returns null and the caller keeps its current scene.
 */

import { decodeSetup } from "@/lib/share";
import { defaultScene, fromLegacyLight, presetLights } from "./presets";
import { flattenJoints, isNeutral, unflattenJoints } from "./pose";
import {
  EASES,
  LIGHT_KINDS,
  SceneSchema,
  type Figure,
  type SceneDoc,
} from "./schema";

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Values are rounded so links stay short; rounding keeps them in range
 * because every range bound is itself a round number. */
export function encodeScene(scene: SceneDoc): string {
  return toBase64Url(JSON.stringify(scenePayload(scene)));
}

function scenePayload(scene: SceneDoc) {
  return {
    v: 2,
    p: scene.preset,
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
      round1(scene.camera.aperture),
      round2(scene.camera.bloom),
      round2(scene.camera.vignette),
      round2(scene.camera.grain),
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
    ...encodeFigures(scene.figures),
  };
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
  return decodePayload(parsed);
}

function decodePayload(parsed: object): SceneDoc | null {
  if ((parsed as { v: unknown }).v !== 2) return null;
  const p = parsed as Record<string, unknown>;
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const bool = (v: unknown) => (v === 1 ? true : v === 0 ? false : v);
  const candidate = {
    version: 2,
    preset: p.p,
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
      // Links from before the lens look have three values.
      aperture: arr(p.c)[3] ?? 0,
      bloom: arr(p.c)[4] ?? 0,
      vignette: arr(p.c)[5] ?? 0,
      grain: arr(p.c)[6] ?? 0,
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
    ...decodeFigures(p, arr),
    ...("an" in p
      ? {
          animation: decodeAnimation(
            p.an,
            arr,
            arr(p.l).map((row) => arr(row)[0]),
          ),
        }
      : {}),
  };
  const checked = SceneSchema.safeParse(candidate);
  return checked.success ? checked.data : null;
}

const poseRow = (f: Figure) =>
  isNeutral(f.pose.joints)
    ? []
    : [f.pose.preset, flattenJoints(f.pose.joints).map((v) => Math.round(v))];

function encodeFigures(figures: Figure[]) {
  const [only] = figures;
  const characters = figures.some((f) => f.character);
  if (
    figures.length === 1 &&
    !only.x &&
    !only.y &&
    !only.z &&
    !only.rotation &&
    !characters
  ) {
    const po = poseRow(only);
    return { m: only.model, ...(po.length ? { po } : {}) };
  }
  return {
    fg: figures.map((f) => [
      f.model,
      round2(f.x),
      round2(f.z),
      Math.round(f.rotation),
      ...(f.y ? [round2(f.y)] : []),
      ...poseRow(f),
    ]),
    ...(characters ? { ch: figures.map((f) => f.character ?? null) } : {}),
  };
}

function decodeFigures(
  p: Record<string, unknown>,
  arr: (v: unknown) => unknown[],
) {
  const pose = (preset: unknown, angles: unknown) => ({
    preset,
    joints: unflattenJoints(arr(angles)),
  });
  if ("fg" in p) {
    const ch = "ch" in p ? arr(p.ch) : [];
    return {
      figures: arr(p.fg).map((row, i) => {
        const r = arr(row);
        const lifted = typeof r[4] === "number";
        const at = lifted ? 5 : 4;
        return {
          id: `fig-${i + 1}`,
          model: r[0],
          x: r[1],
          z: r[2],
          rotation: r[3],
          ...(lifted ? { y: r[4] } : {}),
          ...(r.length > at ? { pose: pose(r[at], r[at + 1]) } : {}),
          ...(typeof ch[i] === "string" ? { character: ch[i] } : {}),
        };
      }),
    };
  }
  // One figure, old layout: SceneSchema upgrades `model` + `pose`.
  return {
    model: p.m,
    ...("po" in p ? { pose: pose(arr(p.po)[0], arr(p.po)[1]) } : {}),
  };
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

// --------------------------------------------------- animated share links

/** Links are kept well under the ~16 KB request-line limit of common
 * servers; a longer animation is shared as its current frame. */
export const MAX_LINK = 8000;
/** A link may not inflate to more than this (decompression bombs). */
const MAX_INFLATED = 256 * 1024;

/** Keyframes, positional and rounded like the rest of the link:
 *   an: [duration, [[t, ease, figures, lights, camera, tangents], ...], 2]
 * A figure row is [x, z, rotation, y, ...joint angles]; links from
 * before up/down existed have no trailing 2 and no `y` in the row.
 * figures/lights are rows aligned with the scene's own lists (0 where a
 * key doesn't record one); figure ids are renumbered fig-1.. in list
 * order, as the decoder names them. */
function encodeAnimation(scene: SceneDoc) {
  const ids = new Map(scene.figures.map((f, i) => [f.id, `fig-${i + 1}`]));
  const rename = (channel: string) =>
    channel.replace(/^fig-\d+/, (id) => ids.get(id) ?? id);
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return [
    scene.animation.duration,
    scene.animation.keys.map((k) => [
      k.t,
      k.ease ? EASES.indexOf(k.ease) : -1,
      scene.figures.map((f) => {
        const v = k.figures[f.id];
        return v
          ? [
              round2(v.x),
              round2(v.z),
              round1(v.rotation),
              round2(v.y),
              ...flattenJoints(v.joints).map(round1),
            ]
          : 0;
      }),
      scene.lights.map((l) => {
        const v = k.lights[l.id];
        return v
          ? [
              v.on ? 1 : 0,
              round1(v.azimuth),
              round1(v.elevation),
              round2(v.distance),
              round2(v.intensity),
              Math.round(v.temperature),
              round1(v.softness),
              round1(v.spotAngle),
              round2(v.size),
            ]
          : 0;
      }),
      k.camera
        ? [...k.camera.view.position, ...k.camera.view.target]
            .map(r3)
            .concat(k.camera.focalMm)
        : 0,
      k.tangents
        ? Object.entries(k.tangents).map(([ch, tg]) => [
            rename(ch),
            r3(tg.in),
            r3(tg.out),
            ...(tg.broken ? [1] : []),
          ])
        : 0,
    ]),
    2,
  ];
}

function decodeAnimation(
  an: unknown,
  arr: (v: unknown) => unknown[],
  /** The link's light ids, in order: key light rows are positional. */
  lightIds: unknown[],
) {
  const [duration, keys, format] = arr(an);
  const figureIds = (n: number) => `fig-${n + 1}`;
  return {
    duration,
    keys: arr(keys).map((row) => {
      const [t, ease, figs, lights, cam, tangents] = arr(row);
      return {
        t,
        ...(typeof ease === "number" && ease >= 0 ? { ease: EASES[ease] } : {}),
        figures: Object.fromEntries(
          arr(figs).flatMap((f, i) => {
            if (!Array.isArray(f)) return [];
            const [x, z, rotation, ...rest] = f;
            const [y, ...joints] = format === 2 ? rest : [0, ...rest];
            return [
              [
                figureIds(i),
                { x, y, z, rotation, joints: unflattenJoints(joints) },
              ],
            ];
          }),
        ),
        lights: Object.fromEntries(
          arr(lights).flatMap((l, i) => {
            if (!Array.isArray(l)) return [];
            return [
              [
                lightIds[i],
                {
                  on: l[0] === 1 ? true : l[0] === 0 ? false : l[0],
                  azimuth: l[1],
                  elevation: l[2],
                  distance: l[3],
                  intensity: l[4],
                  temperature: l[5],
                  softness: l[6],
                  spotAngle: l[7],
                  size: l[8],
                },
              ],
            ];
          }),
        ),
        ...(Array.isArray(cam)
          ? {
              camera: {
                view: { position: cam.slice(0, 3), target: cam.slice(3, 6) },
                focalMm: cam[6],
              },
            }
          : {}),
        ...(Array.isArray(tangents)
          ? {
              tangents: Object.fromEntries(
                tangents.map((tg) => {
                  const [ch, tin, tout, broken] = arr(tg);
                  return [
                    ch,
                    {
                      in: tin,
                      out: tout,
                      ...(broken === 1 ? { broken: true } : {}),
                    },
                  ];
                }),
              ),
            }
          : {}),
      };
    }),
  };
}

/** A share link for the scene: with keyframes, the animation goes in
 * too, compressed (`z` + base64url of deflate-raw JSON). Falls back to
 * the current frame when there are no keys or the result would be too
 * long for a URL. */
export async function encodeSceneLink(
  scene: SceneDoc,
): Promise<{ param: string; animated: boolean; tooLong: boolean }> {
  const plain = encodeScene(scene);
  if (scene.animation.keys.length === 0)
    return { param: plain, animated: false, tooLong: false };
  const json = JSON.stringify({
    ...scenePayload(scene),
    an: encodeAnimation(scene),
  });
  const param = "z" + bytesToBase64Url(await deflate(json));
  return param.length > MAX_LINK
    ? { param: plain, animated: false, tooLong: true }
    : { param, animated: true, tooLong: false };
}

/** Opens any share link: animated (`z…`), v2 or M3 v1. */
export async function decodeSceneLink(
  param: string | null,
): Promise<SceneDoc | null> {
  if (!param?.startsWith("z")) return decodeScene(param);
  if (param.length > MAX_LINK) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await inflate(base64UrlToBytes(param.slice(1))));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  return decodePayload(parsed);
}

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inflate, refusing to produce more than MAX_INFLATED bytes. */
async function inflate(bytes: Uint8Array): Promise<string> {
  const reader = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_INFLATED) {
      await reader.cancel();
      throw new Error("Link too large");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(all);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(text: string): Uint8Array {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
