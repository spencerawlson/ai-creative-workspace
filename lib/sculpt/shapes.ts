/** Shapes to start sculpting from, as welded clay standing on the floor
 * (y = 0), about 1 m tall. Fine enough for detail, light enough for a
 * phone (tens of thousands of triangles). */

import * as THREE from "three";
import { buildMesh, weld, type SculptMesh } from "./mesh";

export const SHAPES = ["sphere", "block"] as const;
export type ShapeId = (typeof SHAPES)[number];

export const SHAPE_NAMES: Record<ShapeId, string> = {
  sphere: "Sphere",
  block: "Rounded block",
};

/** Even triangles all over: subdividing an icosahedron. */
function sphere(): { positions: Float32Array; index: Uint32Array } {
  const g = new THREE.IcosahedronGeometry(0.5, 63);
  g.translate(0, 0.5, 0);
  const r = weld(g.attributes.position.array);
  g.dispose();
  return r;
}

/** A cube with rounded edges: a finely divided box whose points are
 * pulled onto a smaller box plus a rounding radius. */
function block(): { positions: Float32Array; index: Uint32Array } {
  const size = 0.8;
  const round = 0.12;
  const g = new THREE.BoxGeometry(size, size, size, 56, 56, 56);
  const p = g.attributes.position;
  const inner = size / 2 - round;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(
      THREE.MathUtils.clamp(v.x, -inner, inner),
      THREE.MathUtils.clamp(v.y, -inner, inner),
      THREE.MathUtils.clamp(v.z, -inner, inner),
    );
    v.sub(c).normalize().multiplyScalar(round).add(c);
    p.setXYZ(i, v.x, v.y + size / 2, v.z);
  }
  const r = weld(p.array, g.index?.array);
  g.dispose();
  return r;
}

export function makeShape(id: ShapeId): SculptMesh {
  const { positions, index } = id === "sphere" ? sphere() : block();
  return buildMesh(positions, index);
}
