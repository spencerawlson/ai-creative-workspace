/** The clay: a triangle mesh with welded vertices, each vertex's
 * neighbours and faces (for smoothing and normals), kept as flat typed
 * arrays so brushes can change thousands of vertices per frame and the
 * renderer can draw the same arrays directly.
 *
 * Pure data and maths: no renderer, so it's tested in Node. */

export interface SculptMesh {
  /** x, y, z per vertex; brushes change these in place. */
  positions: Float32Array;
  /** Unit vertex normals, area-weighted from the faces around. */
  normals: Float32Array;
  /** Three vertex indices per triangle. */
  index: Uint32Array;
  /** Vertex v's neighbours are neighbors[neighborStart[v] ..
   * neighborStart[v + 1]] (compressed rows). */
  neighborStart: Uint32Array;
  neighbors: Uint32Array;
  /** Vertex v's faces, the same way. */
  faceStart: Uint32Array;
  faces: Uint32Array;
}

export const vertexCount = (m: SculptMesh) => m.positions.length / 3;
export const faceCount = (m: SculptMesh) => m.index.length / 3;

/** Weld corners that sit at the same place (to `precision` metres), so
 * separate triangles become one connected surface. */
export function weld(
  positions: ArrayLike<number>,
  index?: ArrayLike<number> | null,
  precision = 1e-5,
): { positions: Float32Array; index: Uint32Array } {
  const corners = index ? index.length : positions.length / 3;
  const ids = new Map<string, number>();
  const out: number[] = [];
  const remap = new Uint32Array(positions.length / 3);
  const q = (v: number) => Math.round(v / precision);
  for (let v = 0; v < positions.length / 3; v++) {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    const key = `${q(x)},${q(y)},${q(z)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = out.length / 3;
      ids.set(key, id);
      out.push(x, y, z);
    }
    remap[v] = id;
  }
  const tris: number[] = [];
  for (let c = 0; c + 2 < corners; c += 3) {
    const a = remap[index ? index[c] : c];
    const b = remap[index ? index[c + 1] : c + 1];
    const d = remap[index ? index[c + 2] : c + 2];
    // Welding can collapse a sliver to a line: drop it.
    if (a !== b && b !== d && a !== d) tris.push(a, b, d);
  }
  return { positions: new Float32Array(out), index: Uint32Array.from(tris) };
}

/** Build the clay from welded positions and triangles. */
export function buildMesh(
  positions: Float32Array,
  index: Uint32Array,
): SculptMesh {
  const n = positions.length / 3;
  const faceCounts = new Uint32Array(n + 1);
  for (let c = 0; c < index.length; c++) faceCounts[index[c] + 1]++;
  const faceStart = new Uint32Array(n + 1);
  for (let v = 0; v < n; v++)
    faceStart[v + 1] = faceStart[v] + faceCounts[v + 1];
  const faces = new Uint32Array(index.length);
  const fill = faceStart.slice(0, n);
  for (let f = 0; f < index.length / 3; f++)
    for (let k = 0; k < 3; k++) faces[fill[index[f * 3 + k]]++] = f;

  // Neighbours: the other corners of each face around, without repeats.
  const lists: number[][] = Array.from({ length: n }, () => []);
  for (let v = 0; v < n; v++) {
    const seen = new Set<number>();
    for (let i = faceStart[v]; i < faceStart[v + 1]; i++) {
      const f = faces[i];
      for (let k = 0; k < 3; k++) {
        const w = index[f * 3 + k];
        if (w !== v && !seen.has(w)) {
          seen.add(w);
          lists[v].push(w);
        }
      }
    }
  }
  const neighborStart = new Uint32Array(n + 1);
  for (let v = 0; v < n; v++)
    neighborStart[v + 1] = neighborStart[v] + lists[v].length;
  const neighbors = new Uint32Array(neighborStart[n]);
  for (let v = 0; v < n; v++) neighbors.set(lists[v], neighborStart[v]);

  const mesh: SculptMesh = {
    positions,
    normals: new Float32Array(positions.length),
    index,
    neighborStart,
    neighbors,
    faceStart,
    faces,
  };
  updateNormals(mesh);
  return mesh;
}

/** Recompute the normals of `vertices` (all when omitted) from the
 * faces around each: the faces' cross products, so bigger faces count
 * more. */
export function updateNormals(
  mesh: SculptMesh,
  vertices?: ArrayLike<number>,
): void {
  const { positions: p, normals, index, faceStart, faces } = mesh;
  const n = p.length / 3;
  const count = vertices ? vertices.length : n;
  for (let i = 0; i < count; i++) {
    const v = vertices ? vertices[i] : i;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let j = faceStart[v]; j < faceStart[v + 1]; j++) {
      const f = faces[j] * 3;
      const a = index[f] * 3;
      const b = index[f + 1] * 3;
      const c = index[f + 2] * 3;
      const ux = p[b] - p[a];
      const uy = p[b + 1] - p[a + 1];
      const uz = p[b + 2] - p[a + 2];
      const wx = p[c] - p[a];
      const wy = p[c + 1] - p[a + 1];
      const wz = p[c + 2] - p[a + 2];
      nx += uy * wz - uz * wy;
      ny += uz * wx - ux * wz;
      nz += ux * wy - uy * wx;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    normals[v * 3] = nx / len;
    normals[v * 3 + 1] = ny / len;
    normals[v * 3 + 2] = nz / len;
  }
}

/** The triangles as a flat list of corners (for STL export). */
export function triangles(mesh: SculptMesh): Float32Array {
  const out = new Float32Array(mesh.index.length * 3);
  for (let c = 0; c < mesh.index.length; c++) {
    const v = mesh.index[c] * 3;
    out[c * 3] = mesh.positions[v];
    out[c * 3 + 1] = mesh.positions[v + 1];
    out[c * 3 + 2] = mesh.positions[v + 2];
  }
  return out;
}
