/** UV unwrapping for export: the clay laid out flat in texture space, so
 * its look can be baked into images that game engines and 3D tools read.
 *
 * Done by xatlas (MIT), through a small interface so the same code drives
 * it in a web worker (the browser) or directly (Node, in tests). xatlas
 * takes at most 65,535 vertices per mesh (16-bit indices, in and out), so
 * larger clay is split into pieces unwrapped together into one atlas;
 * each piece's edge is a seam, as unwrapping makes anyway. */

/** The xatlas.js Api's methods we use: sync in Node, async (comlink)
 * through the worker. */
export interface XAtlas {
  createAtlas(): unknown;
  addMesh(
    indexes: Uint16Array,
    vertices: Float32Array,
    normals?: null,
    coords?: null,
    meshObj?: number,
  ): unknown;
  generateAtlas(
    chartOptions: object,
    packOptions: object,
    returnMeshes?: boolean,
  ): AtlasResult | Promise<AtlasResult>;
  destroyAtlas(): unknown;
}

export interface AtlasResult {
  width: number;
  height: number;
  atlasCount: number;
  meshes: Array<{
    mesh: number;
    vertexCount: number;
    index: Uint16Array;
    oldIndexes: Uint16Array;
    vertex: { coords1: Float32Array };
  }>;
}

/** Vertices per piece: under xatlas's 65,535, with room for the vertices
 * it adds along seams. */
export const PIECE_VERTICES = 40_000;

export interface Piece {
  /** Triangles, as indices into this piece's own vertices. */
  indexes: Uint16Array;
  /** Each piece vertex's vertex in the whole clay. */
  original: Uint32Array;
}

/** Split triangles into pieces of at most `max` vertices, in order (the
 * clay's triangles are roughly in surface order, so pieces are patches). */
export function splitForAtlas(
  index: ArrayLike<number>,
  max = PIECE_VERTICES,
): Piece[] {
  const pieces: Piece[] = [];
  let local = new Map<number, number>();
  let tris: number[] = [];
  const close = () => {
    if (!tris.length) return;
    const original = new Uint32Array(local.size);
    for (const [v, i] of local) original[i] = v;
    pieces.push({ indexes: Uint16Array.from(tris), original });
    local = new Map();
    tris = [];
  };
  for (let t = 0; t + 2 < index.length; t += 3) {
    const corners = [index[t], index[t + 1], index[t + 2]];
    const fresh = corners.filter((v) => !local.has(v)).length;
    if (local.size + fresh > max) close();
    for (const v of corners) {
      let i = local.get(v);
      if (i === undefined) {
        i = local.size;
        local.set(v, i);
      }
      tris.push(i);
    }
  }
  close();
  return pieces;
}

export interface Unwrapped {
  /** u, v per vertex (0..1; v = 0 at the image's top row, as glTF). */
  uvs: Float32Array;
  /** Each new vertex's vertex in the clay (seams duplicate some). */
  original: Uint32Array;
  /** Triangles over the new vertices. */
  index: Uint32Array;
  /** The atlas's size in texels when packed for `resolution`. */
  width: number;
  height: number;
}

/** Unwrap triangles (`positions`: x, y, z per vertex) into one atlas
 * packed for a square texture `resolution` texels wide, `padding` texels
 * between charts. */
export async function unwrap(
  xatlas: XAtlas,
  positions: Float32Array,
  index: ArrayLike<number>,
  { resolution = 2048, padding = 4 } = {},
): Promise<Unwrapped> {
  const pieces = splitForAtlas(index);
  await xatlas.createAtlas();
  try {
    for (const [n, p] of pieces.entries()) {
      const verts = new Float32Array(p.original.length * 3);
      p.original.forEach((v, i) => {
        verts[i * 3] = positions[v * 3];
        verts[i * 3 + 1] = positions[v * 3 + 1];
        verts[i * 3 + 2] = positions[v * 3 + 2];
      });
      await xatlas.addMesh(p.indexes, verts, null, null, n);
    }
    const atlas = await xatlas.generateAtlas(
      {},
      { resolution, padding, bilinear: true, rotateCharts: true },
      true,
    );
    if (atlas.atlasCount > 1)
      throw new Error(
        "The sculpture didn't fit one texture: try a larger texture size.",
      );
    let vertexTotal = 0;
    let indexTotal = 0;
    for (const m of atlas.meshes) {
      vertexTotal += m.vertexCount;
      indexTotal += m.index.length;
    }
    const uvs = new Float32Array(vertexTotal * 2);
    const original = new Uint32Array(vertexTotal);
    const out = new Uint32Array(indexTotal);
    let vBase = 0;
    let iBase = 0;
    for (const m of atlas.meshes) {
      const piece = pieces[m.mesh];
      for (let i = 0; i < m.vertexCount; i++) {
        original[vBase + i] = piece.original[m.oldIndexes[i]];
        uvs[(vBase + i) * 2] = m.vertex.coords1[i * 2] / atlas.width;
        uvs[(vBase + i) * 2 + 1] = m.vertex.coords1[i * 2 + 1] / atlas.height;
      }
      for (let i = 0; i < m.index.length; i++)
        out[iBase + i] = m.index[i] + vBase;
      vBase += m.vertexCount;
      iBase += m.index.length;
    }
    return {
      uvs,
      original,
      index: out,
      width: atlas.width,
      height: atlas.height,
    };
  } finally {
    await xatlas.destroyAtlas();
  }
}
