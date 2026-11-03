/** Helpers for the figures (mannequins) in a scene. Pure; no React or
 * Three.js. */

import { defaultPose } from "./pose";
import {
  LIMITS,
  type Figure,
  type MannequinModel,
  type SceneDoc,
} from "./schema";

/** Figures closer than this (metres) are considered in each other's way
 * when placing a new one. */
const SPACING = 0.9;

export function newFigure(
  id: string,
  model: MannequinModel,
  at: { x: number; z: number },
): Figure {
  return {
    id,
    model,
    x: at.x,
    y: 0,
    z: at.z,
    rotation: 0,
    pose: defaultPose(),
  };
}

export function findFigure(
  scene: SceneDoc,
  id: string | undefined,
): Figure | undefined {
  return id === undefined
    ? scene.figures[0]
    : scene.figures.find((f) => f.id === id);
}

/** "Figure 2": by position in the list, so names stay 1..n. */
export function figureLabel(scene: SceneDoc, id: string): string {
  const i = scene.figures.findIndex((f) => f.id === id);
  return i < 0 ? id : `Figure ${i + 1}`;
}

export function nextFigureId(figures: Figure[]): string {
  const used = new Set(figures.map((f) => f.id));
  for (let n = 1; ; n++) if (!used.has(`fig-${n}`)) return `fig-${n}`;
}

/** The nearest free spot on a line across the studio, alternating right
 * and left of the centre, then a row behind. */
export function freeSpot(figures: Figure[]): { x: number; z: number } {
  const clear = (x: number, z: number) =>
    figures.every((f) => Math.hypot(f.x - x, f.z - z) >= SPACING);
  for (const z of [0, -1.2]) {
    for (let k = 0; k * SPACING <= LIMITS.figureX[1]; k++) {
      for (const x of k === 0 ? [0] : [k * SPACING, -k * SPACING]) {
        if (clear(x, z)) return { x: round(x), z };
      }
    }
  }
  return { x: 0, z: 0 };
}

const round = (n: number) => Math.round(n * 100) / 100;
