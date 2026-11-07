/** three.js's tone mapping curves (r170, tonemapping_pars_fragment), in
 * JavaScript, and their inverse for a colour.
 *
 * The plain render clears the canvas to the backdrop colour as is; the
 * effects path (lib/engine/post.ts) tone-maps the whole frame, backdrop
 * included, which would darken it. Clearing to `untoneMap(colour)`
 * instead makes both paths show the same backdrop. */

export type ToneCurve = "aces" | "agx" | "neutral";
type V3 = [number, number, number];

/** A GLSL mat3 (three columns) times a vector. */
const mul = (m: [V3, V3, V3], v: V3): V3 => [
  m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
  m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
  m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const ACES_IN: [V3, V3, V3] = [
  [0.59719, 0.076, 0.0284],
  [0.35458, 0.90834, 0.13383],
  [0.04823, 0.01566, 0.83777],
];
const ACES_OUT: [V3, V3, V3] = [
  [1.60475, -0.10208, -0.00327],
  [-0.53108, 1.10813, -0.07276],
  [-0.07367, -0.00605, 1.07602],
];
const rrt = (v: number) =>
  (v * (v + 0.0245786) - 0.000090537) /
  (v * (0.983729 * v + 0.432951) + 0.238081);

function aces(c: V3, exposure: number): V3 {
  const v = mul(ACES_IN, c.map((x) => (x * exposure) / 0.6) as V3);
  return mul(ACES_OUT, v.map(rrt) as V3).map(clamp01) as V3;
}

const SRGB_TO_2020: [V3, V3, V3] = [
  [0.6274, 0.0691, 0.0164],
  [0.3293, 0.9195, 0.088],
  [0.0433, 0.0113, 0.8956],
];
const REC2020_TO_SRGB: [V3, V3, V3] = [
  [1.6605, -0.1246, -0.0182],
  [-0.5876, 1.1329, -0.1006],
  [-0.0728, -0.0083, 1.1187],
];
const AGX_INSET: [V3, V3, V3] = [
  [0.856627153315983, 0.137318972929847, 0.11189821299995],
  [0.0951212405381588, 0.761241990602591, 0.0767994186031903],
  [0.0482516061458583, 0.101439036467562, 0.811302368396859],
];
const AGX_OUTSET: [V3, V3, V3] = [
  [1.1271005818144368, -0.1413297634984383, -0.14132976349843826],
  [-0.11060664309660323, 1.157823702216272, -0.11060664309660294],
  [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405],
];
const AGX_MIN = -12.47393;
const AGX_MAX = 4.026069;
const agxCurve = (x: number) => {
  const x2 = x * x;
  const x4 = x2 * x2;
  return (
    15.5 * x4 * x2 -
    40.14 * x4 * x +
    31.96 * x4 -
    6.868 * x2 * x +
    0.4298 * x2 +
    0.1191 * x -
    0.00232
  );
};

function agx(c: V3, exposure: number): V3 {
  let v = mul(SRGB_TO_2020, c.map((x) => x * exposure) as V3);
  v = mul(AGX_INSET, v);
  v = v.map((x) =>
    agxCurve(
      clamp01((Math.log2(Math.max(x, 1e-10)) - AGX_MIN) / (AGX_MAX - AGX_MIN)),
    ),
  ) as V3;
  v = mul(AGX_OUTSET, v).map((x) => Math.max(0, x) ** 2.2) as V3;
  return mul(REC2020_TO_SRGB, v).map(clamp01) as V3;
}

function neutral(c: V3, exposure: number): V3 {
  const start = 0.8 - 0.04;
  const desaturation = 0.15;
  let v = c.map((x) => x * exposure) as V3;
  const x = Math.min(...v);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  v = v.map((y) => y - offset) as V3;
  const peak = Math.max(...v);
  if (peak < start) return v;
  const d = 1 - start;
  const newPeak = 1 - (d * d) / (peak + d - start);
  v = v.map((y) => (y * newPeak) / peak) as V3;
  const g = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  return v.map((y) => y + (newPeak - y) * g) as V3;
}

/** A linear colour as the renderer's tone mapping shows it. */
export function toneMap(c: V3, curve: ToneCurve, exposure: number): V3 {
  return curve === "aces"
    ? aces(c, exposure)
    : curve === "agx"
      ? agx(c, exposure)
      : neutral(c, exposure);
}

/** Solve a 3×3 system (columns `m`) for x in m·x = b; null if singular. */
function solve(m: [V3, V3, V3], b: V3): V3 | null {
  const det = (a: V3, b2: V3, c: V3) =>
    a[0] * (b2[1] * c[2] - b2[2] * c[1]) -
    b2[0] * (a[1] * c[2] - a[2] * c[1]) +
    c[0] * (a[1] * b2[2] - a[2] * b2[1]);
  const d = det(m[0], m[1], m[2]);
  if (Math.abs(d) < 1e-12) return null;
  return [
    det(b, m[1], m[2]) / d,
    det(m[0], b, m[2]) / d,
    det(m[0], m[1], b) / d,
  ];
}

/** The linear colour that tone-maps to `target` (as near as the curve
 * allows: it can't reach pure white, nor colours outside its gamut).
 * Damped Newton's method on the full curve, channels mixing included. */
export function untoneMap(target: V3, curve: ToneCurve, exposure: number): V3 {
  const f = (c: V3) => toneMap(c, curve, exposure);
  const err = (t: V3) => t.reduce((s, v, k) => s + (v - target[k]) ** 2, 0);
  let c = target.map((x) => Math.max(x, 1e-4)) as V3;
  let t = f(c);
  for (let i = 0; i < 60 && err(t) > 1e-14; i++) {
    const cols = [0, 1, 2].map((k) => {
      const h = Math.max(1e-6, c[k] * 1e-4);
      const up = [...c] as V3;
      up[k] += h;
      return f(up).map((v, j) => (v - t[j]) / h) as V3;
    }) as [V3, V3, V3];
    const step = solve(cols, target.map((v, k) => v - t[k]) as V3);
    if (!step) break;
    // Halve the step until it helps; stay in [0, 64].
    let s = 1;
    for (; s > 1e-4; s /= 2) {
      const next = c.map((x, k) =>
        Math.min(64, Math.max(0, x + s * step[k])),
      ) as V3;
      const tn = f(next);
      if (err(tn) < err(t)) {
        c = next;
        t = tn;
        break;
      }
    }
    if (s <= 1e-4) break;
  }
  return c;
}
