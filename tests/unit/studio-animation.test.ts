import { describe, expect, it } from "vitest";
import {
  applyAction,
  describeAction,
  isAnimatable,
  type SceneAction,
} from "@/lib/studio/actions";
import {
  channelValue,
  evaluate,
  keyValue,
  snapshot,
} from "@/lib/studio/animation";
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
import {
  decodeScene,
  decodeSceneLink,
  encodeScene,
  encodeSceneLink,
} from "@/lib/studio/share";

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
      full = apply(full, { type: "setKey", t: i / 2 });
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

describe("graph editor: interpolation and key values", () => {
  const elbow = {
    kind: "joint",
    figure: "fig-1",
    joint: "elbowL",
    dof: "bend",
  } as const;

  it("linear is a straight line; step holds until the next key", () => {
    let s = apply(twoKeys(), { type: "setKeyEase", t: 0, ease: "linear" });
    const at = (t: number) => channelValue(evaluate(s, t).scene, elbow);
    expect(at(0.5)).toBe(22.5);
    s = apply(s, { type: "setKeyEase", t: 0, ease: "step" });
    expect(at(1.99)).toBe(0);
    expect(at(2)).toBe(90);
  });

  it("re-keying a time keeps its interpolation", () => {
    let s = apply(twoKeys(), { type: "setKeyEase", t: 0, ease: "linear" });
    s = apply(s, { type: "setKey", t: 0 });
    expect(s.animation.keys[0].ease).toBe("linear");
  });

  it("edits one value in one key, within the channel's limits", () => {
    let s = apply(twoKeys(), {
      type: "setKeyValue",
      t: 2,
      channel: elbow,
      value: 120,
    });
    expect(keyValue(s.animation.keys[1], elbow)).toBe(120);
    expect(keyValue(s.animation.keys[0], elbow)).toBe(0);
    const tooFar = applyAction(s, {
      type: "setKeyValue",
      t: 2,
      channel: elbow,
      value: 400,
    });
    expect(tooFar.ok).toBe(false);
    const light = { kind: "light", light: "key", field: "intensity" } as const;
    s = apply(s, { type: "setKeyValue", t: 0, channel: light, value: 2.5 });
    expect(keyValue(s.animation.keys[0], light)).toBe(2.5);
  });

  it("refuses channels a key doesn't record, and missing keys", () => {
    let s = apply(defaultScene(), { type: "setKey", t: 0 }); // no camera
    expect(
      applyAction(s, {
        type: "setKeyValue",
        t: 0,
        channel: { kind: "camera", field: "focalMm" },
        value: 50,
      }).ok,
    ).toBe(false);
    s = apply(s, { type: "addFigure" });
    expect(
      applyAction(s, {
        type: "setKeyValue",
        t: 0,
        channel: { kind: "figure", figure: "fig-2", field: "x" },
        value: 1,
      }).ok,
    ).toBe(false);
    expect(applyAction(s, { type: "setKeyEase", t: 3, ease: "step" }).ok).toBe(
      false,
    );
  });
});

describe("graph editor: tangents", () => {
  const elbow = {
    kind: "joint",
    figure: "fig-1",
    joint: "elbowL",
    dof: "bend",
  } as const;
  const at = (s: SceneDoc, t: number) =>
    channelValue(evaluate(s, t).scene, elbow)!;

  it("default tangents reproduce smooth exactly; a slope bends the curve", () => {
    const s = twoKeys(); // elbow 0 -> 90 over 0..2 s
    expect(at(s, 1)).toBe(45);
    const steep = apply(s, {
      type: "setKeyTangent",
      t: 0,
      channel: elbow,
      slope: 90, // degrees per second, leaving the first key
    });
    expect(at(steep, 0.5)).toBeGreaterThan(at(s, 0.5) + 5);
    // The other channels are untouched.
    const x = { kind: "figure", figure: "fig-1", field: "x" } as const;
    expect(channelValue(evaluate(steep, 0.5).scene, x)).toBe(
      channelValue(evaluate(s, 0.5).scene, x),
    );
    // null resets to the ease.
    const reset = apply(steep, {
      type: "setKeyTangent",
      t: 0,
      channel: elbow,
      slope: null,
    });
    expect(at(reset, 0.5)).toBe(at(s, 0.5));
    expect(reset.animation.keys[0].tangents).toBeUndefined();
  });

  it("an overshooting curve stays inside the joint's limits", () => {
    const s = apply(twoKeys(), {
      type: "setKeyTangent",
      t: 2,
      channel: elbow,
      slope: 5000,
    });
    for (let t = 0; t <= 2; t += 0.05) {
      expect(at(s, t)).toBeGreaterThanOrEqual(0);
      expect(at(s, t)).toBeLessThanOrEqual(145);
    }
  });

  it("Flat / Reset on several curves at once is one undo step", () => {
    const x = { kind: "figure", figure: "fig-1", field: "x" } as const;
    let h = createHistory(twoKeys());
    h = historyReducer(h, {
      type: "commit",
      now: 0,
      action: {
        type: "setKeyTangents",
        t: 0,
        changes: [
          { channel: elbow, tangent: { in: 60, out: 60 } },
          { channel: x, tangent: { in: 0.5, out: 0.5 } },
        ],
      },
    });
    const tg = present(h).animation.keys[0].tangents!;
    expect(Object.keys(tg)).toHaveLength(2);
    h = historyReducer(h, { type: "undo" });
    expect(present(h).animation.keys[0].tangents).toBeUndefined();
    // Reset (null) clears them together too.
    const reset = apply(present(historyReducer(h, { type: "redo" })), {
      type: "setKeyTangents",
      t: 0,
      changes: [
        { channel: elbow, tangent: null },
        { channel: x, tangent: null },
      ],
    });
    expect(reset.animation.keys[0].tangents).toBeUndefined();
  });

  it("a broken tangent's sides move separately; unify joins them", () => {
    let s = apply(twoKeys(), {
      type: "setKeyTangents",
      t: 2,
      changes: [{ channel: elbow, tangent: { in: 20, out: 20, broken: true } }],
    });
    s = apply(s, {
      type: "setKeyTangent",
      t: 2,
      channel: elbow,
      slope: 90,
      side: "in",
    });
    const key = () => s.animation.keys[1].tangents!;
    const [only] = Object.values(key());
    expect(only).toEqual({ in: 90, out: 20, broken: true });
    // The incoming side shapes the curve into the key.
    expect(at(s, 1.8)).not.toBe(at(twoKeys(), 1.8));
    // Unbroken: a drag on either side moves both.
    s = apply(s, {
      type: "setKeyTangents",
      t: 2,
      changes: [{ channel: elbow, tangent: { in: 20, out: 20 } }],
    });
    s = apply(s, {
      type: "setKeyTangent",
      t: 2,
      channel: elbow,
      slope: 40,
      side: "in",
    });
    expect(Object.values(key())[0]).toEqual({ in: 40, out: 40 });
  });

  it("broken tangents survive save and share", async () => {
    const s = apply(twoKeys(), {
      type: "setKeyTangents",
      t: 2,
      changes: [{ channel: elbow, tangent: { in: 10, out: -5, broken: true } }],
    });
    expect(SceneSchema.parse(JSON.parse(JSON.stringify(s)))).toEqual(s);
    const { param } = await encodeSceneLink(s);
    const back = (await decodeSceneLink(param))!;
    expect(Object.values(back.animation.keys[1].tangents!)[0]).toEqual({
      in: 10,
      out: -5,
      broken: true,
    });
  });

  it("re-keying keeps tangents; unknown channels are refused", () => {
    let s = apply(twoKeys(), {
      type: "setKeyTangent",
      t: 0,
      channel: elbow,
      slope: 30,
    });
    s = apply(s, { type: "setKey", t: 0 });
    expect(s.animation.keys[0].tangents).toBeDefined();
    expect(
      applyAction(s, {
        type: "setKeyTangent",
        t: 0,
        channel: { kind: "figure", figure: "fig-9", field: "x" },
        slope: 1,
      }).ok,
    ).toBe(false);
  });
});
