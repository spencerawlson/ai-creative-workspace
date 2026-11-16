/** UV unwrapping for export: the clay laid out flat in texture space, so
 * its look can be baked into images game engines and 3D tools read.
 *
 * Done here, simply and predictably (a lightmap-style layout):
 * 1. Each triangle goes to the one of six directions (±x, ±y, ±z) it
 *    faces most; triangles of one direction that touch form a chart.
 * 2. A chart is flattened by projecting it along its direction. Every
 *    triangle in it faces within about 55° of that, so the stretch stays
 *    small (at most 1/cos 55°, about 1.7×).
 * 3. A chart whose triangles land on top of each other (a surface that
 *    folds back, as sculpting can make) is split until none do.
 * 4. Charts are packed into the square texture, all at one scale (the
 *    largest that fits), with padding between them.
 * No overlap anywhere, which the tests check. */

export interface Unwrapped {
  /** u, v per vertex (0..1; v = 0 at the image's top row, as glTF). */
  uvs: Float32Array;
  /** Each new vertex's vertex in the clay (a chart's edge duplicates). */
  original: Uint32Array;
  /** Triangles over the new vertices. */
  index: Uint32Array;
  /** How many charts the surface was cut into. */
  charts: number;
}

/** A chart: its triangles and their projected corners (metres). */
interface Chart {
  tris: number[];
  /** Per triangle: u0, v0, u1, v1, u2, v2. */
  uv: number[];
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
}

/** Which way each triangle faces most: 0..5 for +x, -x, +y, -y, +z, -z. */
function directions(positions: ArrayLike<number>, index: ArrayLike<number>) {
  const t = index.length / 3;
  const dir = new Uint8Array(t);
  for (let f = 0; f < t; f++) {
    const a = index[f * 3] * 3;
    const b = index[f * 3 + 1] * 3;
    const c = index[f * 3 + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    dir[f] =
      ax >= ay && ax >= az
        ? nx >= 0
          ? 0
          : 1
        : ay >= az
          ? ny >= 0
            ? 2
            : 3
          : nz >= 0
            ? 4
            : 5;
  }
  return dir;
}

/** A point projected along direction `d`, keeping the chart's winding
 * the same way round for every direction. */
function project(d: number, x: number, y: number, z: number): [number, number] {
  switch (d) {
    case 0:
      return [-z, y];
    case 1:
      return [z, y];
    case 2:
      return [x, -z];
    case 3:
      return [x, z];
    case 4:
      return [x, y];
    default:
      return [-x, y];
  }
}

/** Groups of touching triangles (sharing an edge) with the same
 * direction. */
function components(index: ArrayLike<number>, dir: Uint8Array): number[][] {
  const t = index.length / 3;
  const byEdge = new Map<string, number[]>();
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (let f = 0; f < t; f++)
    for (let k = 0; k < 3; k++) {
      const e = key(index[f * 3 + k], index[f * 3 + ((k + 1) % 3)]);
      const list = byEdge.get(e);
      if (list) list.push(f);
      else byEdge.set(e, [f]);
    }
  const seen = new Uint8Array(t);
  const out: number[][] = [];
  for (let s = 0; s < t; s++) {
    if (seen[s]) continue;
    seen[s] = 1;
    const group = [s];
    for (let i = 0; i < group.length; i++) {
      const f = group[i];
      for (let k = 0; k < 3; k++) {
        const e = key(index[f * 3 + k], index[f * 3 + ((k + 1) % 3)]);
        for (const g of byEdge.get(e)!)
          if (!seen[g] && dir[g] === dir[f]) {
            seen[g] = 1;
            group.push(g);
          }
      }
    }
    out.push(group);
  }
  return out;
}

function makeChart(
  tris: number[],
  d: number,
  positions: ArrayLike<number>,
  index: ArrayLike<number>,
): Chart {
  const uv: number[] = [];
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const f of tris)
    for (let k = 0; k < 3; k++) {
      const v = index[f * 3 + k] * 3;
      const [u, w] = project(
        d,
        positions[v],
        positions[v + 1],
        positions[v + 2],
      );
      uv.push(u, w);
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (w < minV) minV = w;
      if (w > maxV) maxV = w;
    }
  return { tris, uv, minU, minV, maxU, maxV };
}

/** Twice the signed area of a 2D triangle. */
const cross = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

/** Whether two 2D triangles' insides overlap (touching edges don't).
 * Separating-axis test on their six edges, with a small tolerance. */
export function trianglesOverlap(a: number[], b: number[]): boolean {
  const eps = 1e-12;
  for (const [p, q] of [
    [a, b],
    [b, a],
  ]) {
    const o = cross(p[0], p[1], p[2], p[3], p[4], p[5]) >= 0 ? 1 : -1;
    for (let k = 0; k < 3; k++) {
      const x0 = p[k * 2];
      const y0 = p[k * 2 + 1];
      const x1 = p[((k + 1) % 3) * 2];
      const y1 = p[((k + 1) % 3) * 2 + 1];
      // q entirely on the outer side of this edge (or on it): separate.
      let outside = true;
      for (let j = 0; j < 3 && outside; j++)
        if (o * cross(x0, y0, x1, y1, q[j * 2], q[j * 2 + 1]) > eps)
          outside = false;
      if (outside) return false;
    }
  }
  return true;
}

/** Pairs of triangles in a chart that overlap and share no corner. */
function hasOverlap(c: Chart, index: ArrayLike<number>): boolean {
  const n = c.tris.length;
  const w = Math.max(c.maxU - c.minU, 1e-9);
  const h = Math.max(c.maxV - c.minV, 1e-9);
  const cells = Math.max(1, Math.ceil(Math.sqrt(n)));
  const grid = new Map<number, number[]>();
  const tri = (i: number) => c.uv.slice(i * 6, i * 6 + 6);
  for (let i = 0; i < n; i++) {
    const t = tri(i);
    const x0 = Math.floor(((Math.min(t[0], t[2], t[4]) - c.minU) / w) * cells);
    const x1 = Math.floor(((Math.max(t[0], t[2], t[4]) - c.minU) / w) * cells);
    const y0 = Math.floor(((Math.min(t[1], t[3], t[5]) - c.minV) / h) * cells);
    const y1 = Math.floor(((Math.max(t[1], t[3], t[5]) - c.minV) / h) * cells);
    for (let gx = x0; gx <= x1; gx++)
      for (let gy = y0; gy <= y1; gy++) {
        const k = gy * (cells + 1) + gx;
        const list = grid.get(k);
        if (list) {
          for (const j of list) {
            const fi = c.tris[i];
            const fj = c.tris[j];
            let shared = false;
            for (let a = 0; a < 3 && !shared; a++)
              for (let b = 0; b < 3 && !shared; b++)
                if (index[fi * 3 + a] === index[fj * 3 + b]) shared = true;
            if (!shared && trianglesOverlap(t, tri(j))) return true;
          }
          list.push(i);
        } else grid.set(k, [i]);
      }
  }
  return false;
}

/** Split a chart in two across its longer side (by triangle centre). */
function halve(c: Chart): [number[], number[]] {
  const alongU = c.maxU - c.minU >= c.maxV - c.minV;
  const mid = alongU ? (c.minU + c.maxU) / 2 : (c.minV + c.maxV) / 2;
  const a: number[] = [];
  const b: number[] = [];
  c.tris.forEach((f, i) => {
    const centre = alongU
      ? (c.uv[i * 6] + c.uv[i * 6 + 2] + c.uv[i * 6 + 4]) / 3
      : (c.uv[i * 6 + 1] + c.uv[i * 6 + 3] + c.uv[i * 6 + 5]) / 3;
    (centre < mid ? a : b).push(f);
  });
  if (!a.length || !b.length) {
    const half = c.tris.length >> 1;
    return [c.tris.slice(0, half), c.tris.slice(half)];
  }
  return [a, b];
}

/** Shelf packing of rectangles (w, h) into a width-1 strip; returns each
 * one's corner and the strip's height. Tallest first. */
function shelfPack(
  sizes: Array<[number, number]>,
  gap: number,
): { at: Array<[number, number]>; height: number } {
  const order = sizes
    .map((_, i) => i)
    .sort((i, j) => sizes[j][1] - sizes[i][1]);
  const at: Array<[number, number]> = new Array(sizes.length);
  let x = gap;
  let y = gap;
  let shelf = 0;
  for (const i of order) {
    const [w, h] = sizes[i];
    if (x + w + gap > 1 && x > gap) {
      y += shelf + gap;
      x = gap;
      shelf = 0;
    }
    at[i] = [x, y];
    x += w + gap;
    shelf = Math.max(shelf, h);
  }
  return { at, height: y + shelf + gap };
}

/** Unwrap triangles (`positions`: x, y, z per vertex) for a square
 * texture `resolution` texels wide, `padding` texels between charts. */
export function unwrap(
  positions: ArrayLike<number>,
  index: ArrayLike<number>,
  { resolution = 2048, padding = 4 } = {},
): Unwrapped {
  const dir = directions(positions, index);
  const charts: Chart[] = [];
  const pending = components(index, dir).map((tris) => ({
    tris,
    d: dir[tris[0]],
  }));
  while (pending.length) {
    const { tris, d } = pending.pop()!;
    const c = makeChart(tris, d, positions, index);
    if (tris.length > 1 && hasOverlap(c, index)) {
      for (const half of halve(c)) pending.push({ tris: half, d });
    } else charts.push(c);
  }

  // One scale for every chart: the largest that packs into the square.
  const gap = padding / resolution;
  const fits = (scale: number) =>
    shelfPack(
      charts.map((c) => [(c.maxU - c.minU) * scale, (c.maxV - c.minV) * scale]),
      gap,
    ).height <= 1;
  let lo = 0;
  let hi = 1;
  while (fits(hi * 2)) hi *= 2;
  while (!fits(hi) && hi > 1e-9) hi /= 2;
  lo = hi;
  hi = hi * 2;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  const scale = lo;
  const { at } = shelfPack(
    charts.map((c) => [(c.maxU - c.minU) * scale, (c.maxV - c.minV) * scale]),
    gap,
  );

  // New vertices: one per (chart, clay vertex).
  const uvs: number[] = [];
  const original: number[] = [];
  const out: number[] = [];
  charts.forEach((c, ci) => {
    const local = new Map<number, number>();
    c.tris.forEach((f, i) => {
      for (let k = 0; k < 3; k++) {
        const v = index[f * 3 + k];
        let n = local.get(v);
        if (n === undefined) {
          n = original.length;
          local.set(v, n);
          original.push(v);
          uvs.push(
            at[ci][0] + (c.uv[i * 6 + k * 2] - c.minU) * scale,
            at[ci][1] + (c.uv[i * 6 + k * 2 + 1] - c.minV) * scale,
          );
        }
        out.push(n);
      }
    });
  });
  return {
    uvs: Float32Array.from(uvs),
    original: Uint32Array.from(original),
    index: Uint32Array.from(out),
    charts: charts.length,
  };
}
