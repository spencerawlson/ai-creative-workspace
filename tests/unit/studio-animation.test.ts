import { describe, expect, it } from "vitest";
import {
  applyAction,
  describeAction,
  isAnimatable,
  type SceneAction,
} from "@/lib/studio/actions";
import { evaluate, snapshot } from "@/lib/studio/animation";
import {
  createHistory,
  historyReducer,
  present,
  type HistoryState,
} from "@/lib/studio/history";
import { defaultScene } from "@/lib/studio/presets";
import {
  LIMITS,
  SceneSchema,
  type CameraPlacement,
  type SceneDoc,
} from "@/lib/studio/schema";
import { decodeScene, encodeScene } from "@/lib/studio/share";

const apply = (s: SceneDoc, a: SceneAction) => {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(r.error);
  return r.scene;
};
const view = (x: number): CameraPlacement => ({
  position: [x, 1.5, 3],
  target: [0, 1, 0],
});

/** Key 0 s: A-pose at the centre, key light at 350°, camera at x=0.
 * Key 2 s: elbow bent 90°, figure 1 m right and turned, light at 10°. */
function twoKeys(): SceneDoc {
  let s = defaultScene();
  s = apply(s, {
    type: "updateLight",
    id: "key",
    patch: { azimuth: 350, on: true },
  });
  s = apply(s, { type: "setKey", t: 0, camera: view(0) });
  s = apply(s, { type: "updateJoint", joint: "elbowL", patch: { bend: 90 } });
  s = apply(s, {
    type: "updateFigure",
    figure: "fig-1",
    patch: { x: 1, rotation: 170 },
  });
  s = apply(s, {
    type: "updateLight",
    id: "key",
    patch: { azimuth: 10, on: false },
  });
  s = apply(s, { type: "updateCamera", patch: { focalMm: 85 } });
  return apply(s, { type: "setKey", t: 2, camera: view(2) });
}

describe("keyframe evaluation", () => {
  it("without keys the scene is unchanged (same object)", () => {
    const s = defaultScene();
    expect(evaluate(s, 3)).toEqual({ scene: s, view: null });
  });

  it("eases between keys: halfway in time is halfway in value", () => {
    const { scene, view: v } = evaluate(twoKeys(), 1);
    const f = scene.figures[0];
    expect(f.pose.joints.elbowL.bend).toBe(45);
    expect(f.x).toBe(0.5);
    expect(v?.position[0]).toBeCloseTo(1, 6);
    expect(scene.camera.focalMm).toBe(Math.round((33 + 85) / 2));
    // Eased, not linear: a quarter of the way in time is less than that.
    const quarter = evaluate(twoKeys(), 0.5).scene.figures[0];
    expect(quarter.pose.joints.elbowL.bend).toBeLessThan(22.5);
    expect(quarter.pose.joints.elbowL.bend).toBeGreaterThan(0);
  });

  it("angles take the short way round; switches change at the next key", () => {
    const mid = evaluate(twoKeys(), 1).scene;
    // Light 350° → 10° passes through 0°, not 180°.
    expect(mid.lights[0].azimuth).toBe(0);
    // Figure turn 0° → 170°: halfway is 85°.
    expect(mid.figures[0].rotation).toBe(85);
    expect(mid.lights[0].on).toBe(true);
    expect(evaluate(twoKeys(), 2).scene.lights[0].on).toBe(false);
  });

  it("holds the first key before it and the last after it", () => {
    let s = twoKeys();
    s = apply(s, { type: "moveKey", from: 0, to: 1 });
    expect(evaluate(s, 0).scene.figures[0].pose.joints.elbowL.bend).toBe(0);
    expect(evaluate(s, 4.9).scene.figures[0].pose.joints.elbowL.bend).toBe(90);
  });

  it("keeps the pose preset's name only when the pose is exactly it", () => {
    let s = apply(defaultScene(), {
      type: "applyPosePreset",
      presetId: "arms-up",
    });
    s = apply(s, { type: "setKey", t: 0 });
    s = apply(s, { type: "applyPosePreset", presetId: "neutral" });
    s = apply(s, { type: "setKey", t: 2 });
    expect(evaluate(s, 2).scene.figures[0].pose.preset).toBe("neutral");
    expect(evaluate(s, 1).scene.figures[0].pose.preset).toBe("custom");
  });

  it("a figure missing from a key keeps its value there", () => {
    let s = twoKeys();
    s = apply(s, { type: "addFigure" });
    const added = s.figures[1];
    expect(evaluate(s, 1).scene.figures[1]).toEqual(added);
  });
});

describe("keyframe actions", () => {
  it("setting a key at an existing time replaces it; keys stay in order", () => {
    let s = twoKeys();
    s = apply(s, { type: "setKey", t: 1 });
    s = apply(s, { type: "setKey", t: 1 });
    expect(s.animation.keys.map((k) => k.t)).toEqual([0, 1, 2]);
  });

  it("moves, deletes and clears keys, refusing collisions", () => {
    let s = twoKeys();
    s = apply(s, { type: "moveKey", from: 2, to: 3.5 });
    expect(s.animation.keys.map((k) => k.t)).toEqual([0, 3.5]);
    expect(applyAction(s, { type: "moveKey", from: 0, to: 3.5 }).ok).toBe(
      false,
    );
    s = apply(s, { type: "deleteKey", t: 0 });
    expect(s.animation.keys.map((k) => k.t)).toEqual([3.5]);
    expect(applyAction(s, { type: "deleteKey", t: 1 }).ok).toBe(false);
    expect(apply(s, { type: "clearKeys" }).animation.keys).toEqual([]);
  });

  it("enforces the length and the key limit", () => {
    const s = twoKeys();
    expect(applyAction(s, { type: "setDuration", duration: 1.5 })).toEqual({
      ok: false,
      error: "A keyframe is at 2.00 s; move or delete it first",
    });
    expect(
      apply(s, { type: "setDuration", duration: 10 }).animation.duration,
    ).toBe(10);
    expect(applyAction(s, { type: "setKey", t: 6 }).ok).toBe(false); // past 5 s
    let full = apply(defaultScene(), { type: "setDuration", duration: 120 });
    for (let i = 0; i < LIMITS.maxKeys; i++)
      full = apply(full, { type: "setKey", t: i });
    expect(applyAction(full, { type: "setKey", t: 100 }).ok).toBe(false);
  });

  it("removing a figure or light drops it from every key", () => {
    let s = apply(twoKeys(), { type: "addFigure" });
    s = apply(s, { type: "setKey", t: 1 });
    s = apply(s, { type: "removeFigure", figure: "fig-2" });
    s = apply(s, { type: "removeLight", id: "rim" });
    for (const k of s.animation.keys) {
      expect(k.figures).not.toHaveProperty("fig-2");
      expect(k.lights).not.toHaveProperty("rim");
    }
    expect(SceneSchema.safeParse(s).success).toBe(true);
  });

  it("labels and which edits auto-key", () => {
    const s = twoKeys();
    expect(describeAction(s, { type: "setKey", t: 1.5 })).toBe(
      "Set key at 1.50 s",
    );
    expect(
      isAnimatable({
        type: "updateJoint",
        joint: "elbowL",
        patch: { bend: 1 },
      }),
    ).toBe(true);
    expect(isAnimatable({ type: "setModel", model: "female" })).toBe(false);
    expect(
      isAnimatable({ type: "updateCamera", patch: { exposureEv: 1 } }),
    ).toBe(false);
    expect(isAnimatable({ type: "updateCamera", patch: { focalMm: 50 } })).toBe(
      true,
    );
  });

  it("a snapshot records the camera only when given one", () => {
    expect(snapshot(defaultScene(), 0).camera).toBeUndefined();
    expect(snapshot(defaultScene(), 0, view(1)).camera?.view).toEqual(view(1));
  });
});

describe("keyframes in the undo history", () => {
  const commit = (
    h: HistoryState,
    action: SceneAction,
    autoKey?: { t: number },
  ) => historyReducer(h, { type: "commit", action, now: 0, autoKey });

  it("auto-key: an edit and its key are one undo step", () => {
    let h = createHistory(defaultScene());
    h = commit(
      h,
      { type: "updateJoint", joint: "elbowL", patch: { bend: 30 } },
      { t: 1 },
    );
    expect(h.entries).toHaveLength(2);
    expect(present(h).animation.keys.map((k) => k.t)).toEqual([1]);
    h = historyReducer(h, { type: "undo" });
    expect(present(h).animation.keys).toEqual([]);
    // Non-animated edits never add keys.
    h = commit(h, { type: "setModel", model: "female" }, { t: 1 });
    expect(present(h).animation.keys).toEqual([]);
  });

  it("moving the playhead adds no undo step and drops unkeyed edits", () => {
    let h = createHistory(twoKeys());
    h = commit(h, { type: "updateJoint", joint: "kneeL", patch: { bend: 60 } });
    const entries = h.entries.length;
    h = historyReducer(h, { type: "showTime", t: 1 });
    expect(h.entries).toHaveLength(entries);
    const shown = present(h).figures[0].pose.joints;
    expect(shown.elbowL.bend).toBe(45);
    expect(shown.kneeL.bend).toBe(0); // the unkeyed knee bend is gone
  });
});

describe("keyframes are kept, but not in share links", () => {
  it("scenes saved before keyframes load with an empty animation", () => {
    const { animation: _a, ...old } = defaultScene();
    const parsed = SceneSchema.parse(old);
    expect(parsed.animation).toEqual({ duration: 5, keys: [] });
  });

  it("a share link carries the current frame only", () => {
    const back = decodeScene(encodeScene(twoKeys()))!;
    expect(back.animation.keys).toEqual([]);
    expect(back.figures[0].pose.joints.elbowL.bend).toBe(90);
  });

  it("rejects keys out of order or past the end", () => {
    const s = twoKeys();
    const swapped = {
      ...s,
      animation: { ...s.animation, keys: [...s.animation.keys].reverse() },
    };
    expect(SceneSchema.safeParse(swapped).success).toBe(false);
    const short = { ...s, animation: { ...s.animation, duration: 1 } };
    expect(SceneSchema.safeParse(short).success).toBe(false);
  });
});
