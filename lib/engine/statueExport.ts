/** Statues for 3D printing: the figures as posed, baked into plain
 * triangles and written as binary STL.
 *
 * Baking reads every vertex the way the renderer places it
 * (`Mesh.getVertexPosition`: face shapes, then the skeleton), then the
 * mesh's world transform, so the file matches the viewport exactly.
 * Only what's part of the statue is baked: a figure's own meshes
 * ("model") and its plinth; the studio's posing helpers are left out.
 *
 * STL has no units; slicers read millimetres. The statue is turned
 * Z-up (STL's convention, three.js is Y-up), scaled to the height asked
 * for, centred over the origin and stood on z = 0, the print bed. */

import * as THREE from "three";

/** Mesh names that belong to a statue (StudioEngine names them). */
const STATUE_PARTS = new Set(["model", "plinth"]);

export interface BakedTriangles {
  /** x, y, z of each corner of each triangle, in world space (Y-up). */
  positions: Float32Array;
  triangles: number;
}

/** Whether `o` and every parent up to `root` is shown. */
function shown(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    if (!p.visible) return false;
    if (p === root) return true;
  }
  return true;
}

/** The statue parts under `roots`, as triangles in world space. */
export function bakeStatue(roots: THREE.Object3D[]): BakedTriangles {
  const meshes: THREE.Mesh[] = [];
  for (const root of roots) {
    // Parents first, then this subtree with updateMatrixWorld: a skinned
    // mesh refreshes its bind matrix there (updateWorldMatrix skips it),
    // or a figure moved since the last frame would bake out of place.
    root.updateWorldMatrix(true, false);
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && STATUE_PARTS.has(mesh.name) && shown(mesh, root))
        meshes.push(mesh);
    });
  }
  let total = 0;
  for (const m of meshes) total += cornerCount(m.geometry);
  const positions = new Float32Array(total * 3);
  const v = new THREE.Vector3();
  let at = 0;
  for (const mesh of meshes) {
    const skinned = mesh as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) skinned.skeleton.update();
    const g = mesh.geometry;
    const index = g.index;
    const count = cornerCount(g);
    // Each vertex once, then the triangles read them by index.
    const vertexCount = g.attributes.position.count;
    const world = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
      world[i * 3] = v.x;
      world[i * 3 + 1] = v.y;
      world[i * 3 + 2] = v.z;
    }
    for (let c = 0; c < count; c++) {
      const i = index ? index.getX(c) : c;
      positions[at++] = world[i * 3];
      positions[at++] = world[i * 3 + 1];
      positions[at++] = world[i * 3 + 2];
    }
  }
  return { positions, triangles: total / 3 };
}

function cornerCount(g: THREE.BufferGeometry): number {
  const n = g.index ? g.index.count : g.attributes.position.count;
  return n - (n % 3);
}

export interface StlResult {
  blob: Blob;
  triangles: number;
  /** The statue's size in the file: width (x), depth (y), height (z). */
  sizeMm: [number, number, number];
}

/** Binary STL of `baked`, `heightMm` tall, Z-up, on the bed at z = 0. */
export function toStl(baked: BakedTriangles, heightMm: number): StlResult {
  const p = baked.positions;
  if (!baked.triangles) throw new Error("There's nothing to export.");
  // Y-up → Z-up: (x, y, z) becomes (x, −z, y).
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    const c = [p[i], -p[i + 2], p[i + 1]];
    for (let k = 0; k < 3; k++) {
      if (c[k] < min[k]) min[k] = c[k];
      if (c[k] > max[k]) max[k] = c[k];
    }
  }
  const tall = max[2] - min[2];
  if (!(tall > 0)) throw new Error("The statue has no height.");
  const s = heightMm / tall;
  const shift = [-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]];

  const buffer = new ArrayBuffer(84 + baked.triangles * 50);
  const out = new DataView(buffer);
  const header = "Zaka 3D statue, millimetres, Z up";
  for (let i = 0; i < header.length; i++) out.setUint8(i, header.charCodeAt(i));
  out.setUint32(80, baked.triangles, true);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const corner = (v: THREE.Vector3, i: number) =>
    v.set(
      (p[i] + shift[0]) * s,
      (-p[i + 2] + shift[1]) * s,
      (p[i + 1] + shift[2]) * s,
    );
  let o = 84;
  for (let t = 0; t < baked.triangles; t++) {
    corner(a, t * 9);
    corner(b, t * 9 + 3);
    corner(c, t * 9 + 6);
    n.subVectors(c, b).cross(ab.subVectors(a, b)).normalize();
    for (const v of [n, a, b, c]) {
      out.setFloat32(o, v.x, true);
      out.setFloat32(o + 4, v.y, true);
      out.setFloat32(o + 8, v.z, true);
      o += 12;
    }
    out.setUint16(o, 0, true);
    o += 2;
  }
  return {
    blob: new Blob([buffer], { type: "model/stl" }),
    triangles: baked.triangles,
    sizeMm: [(max[0] - min[0]) * s, (max[1] - min[1]) * s, heightMm],
  };
}
