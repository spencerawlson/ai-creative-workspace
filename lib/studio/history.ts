/** Undo/redo history over scene documents.
 *
 * A linear list of entries plus a cursor. Committing after an undo drops
 * the redo branch. Consecutive commits with the same coalesce key within
 * `COALESCE_MS` replace the newest entry instead of adding one, so a
 * slider drag is one undo step.
 */

import {
  applyAction,
  coalesceKey,
  describeAction,
  type SceneAction,
} from "./actions";
import type { SceneDoc } from "./schema";

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 800;

export interface HistoryEntry {
  scene: SceneDoc;
  label: string;
}

export interface HistoryState {
  entries: HistoryEntry[];
  index: number;
  /** Coalesce key + time of the newest entry; cleared by undo/redo. */
  lastKey: string | null;
  lastAt: number;
  /** Error from the most recent rejected commit, for UI feedback. */
  error: string | null;
}

export function createHistory(
  scene: SceneDoc,
  label = "Open scene",
): HistoryState {
  return {
    entries: [{ scene, label }],
    index: 0,
    lastKey: null,
    lastAt: 0,
    error: null,
  };
}

export function present(h: HistoryState): SceneDoc {
  return h.entries[h.index].scene;
}

export const canUndo = (h: HistoryState) => h.index > 0;
export const canRedo = (h: HistoryState) => h.index < h.entries.length - 1;

export type HistoryCommand =
  | { type: "commit"; action: SceneAction; now: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "jump"; index: number }
  /** End the current coalescing run (e.g. on pointer up). */
  | { type: "seal" }
  /** Start a fresh history from a validated scene (startup restore). */
  | { type: "replace"; scene: SceneDoc; label: string };

export function historyReducer(
  h: HistoryState,
  cmd: HistoryCommand,
): HistoryState {
  switch (cmd.type) {
    case "commit": {
      const current = present(h);
      const result = applyAction(current, cmd.action);
      if (!result.ok) return { ...h, error: result.error };
      if (result.scene === current || sameScene(result.scene, current)) {
        return h.error ? { ...h, error: null } : h;
      }
      const key = coalesceKey(cmd.action);
      const label = describeAction(current, cmd.action);
      const merge =
        key !== null &&
        key === h.lastKey &&
        cmd.now - h.lastAt < COALESCE_MS &&
        h.index === h.entries.length - 1 &&
        h.index > 0;
      if (merge) {
        const entries = h.entries.slice();
        entries[h.index] = {
          scene: result.scene,
          label: entries[h.index].label,
        };
        return { ...h, entries, lastAt: cmd.now, error: null };
      }
      let entries = [
        ...h.entries.slice(0, h.index + 1),
        { scene: result.scene, label },
      ];
      if (entries.length > HISTORY_LIMIT)
        entries = entries.slice(entries.length - HISTORY_LIMIT);
      return {
        entries,
        index: entries.length - 1,
        lastKey: key,
        lastAt: cmd.now,
        error: null,
      };
    }
    case "undo":
      return canUndo(h)
        ? { ...h, index: h.index - 1, lastKey: null, error: null }
        : h;
    case "redo":
      return canRedo(h)
        ? { ...h, index: h.index + 1, lastKey: null, error: null }
        : h;
    case "jump":
      if (
        cmd.index < 0 ||
        cmd.index >= h.entries.length ||
        cmd.index === h.index
      )
        return h;
      return { ...h, index: cmd.index, lastKey: null, error: null };
    case "seal":
      return h.lastKey === null ? h : { ...h, lastKey: null };
    case "replace":
      return createHistory(cmd.scene, cmd.label);
  }
}

/** Structural equality, independent of key order (zod re-orders keys). */
export function sameScene(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) =>
    sameScene(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    ),
  );
}
