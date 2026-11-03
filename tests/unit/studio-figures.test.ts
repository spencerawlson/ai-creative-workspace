import { describe, expect, it } from "vitest";
import {
  coalesceKey,
  describeAction,
  tryApplyAction,
  type SceneAction,
} from "@/lib/studio/actions";
import { freeSpot } from "@/lib/studio/figures";
import { flattenJoints } from "@/lib/studio/pose";
import { defaultScene } from "@/lib/studio/presets";
import { LIMITS, SceneSchema, type SceneDoc } from "@/lib/studio/schema";
import { decodeScene, encodeScene } from "@/lib/studio/share";

const apply = (s: SceneDoc, a: SceneAction) => {
  const r = tryApplyAction(s, a);
  if (!r.ok) throw new Error(r.error);
  return r.scene;
};
const payload = (s: SceneDoc) =>
  JSON.parse(atob(encodeScene(s).replace(/-/g, "+").replace(/_/g, "/")));
const encode = (p: unknown) =>
  btoa(JSON.stringify(p))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

describe("figures", () => {
  it("a new scene has one male figure in the centre, facing the camera", () => {
    const [f] = defaultScene().figures;
    expect(defaultScene().figures).toHaveLength(1);
    expect(f).toMatchObject({ id: "fig-1", model: "male", x: 0, z: 0 });
    expect(f.rotation).toBe(0);
  });

  it("adds figures side by side, up to the limit", () => {
    let s = defaultScene();
    for (let i = 1; i < LIMITS.maxFigures; i++)
      s = apply(s, { type: "addFigure", model: i % 2 ? "female" : "male" });
    expect(s.figures.map((f) => f.id)).toEqual([
      "fig-1",
      "fig-2",
      "fig-3",
      "fig-4",
    ]);
    expect(s.figures[1].model).toBe("female");
    // Nobody stands on anybody else.
    for (const a of s.figures)
      for (const b of s.figures)
        if (a !== b)
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(0.9);
    expect(tryApplyAction(s, { type: "addFigure" })).toEqual({
      ok: false,
      error: `At most ${LIMITS.maxFigures} figures`,
    });
  });

  it("duplicates a figure with its model and pose, somewhere free", () => {
    const posed = apply(defaultScene(), {
      type: "applyPosePreset",
      presetId: "thinker",
    });
    const s = apply(posed, { type: "duplicateFigure", figure: "fig-1" });
    const [a, b] = s.figures;
    expect(b.id).toBe("fig-2");
    expect(b.model).toBe(a.model);
    expect(b.pose).toEqual(a.pose);
    expect(b.pose).not.toBe(a.pose); // a copy, not shared
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.5);
  });

  it("removes a figure, but never the last one", () => {
    const two = apply(defaultScene(), { type: "addFigure" });
    const one = apply(two, { type: "removeFigure", figure: "fig-1" });
    expect(one.figures.map((f) => f.id)).toEqual(["fig-2"]);
    expect(
      tryApplyAction(one, { type: "removeFigure", figure: "fig-2" }).ok,
    ).toBe(false);
    expect(
      tryApplyAction(two, { type: "removeFigure", figure: "fig-9" }),
    ).toEqual({ ok: false, error: 'No figure "fig-9"' });
  });

  it("moves and turns a figure within the studio's limits", () => {
    const s = apply(defaultScene(), {
      type: "updateFigure",
      figure: "fig-1",
      patch: { x: 1.5, z: -0.5, rotation: 45 },
    });
    expect(s.figures[0]).toMatchObject({ x: 1.5, z: -0.5, rotation: 45 });
    const bad = (patch: unknown) =>
      tryApplyAction(defaultScene(), {
        type: "updateFigure",
        figure: "fig-1",
        patch,
      }).ok;
    expect(bad({ x: 9 })).toBe(false);
    expect(bad({ rotation: 270 })).toBe(false);
    expect(bad({ model: "female" })).toBe(false); // use setModel
  });

  it("pose and model actions change only the figure they name", () => {
    const two = apply(defaultScene(), { type: "addFigure" });
    const s = apply(
      apply(two, {
        type: "applyPosePreset",
        presetId: "arms-up",
        figure: "fig-2",
      }),
      { type: "setModel", model: "female", figure: "fig-2" },
    );
    expect(s.figures[1].pose.preset).toBe("arms-up");
    expect(s.figures[1].model).toBe("female");
    expect(s.figures[0]).toEqual(two.figures[0]);
    // Without `figure`, actions still target the first figure.
    const first = apply(s, {
      type: "updateJoint",
      joint: "elbowL",
      patch: { bend: 30 },
    });
    expect(first.figures[0].pose.joints.elbowL.bend).toBe(30);
    expect(first.figures[1]).toEqual(s.figures[1]);
  });

  it("drags on different figures are separate undo steps; labels name them", () => {
    const two = apply(defaultScene(), { type: "addFigure" });
    const drag = (figure: string): SceneAction => ({
      type: "updateJoints",
      patches: { elbowR: { bend: 10 } },
      figure,
    });
    expect(coalesceKey(drag("fig-1"))).not.toBe(coalesceKey(drag("fig-2")));
    expect(describeAction(two, drag("fig-2"))).toBe(
      "Figure 2 · Move right arm",
    );
    expect(describeAction(defaultScene(), drag("fig-1"))).toBe(
      "Move right arm",
    );
    expect(
      describeAction(two, {
        type: "updateFigure",
        figure: "fig-2",
        patch: { rotation: 30 },
      }),
    ).toBe("Figure 2: turn");
  });

  it("free spots alternate right and left of the centre", () => {
    const s = apply(apply(defaultScene(), { type: "addFigure" }), {
      type: "addFigure",
    });
    expect(s.figures.map((f) => f.x)).toEqual([0, 0.9, -0.9]);
    expect(freeSpot(s.figures)).toEqual({ x: 1.8, z: 0 });
  });
});

describe("figures in share links and saved scenes", () => {
  it("one centred figure keeps the old link layout", () => {
    const p = payload(defaultScene());
    expect(p.m).toBe("male");
    expect(p).not.toHaveProperty("fg");
    expect(p).not.toHaveProperty("po");
  });

  it("several figures round-trip: models, places, turns and poses", () => {
    let s = apply(defaultScene(), { type: "addFigure", model: "female" });
    s = apply(s, {
      type: "updateFigure",
      figure: "fig-2",
      patch: { x: 1.2, z: -0.4, rotation: -30 },
    });
    s = apply(s, {
      type: "applyPosePreset",
      presetId: "hand-raised",
      figure: "fig-2",
    });
    const back = decodeScene(encodeScene(s))!;
    expect(back.figures).toHaveLength(2);
    expect(back.figures[1]).toMatchObject({
      model: "female",
      x: 1.2,
      z: -0.4,
      rotation: -30,
    });
    expect(back.figures[1].pose.preset).toBe("hand-raised");
    expect(flattenJoints(back.figures[1].pose.joints)).toEqual(
      flattenJoints(s.figures[1].pose.joints),
    );
    expect(back.figures[0].pose.preset).toBe("neutral");
  });

  it("rejects links with too many figures or a figure out of the studio", () => {
    let s = apply(defaultScene(), { type: "addFigure" });
    const p = payload(s);
    p.fg[1][1] = 50; // x far outside the studio
    expect(decodeScene(encode(p))).toBeNull();
    for (let i = 2; i < LIMITS.maxFigures; i++)
      s = apply(s, { type: "addFigure" });
    const many = payload(s);
    many.fg.push(many.fg[0]);
    expect(decodeScene(encode(many))).toBeNull();
  });

  it("autosaves and project files from before several figures still load", () => {
    const { figures: _f, ...rest } = defaultScene();
    const old = { ...rest, model: "female" }; // no pose: older still
    const parsed = SceneSchema.safeParse(old);
    expect(parsed.success && parsed.data.figures[0].model).toBe("female");
    // Figure ids must be unique.
    const dup = defaultScene();
    expect(
      SceneSchema.safeParse({
        ...dup,
        figures: [dup.figures[0], dup.figures[0]],
      }).success,
    ).toBe(false);
  });
});
