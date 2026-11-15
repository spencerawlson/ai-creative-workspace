/** Undo and redo for sculpting: one step per stroke. Kept within a
 * memory budget as well as a count, since one big grab can record a
 * hundred thousand vertices. */

import { applyRecord, type StrokeRecord } from "./brushes";
import type { SculptMesh } from "./mesh";

export const MAX_STEPS = 60;
/** Floats kept across all steps (two per moved coordinate: ~64 MB). */
export const MAX_FLOATS = 8_000_000;

const floats = (r: StrokeRecord) => r.before.length + r.after.length;

export class SculptHistory {
  private done: StrokeRecord[] = [];
  private undone: StrokeRecord[] = [];

  get canUndo(): boolean {
    return this.done.length > 0;
  }
  get canRedo(): boolean {
    return this.undone.length > 0;
  }
  get steps(): number {
    return this.done.length;
  }

  push(rec: StrokeRecord): void {
    this.done.push(rec);
    this.undone = [];
    let total = this.done.reduce((t, r) => t + floats(r), 0);
    // Oldest first; the newest step always stays.
    while (
      this.done.length > 1 &&
      (this.done.length > MAX_STEPS || total > MAX_FLOATS)
    ) {
      total -= floats(this.done.shift()!);
    }
  }

  /** Returns the vertices whose normals changed, or null. */
  undo(mesh: SculptMesh): Uint32Array | null {
    const rec = this.done.pop();
    if (!rec) return null;
    this.undone.push(rec);
    return applyRecord(mesh, rec, "before");
  }

  redo(mesh: SculptMesh): Uint32Array | null {
    const rec = this.undone.pop();
    if (!rec) return null;
    this.done.push(rec);
    return applyRecord(mesh, rec, "after");
  }

  clear(): void {
    this.done = [];
    this.undone = [];
  }
}
