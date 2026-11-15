/** Sculpting brushes: each dab moves the clay's vertices near a point on
 * its surface, weighted by a smooth falloff to the brush's edge.
 *
 * A stroke is a run of dabs (the pointer dragged across the surface);
 * it remembers each vertex's position from before its first touch, so
 * the whole stroke is one undo step. Symmetry repeats each dab mirrored
 * across x = 0; vertices the first dab moved are left to it, so the
 * middle line isn't moved twice. Pure maths on SculptMesh: tested in
 * Node. */

import { updateNormals, type SculptMesh } from "./mesh";

export const BRUSHES = [
  "draw",
  "clay",
  "inflate",
  "smooth",
  "flatten",
  "pinch",
  "grab",
] as const;
export type BrushId = (typeof BRUSHES)[number];

export const BRUSH_INFO: Record<BrushId, { name: string; note: string }> = {
  draw: { name: "Draw", note: "Raise the surface (or dig in, subtracting)." },
  clay: {
    name: "Clay",
    note: "Build up flat layers, like adding strips of clay.",
  },
  inflate: { name: "Inflate", note: "Swell outward (or shrink) evenly." },
  smooth: { name: "Smooth", note: "Even out bumps and rough strokes." },
  flatten: { name: "Flatten", note: "Press the surface towards a flat plane." },
  pinch: { name: "Pinch", note: "Pull towards the stroke, for sharp creases." },
  grab: { name: "Grab", note: "Drag a whole region to reshape it." },
};

export interface BrushSettings {
  /** Brush radius on the surface, in metres. */
  radius: number;
  /** 0..1. */
  strength: number;
  /** Subtract: dig instead of raise, shrink instead of swell. */
  invert: boolean;
  /** Mirror across x = 0 (the model's left and right). */
  symmetry: boolean;
}

/** Where a dab lands: a point on the surface and its normal there; with
 * a pen, how hard it's pressed (0..1; 1 with a mouse or finger). */
export interface Dab {
  point: [number, number, number];
  normal: [number, number, number];
  pressure?: number;
}

/** 1 at the centre, 0 at the edge, smooth at both. */
export const falloff = (t: number) => (t >= 1 ? 0 : (1 - t * t) ** 2);

/** One stroke's undo record: the vertices it moved, before and after. */
export interface StrokeRecord {
  indices: Uint32Array;
  before: Float32Array;
  after: Float32Array;
}

export class Stroke {
  private slot = new Map<number, number>();
  private before: number[] = [];

  /** Keep `v`'s position from before the stroke first moved it. */
  remember(mesh: SculptMesh, v: number): void {
    if (this.slot.has(v)) return;
    this.slot.set(v, this.before.length / 3);
    const p = mesh.positions;
    this.before.push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
  }

  get size(): number {
    return this.slot.size;
  }

  /** Null if nothing moved. */
  finish(mesh: SculptMesh): StrokeRecord | null {
    if (!this.slot.size) return null;
    const indices = Uint32Array.from(this.slot.keys());
    const after = new Float32Array(indices.length * 3);
    indices.forEach((v, i) => {
      after[i * 3] = mesh.positions[v * 3];
      after[i * 3 + 1] = mesh.positions[v * 3 + 1];
      after[i * 3 + 2] = mesh.positions[v * 3 + 2];
    });
    return { indices, before: Float32Array.from(this.before), after };
  }
}

/** Put a stroke's vertices back as they were ("before") or redo it. */
export function applyRecord(
  mesh: SculptMesh,
  rec: StrokeRecord,
  which: "before" | "after",
): Uint32Array {
  const src = rec[which];
  rec.indices.forEach((v, i) => {
    mesh.positions[v * 3] = src[i * 3];
    mesh.positions[v * 3 + 1] = src[i * 3 + 1];
    mesh.positions[v * 3 + 2] = src[i * 3 + 2];
  });
  const ring = withNeighbors(mesh, rec.indices);
  updateNormals(mesh, ring);
  return ring;
}

/** The vertices and every neighbour of theirs: whose normals a move
 * changes. */
export function withNeighbors(
  mesh: SculptMesh,
  vertices: ArrayLike<number>,
): Uint32Array {
  const set = new Set<number>();
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    set.add(v);
    for (let j = mesh.neighborStart[v]; j < mesh.neighborStart[v + 1]; j++)
      set.add(mesh.neighbors[j]);
  }
  return Uint32Array.from(set);
}

interface Gathered {
  indices: number[];
  weights: number[];
}

/** Vertices within `radius` of `c`, with their falloff weights; those
 * in `skip` left out. */
function gather(
  mesh: SculptMesh,
  c: readonly number[],
  radius: number,
  skip?: Set<number>,
): Gathered {
  const p = mesh.positions;
  const r2 = radius * radius;
  const indices: number[] = [];
  const weights: number[] = [];
  for (let v = 0, i = 0; i < p.length; v++, i += 3) {
    const dx = p[i] - c[0];
    const dy = p[i + 1] - c[1];
    const dz = p[i + 2] - c[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r2 || skip?.has(v)) continue;
    indices.push(v);
    weights.push(falloff(Math.sqrt(d2) / radius));
  }
  return { indices, weights };
}

/** The weighted average position and normal under the brush: the plane
 * that clay, flatten and draw work against. */
function areaPlane(mesh: SculptMesh, g: Gathered, fallback: readonly number[]) {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let total = 0;
  g.indices.forEach((v, i) => {
    const w = g.weights[i];
    cx += mesh.positions[v * 3] * w;
    cy += mesh.positions[v * 3 + 1] * w;
    cz += mesh.positions[v * 3 + 2] * w;
    nx += mesh.normals[v * 3] * w;
    ny += mesh.normals[v * 3 + 1] * w;
    nz += mesh.normals[v * 3 + 2] * w;
    total += w;
  });
  const len = Math.hypot(nx, ny, nz);
  return {
    c: total ? [cx / total, cy / total, cz / total] : [...fallback],
    n: len ? [nx / len, ny / len, nz / len] : [...fallback],
  };
}

/** One dab of `brush` (not grab: see startGrab). Moves vertices in place
 * and returns those whose normals need updating (already updated). */
export function applyDab(
  mesh: SculptMesh,
  brush: Exclude<BrushId, "grab">,
  dab: Dab,
  s: BrushSettings,
  stroke: Stroke,
): Uint32Array {
  const moved: number[] = [];
  const first = dabOnce(mesh, brush, dab.point, dab.normal, dab, s, stroke);
  moved.push(...first);
  if (s.symmetry && Math.abs(dab.point[0]) > 1e-6) {
    const mirrored = dabOnce(
      mesh,
      brush,
      [-dab.point[0], dab.point[1], dab.point[2]],
      [-dab.normal[0], dab.normal[1], dab.normal[2]],
      dab,
      s,
      stroke,
      new Set(first),
    );
    moved.push(...mirrored);
  }
  const ring = withNeighbors(mesh, moved);
  updateNormals(mesh, ring);
  return ring;
}

function dabOnce(
  mesh: SculptMesh,
  brush: Exclude<BrushId, "grab">,
  point: readonly number[],
  normal: readonly number[],
  dab: Dab,
  s: BrushSettings,
  stroke: Stroke,
  skip?: Set<number>,
): number[] {
  const g = gather(mesh, point, s.radius, skip);
  if (!g.indices.length) return [];
  const p = mesh.positions;
  const sign = s.invert ? -1 : 1;
  const k = s.strength * (dab.pressure ?? 1);
  const r = s.radius;
  for (const v of g.indices) stroke.remember(mesh, v);

  if (brush === "smooth") {
    // Towards the average of the neighbours, all read before any moves.
    const targets = g.indices.map((v) => {
      let x = 0;
      let y = 0;
      let z = 0;
      const a = mesh.neighborStart[v];
      const b = mesh.neighborStart[v + 1];
      for (let j = a; j < b; j++) {
        const w = mesh.neighbors[j] * 3;
        x += p[w];
        y += p[w + 1];
        z += p[w + 2];
      }
      const n = b - a || 1;
      return [x / n, y / n, z / n];
    });
    g.indices.forEach((v, i) => {
      const t = Math.min(1, g.weights[i] * k);
      for (let a = 0; a < 3; a++)
        p[v * 3 + a] += (targets[i][a] - p[v * 3 + a]) * t;
    });
    return g.indices;
  }

  const { c, n } = areaPlane(mesh, g, normal);
  g.indices.forEach((v, i) => {
    const w = g.weights[i] * k;
    const o = v * 3;
    switch (brush) {
      case "draw": {
        const d = sign * r * 0.06 * w;
        p[o] += n[0] * d;
        p[o + 1] += n[1] * d;
        p[o + 2] += n[2] * d;
        break;
      }
      case "inflate": {
        const d = sign * r * 0.05 * w;
        p[o] += mesh.normals[o] * d;
        p[o + 1] += mesh.normals[o + 1] * d;
        p[o + 2] += mesh.normals[o + 2] * d;
        break;
      }
      case "clay": {
        // A plane a little above (or below) the surface; points only
        // move towards it, so strokes build up flat layers.
        const off = sign * r * 0.08;
        const h =
          (p[o] - c[0]) * n[0] +
          (p[o + 1] - c[1]) * n[1] +
          (p[o + 2] - c[2]) * n[2] -
          off;
        if (sign * h >= 0) break;
        const d = -h * Math.min(1, w * 0.5);
        p[o] += n[0] * d;
        p[o + 1] += n[1] * d;
        p[o + 2] += n[2] * d;
        break;
      }
      case "flatten": {
        const h =
          (p[o] - c[0]) * n[0] +
          (p[o + 1] - c[1]) * n[1] +
          (p[o + 2] - c[2]) * n[2];
        const d = -h * Math.min(1, w * 0.5);
        p[o] += n[0] * d;
        p[o + 1] += n[1] * d;
        p[o + 2] += n[2] * d;
        break;
      }
      case "pinch": {
        // Towards the brush centre, along the surface only.
        let tx = point[0] - p[o];
        let ty = point[1] - p[o + 1];
        let tz = point[2] - p[o + 2];
        const along = tx * n[0] + ty * n[1] + tz * n[2];
        tx -= n[0] * along;
        ty -= n[1] * along;
        tz -= n[2] * along;
        const t = sign * Math.min(0.5, w * 0.25);
        p[o] += tx * t;
        p[o + 1] += ty * t;
        p[o + 2] += tz * t;
        break;
      }
    }
  });
  return g.indices;
}

/** A grab in progress: the region caught at the start, which follows
 * the pointer by its weights. */
export interface Grab {
  indices: number[];
  weights: number[];
  origins: Float32Array;
  /** Mirrored across x = 0: moves with x flipped. */
  mirrored: boolean[];
}

export function startGrab(
  mesh: SculptMesh,
  dab: Dab,
  s: BrushSettings,
  stroke: Stroke,
): Grab {
  const first = gather(mesh, dab.point, s.radius);
  const mirroredOn = s.symmetry && Math.abs(dab.point[0]) > 1e-6;
  const second = mirroredOn
    ? gather(
        mesh,
        [-dab.point[0], dab.point[1], dab.point[2]],
        s.radius,
        new Set(first.indices),
      )
    : { indices: [], weights: [] };
  const indices = [...first.indices, ...second.indices];
  const k = s.strength * (dab.pressure ?? 1);
  const weights = [...first.weights, ...second.weights].map((w) =>
    Math.min(1, w * (0.5 + k)),
  );
  const origins = new Float32Array(indices.length * 3);
  indices.forEach((v, i) => {
    stroke.remember(mesh, v);
    origins[i * 3] = mesh.positions[v * 3];
    origins[i * 3 + 1] = mesh.positions[v * 3 + 1];
    origins[i * 3 + 2] = mesh.positions[v * 3 + 2];
  });
  return {
    indices,
    weights,
    origins,
    mirrored: indices.map((_, i) => i >= first.indices.length),
  };
}

/** Move a grab by `delta` (metres) from where it started. */
export function moveGrab(
  mesh: SculptMesh,
  grab: Grab,
  delta: readonly [number, number, number],
): Uint32Array {
  grab.indices.forEach((v, i) => {
    const w = grab.weights[i];
    const dx = grab.mirrored[i] ? -delta[0] : delta[0];
    mesh.positions[v * 3] = grab.origins[i * 3] + dx * w;
    mesh.positions[v * 3 + 1] = grab.origins[i * 3 + 1] + delta[1] * w;
    mesh.positions[v * 3 + 2] = grab.origins[i * 3 + 2] + delta[2] * w;
  });
  const ring = withNeighbors(mesh, grab.indices);
  updateNormals(mesh, ring);
  return ring;
}
