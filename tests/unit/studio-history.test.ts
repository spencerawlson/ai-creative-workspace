import { describe, expect, it } from "vitest";
import {
  COALESCE_MS,
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  createHistory,
  historyReducer,
  present,
  type HistoryState,
} from "@/lib/studio/history";
import { defaultScene } from "@/lib/studio/presets";
import type { SceneAction } from "@/lib/studio/actions";

const commit = (h: HistoryState, action: SceneAction, now = 0) =>
  historyReducer(h, { type: "commit", action, now });

describe("history", () => {
  it("undoes and redoes", () => {
    let h = createHistory(defaultScene());
    h = commit(h, { type: "applyPreset", presetId: "split" });
    expect(present(h).preset).toBe("split");
    h = historyReducer(h, { type: "undo" });
    expect(present(h).preset).toBe("three-point");
    expect(canRedo(h)).toBe(true);
    h = historyReducer(h, { type: "redo" });
    expect(present(h).preset).toBe("split");
    expect(canRedo(h)).toBe(false);
  });

  it("coalesces rapid edits to the same field into one step", () => {
    let h = createHistory(defaultScene());
    for (let i = 0; i < 20; i++) {
      h = commit(
        h,
        { type: "updateLight", id: "key", patch: { azimuth: i * 5 } },
        i * 16,
      );
    }
    expect(h.entries).toHaveLength(2);
    expect(present(h).lights[0].azimuth).toBe(95);
    h = historyReducer(h, { type: "undo" });
    expect(present(h).lights[0].azimuth).toBe(45);
  });

  it("does not coalesce after a pause, a seal, or a different field", () => {
    let h = createHistory(defaultScene());
    const az = (v: number): SceneAction => ({
      type: "updateLight",
      id: "key",
      patch: { azimuth: v },
    });
    h = commit(h, az(10), 0);
    h = commit(h, az(20), COALESCE_MS + 1);
    h = historyReducer(h, { type: "seal" });
    h = commit(h, az(30), COALESCE_MS + 2);
    h = commit(
      h,
      { type: "updateLight", id: "key", patch: { elevation: 10 } },
      COALESCE_MS + 3,
    );
    expect(h.entries).toHaveLength(5);
  });

  it("a slow viewport drag (gesture) is one step until it is sealed", () => {
    let h = createHistory(defaultScene());
    const drag = (bend: number, now: number) =>
      historyReducer(h, {
        type: "commit",
        action: { type: "updateJoint", joint: "elbowL", patch: { bend } },
        now,
        gesture: true,
      });
    // Pauses far longer than the coalescing window mid-drag.
    for (let i = 1; i <= 5; i++) h = drag(i * 10, i * 3 * COALESCE_MS);
    expect(h.entries).toHaveLength(2);
    h = historyReducer(h, { type: "seal" });
    h = drag(90, 100 * COALESCE_MS);
    expect(h.entries).toHaveLength(3);
    h = historyReducer(h, { type: "undo" });
    expect(present(h).figures[0].pose.joints.elbowL.bend).toBe(50);
  });

  it("committing after undo drops the redo branch", () => {
    let h = createHistory(defaultScene());
    h = commit(h, { type: "applyPreset", presetId: "split" });
    h = commit(h, { type: "applyPreset", presetId: "butterfly" });
    h = historyReducer(h, { type: "undo" });
    h = commit(h, { type: "applyPreset", presetId: "low-key" });
    expect(h.entries.map((e) => e.label)).toEqual([
      "Open scene",
      "Preset: Split",
      "Preset: Low-key",
    ]);
  });

  it("ignores no-op and invalid commits, surfacing the error", () => {
    let h = createHistory(defaultScene());
    h = commit(h, { type: "applyPreset", presetId: "three-point" });
    expect(h.entries).toHaveLength(1);
    h = commit(h, { type: "removeLight", id: "ghost" });
    expect(h.entries).toHaveLength(1);
    expect(h.error).toMatch(/ghost/);
    expect(canUndo(h)).toBe(false);
  });

  it("jumps to any entry and caps its length", () => {
    let h = createHistory(defaultScene());
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      h = commit(
        h,
        { type: "updateCamera", patch: { focalMm: 20 + (i % 100) } },
        i * 10_000,
      );
    }
    expect(h.entries).toHaveLength(HISTORY_LIMIT);
    h = historyReducer(h, { type: "jump", index: 3 });
    expect(h.index).toBe(3);
  });
});
