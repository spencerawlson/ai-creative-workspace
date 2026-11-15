/** Colour for painting: paint is kept in sRGB (as a colour picker gives
 * it, and compact to save as bytes); lighting and glTF files work in
 * linear light. */

import { vertexCount, type SculptMesh } from "./mesh";

/** "#rrggbb" as sRGB values 0..1; grey for anything else. */
export function hexToSrgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.5, 0.5, 0.5];
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export const srgbToLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

/** Each vertex's colour as it shows: the material's colour (`base`,
 * linear) with the paint laid over it by its coverage. Linear, three
 * per vertex: a glTF file's vertex colours. */
export function bakeColors(
  mesh: SculptMesh,
  base: readonly [number, number, number],
): Float32Array {
  const n = vertexCount(mesh);
  const out = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const a = mesh.paint[v * 4 + 3];
    for (let c = 0; c < 3; c++)
      out[v * 3 + c] =
        base[c] * (1 - a) + srgbToLinear(mesh.paint[v * 4 + c]) * a;
  }
  return out;
}

/** Paint and mask as bytes, for saving (null when the layer is empty). */
export function packLayer(values: Float32Array, stride: number, alphaAt = 0) {
  let any = false;
  for (let i = alphaAt; i < values.length; i += stride)
    if (values[i] > 0) {
      any = true;
      break;
    }
  if (!any) return null;
  const out = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++)
    out[i] = Math.round(Math.min(1, Math.max(0, values[i])) * 255);
  return out;
}

export function unpackLayer(bytes: Uint8Array | undefined | null) {
  if (!bytes) return undefined;
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] / 255;
  return out;
}
