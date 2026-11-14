/** Statue bases (lib/studio/schema.ts PLINTHS). */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PLINTH_SIZE, type Plinth } from "@/lib/studio/schema";

/** A statue base PLINTH_SIZE across and high, from the floor up: a
 * foot, a slightly narrower body and a cap, each piece with its own
 * crisp edges (and closed, so it prints). */
export function plinthGeometry(kind: Plinth): THREE.BufferGeometry {
  const { width: w, height: h } = PLINTH_SIZE;
  // [width, bottom, top] of each tier, as fractions of w and h.
  const tiers: Array<[number, number, number]> = [
    [1, 0, 0.2],
    [0.9, 0.2, 0.85],
    [0.95, 0.85, 1],
  ];
  const parts = tiers.map(([fw, y0, y1]) => {
    const tall = (y1 - y0) * h;
    const g =
      kind === "round"
        ? new THREE.CylinderGeometry((fw * w) / 2, (fw * w) / 2, tall, 64)
        : new THREE.BoxGeometry(fw * w, tall, fw * w);
    g.translate(0, y0 * h + tall / 2, 0);
    return g;
  });
  const merged = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return merged;
}
