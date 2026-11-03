import { describe, expect, it } from "vitest";
import { applyAction, type SceneAction } from "@/lib/studio/actions";
import { evaluate } from "@/lib/studio/animation";
import { channelsOf } from "@/lib/studio/channels";
import { defaultScene } from "@/lib/studio/presets";
import { LIMITS, SceneSchema, type SceneDoc } from "@/lib/studio/schema";
import {
  decodeScene,
  decodeSceneLink,
  encodeScene,
  encodeSceneLink,
} from "@/lib/studio/share";

const apply = (s: SceneDoc, ...actions: SceneAction[]) =>
  actions.reduce((acc, a) => {
    const r = applyAction(acc, a);
    if (!r.ok) throw new Error(r.error);
    return r.scene;
  }, s);

const lift = (y: number, figure = "fig-1"): SceneAction => ({
  type: "updateFigure",
  figure,
  patch: { y },
});

describe("figure up / down", () => {
  it("starts on the floor and stays within the studio", () => {
    expect(defaultScene().figures[0].y).toBe(0);
    expect(apply(defaultScene(), lift(0.4)).figures[0].y).toBe(0.4);
    const r = applyAction(defaultScene(), lift(LIMITS.figureY[1] + 1));
    expect(r.ok).toBe(false);
  });

  it("scenes and keys saved before it existed load on the floor", () => {
    const old = JSON.parse(
      JSON.stringify(apply(defaultScene(), { type: "setKey", t: 0 })),
    );
    delete old.figures[0].y;
    delete old.animation.keys[0].figures["fig-1"].y;
    const parsed = SceneSchema.parse(old);
    expect(parsed.figures[0].y).toBe(0);
    expect(parsed.animation.keys[0].figures["fig-1"].y).toBe(0);
  });

  it("is keyed, interpolated and shown in the graph editor", () => {
    const s = apply(defaultScene(), { type: "setKey", t: 0 }, lift(1), {
      type: "setKey",
      t: 2,
    });
    expect(evaluate(s, 1).scene.figures[0].y).toBeGreaterThan(0.3);
    expect(evaluate(s, 1).scene.figures[0].y).toBeLessThan(0.7);
    const labels = channelsOf(s, "fig-1").map((c) => c.label);
    expect(labels).toContain("Up / down");
  });

  it("round-trips in share links; links without it still open", () => {
    const one = apply(defaultScene(), lift(0.5));
    expect(decodeScene(encodeScene(one))?.figures[0].y).toBe(0.5);
    const two = apply(
      defaultScene(),
      { type: "addFigure", model: "female" },
      lift(-0.3, "fig-2"),
    );
    const back = decodeScene(encodeScene(two))!;
    expect(back.figures.map((f) => f.y)).toEqual([0, -0.3]);
    // Posed and lifted: the pose still comes back.
    const posed = apply(two, {
      type: "updateJoint",
      joint: "elbowL",
      patch: { bend: 70 },
      figure: "fig-2",
    });
    expect(
      decodeScene(encodeScene(posed))?.figures[1].pose.joints.elbowL.bend,
    ).toBe(70);
  });

  it("animated links carry it", async () => {
    const s = apply(defaultScene(), { type: "setKey", t: 0 }, lift(0.8), {
      type: "setKey",
      t: 1,
    });
    const { param, animated } = await encodeSceneLink(s);
    expect(animated).toBe(true);
    const back = (await decodeSceneLink(param))!;
    expect(back.animation.keys.map((k) => k.figures["fig-1"].y)).toEqual([
      0, 0.8,
    ]);
  });
});
