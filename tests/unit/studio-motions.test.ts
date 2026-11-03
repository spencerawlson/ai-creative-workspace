import { describe, expect, it } from "vitest";
import { applyAction, type SceneAction } from "@/lib/studio/actions";
import { evaluate } from "@/lib/studio/animation";
import {
  MOTIONS,
  findMotion,
  floorOffset,
  motionLength,
  motionSteps,
  planMotion,
} from "@/lib/studio/motions";
import { parseQuery, searchMotions, stem } from "@/lib/studio/motionSearch";
import { neutralJoints } from "@/lib/studio/pose";
import { defaultScene } from "@/lib/studio/presets";
import { SceneSchema, type SceneDoc } from "@/lib/studio/schema";
import { decodeSceneLink, encodeSceneLink } from "@/lib/studio/share";

const apply = (s: SceneDoc, ...actions: SceneAction[]) =>
  actions.reduce((acc, a) => {
    const r = applyAction(acc, a);
    if (!r.ok) throw new Error(r.error);
    return r.scene;
  }, s);

const top = (q: string) => searchMotions(q)[0]?.motion.id;

describe("motion library", () => {
  it("has many poses and moves with unique ids", () => {
    const ids = MOTIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MOTIONS.filter((m) => m.kind === "pose").length).toBeGreaterThan(15);
    expect(MOTIONS.filter((m) => m.kind === "move").length).toBeGreaterThan(25);
    for (const id of [
      "walk",
      "run",
      "kick",
      "throw",
      "eat",
      "drink",
      "jump",
      "wave",
      "sit",
      "dance",
    ])
      expect(findMotion(id), id).toBeDefined();
  });

  it("every motion, both sides, applies to a valid scene", () => {
    for (const m of MOTIONS)
      for (const mirror of [false, true]) {
        const r = applyAction(defaultScene(), {
          type: "applyMotion",
          motion: m.id,
          mirror,
        });
        expect(r.ok, `${m.id}: ${r.ok ? "" : r.error}`).toBe(true);
        if (!r.ok) continue;
        expect(SceneSchema.safeParse(r.scene).success, m.id).toBe(true);
        if (m.kind === "move")
          expect(r.scene.animation.keys.length, m.id).toBeGreaterThan(1);
      }
  });

  it("keeps the feet on the floor: standing 0, sitting and kneeling lower", () => {
    expect(floorOffset(neutralJoints())).toBeCloseTo(0, 5);
    const y = (id: string) =>
      motionSteps(findMotion(id)!, { x: 0, z: 0, rotation: 0 })[0].y;
    expect(y("stand")).toBeCloseTo(0, 1);
    expect(y("sit")).toBeLessThan(-0.3);
    expect(y("kneel")).toBeLessThan(-0.3);
    expect(y("squat")).toBeLessThan(y("sit"));
    expect(y("sit-floor")).toBeLessThan(y("sit"));
  });

  it("a jump leaves the floor in the middle", () => {
    const steps = motionSteps(findMotion("jump")!, { x: 0, z: 0, rotation: 0 });
    expect(Math.max(...steps.map((s) => s.y))).toBeGreaterThan(0.3);
    expect(steps[steps.length - 1].y).toBeCloseTo(0, 1);
  });

  it("walking goes the way the figure faces, in whole strides, inside the studio", () => {
    const walk = findMotion("walk")!;
    const end = (rotation: number, x = 0, z = 0) => {
      const s = motionSteps(walk, { x, z, rotation });
      return s[s.length - 1];
    };
    // Facing away from the camera: both strides (2 x 1.3 m).
    expect(end(180).z).toBeCloseTo(-2.6, 5);
    expect(end(90).x).toBeCloseTo(2.6, 5);
    expect(Math.abs(end(90).z)).toBeLessThan(0.01);
    // Towards the camera there is room for one stride only.
    const towards = planMotion(walk, { x: 0, z: 0, rotation: 0 });
    expect(towards.repeat).toBe(1);
    expect(towards.shortened).toBe(true);
    expect(end(0).z).toBeCloseTo(1.3, 5);
    // No room at all: on the spot, never sliding.
    const stuck = planMotion(walk, { x: 0, z: 1.4, rotation: 0 });
    expect(stuck.noRoom).toBe(true);
    expect(stuck.steps.every((s) => s.z === 1.4)).toBe(true);
    const still = motionSteps(
      walk,
      { x: 0, z: 0, rotation: 0 },
      { inPlace: true },
    );
    expect(still.every((s) => s.z === 0)).toBe(true);
    const back = motionSteps(
      walk,
      { x: 0, z: 0, rotation: 0 },
      { backwards: true },
    );
    expect(back[back.length - 1].z).toBeCloseTo(-2.6, 5);
  });

  it("a move becomes keys on that figure only, from the current time", () => {
    let s = apply(
      defaultScene(),
      { type: "addFigure", model: "female" },
      { type: "setKey", t: 0 },
    );
    s = apply(s, {
      type: "applyMotion",
      motion: "wave",
      figure: "fig-2",
      t: 1,
    });
    const len = motionLength(findMotion("wave")!);
    const mine = s.animation.keys.filter((k) => k.figures["fig-2"]);
    expect(mine[0].t).toBe(0); // the key that was already there
    expect(mine[1].t).toBe(1);
    expect(mine[mine.length - 1].t).toBeCloseTo(1 + len, 2);
    // fig-1 is only in the original key; the new keys are spline keys.
    expect(s.animation.keys.filter((k) => k.figures["fig-1"])).toHaveLength(1);
    expect(mine.slice(1).every((k) => k.ease === "spline")).toBe(true);
    // Mid-wave, the right arm is up.
    const mid = evaluate(s, 1.7).scene.figures[1];
    expect(mid.pose.joints.shoulderR.raise).toBeGreaterThan(80);
  });

  it("doing a move again over the same time replaces it", () => {
    let s = apply(defaultScene(), { type: "applyMotion", motion: "walk" });
    s = apply(s, { type: "applyMotion", motion: "nod" });
    const len = motionLength(findMotion("nod")!);
    const span = s.animation.keys.filter((k) => k.t <= len + 0.001);
    // Only the nod's keys are left in its span: no stride in them.
    expect(span).toHaveLength(7);
    for (const k of span)
      expect(k.figures["fig-1"].joints.hipL.forward).toBe(0);
  });

  it("the animation grows to fit, within its limits", () => {
    const s = apply(defaultScene(), {
      type: "applyMotion",
      motion: "stretch",
      t: 8,
    });
    expect(s.animation.duration).toBeGreaterThanOrEqual(12);
    const r = applyAction(defaultScene(), {
      type: "applyMotion",
      motion: "stretch",
      t: 118,
    });
    expect(r.ok).toBe(false);
    const bad = applyAction(defaultScene(), {
      type: "applyMotion",
      motion: "moonwalk",
    });
    expect(bad.ok).toBe(false);
  });

  it("mirrored moves use the other side", () => {
    const s = apply(defaultScene(), {
      type: "applyMotion",
      motion: "kick",
      mirror: true,
    });
    const mid = evaluate(s, 0.5).scene.figures[0].pose.joints;
    expect(mid.hipL.forward).toBeGreaterThan(70);
    expect(mid.hipR.forward).toBeLessThan(20);
  });

  it("an animated link with a move fits and comes back", async () => {
    const s = apply(defaultScene(), { type: "applyMotion", motion: "walk" });
    const { param, animated } = await encodeSceneLink(s);
    expect(animated).toBe(true);
    const back = (await decodeSceneLink(param))!;
    expect(back.animation.keys).toHaveLength(s.animation.keys.length);
    expect(back.animation.keys[1].ease).toBe("spline");
  });
});

describe("typing a motion", () => {
  it("finds motions by name, word form, synonym and typo", () => {
    expect(top("run")).toBe("run");
    expect(top("running")).toBe("run");
    expect(top("eating")).toBe("eat");
    expect(top("ate ")).toBe("eat");
    expect(top("walkng")).toBe("walk");
    expect(top("wlak")).toBe("walk");
    expect(top("sprint")).toBe("run");
    expect(top("throwing a ball")).toBe("throw");
    expect(top("kick")).toBe("kick");
    expect(top("have dinner")).toBe("eat");
    expect(top("sip coffee")).toBe("drink");
    expect(top("say hello")).toBe("wave");
    expect(top("jumping jacks")).toBe("jumping-jacks");
    expect(top("sitting down")).toBe("sit-down");
    expect(top("dancing")).toBe("dance");
    expect(top("take a knee")).toBe("one-knee");
  });

  it("matches while typing", () => {
    expect(top("wal")).toBe("walk");
    expect(searchMotions("th").map((m) => m.motion.id)).toContain("throw");
    expect(searchMotions("")).toEqual([]);
    expect(searchMotions("zzzz")).toEqual([]);
  });

  it("reads side, count, speed and direction", () => {
    expect(parseQuery("left kick").options.mirror).toBe(true);
    expect(parseQuery("walk 3 times").options.repeat).toBe(3);
    expect(parseQuery("clap twice").options.repeat).toBe(2);
    expect(parseQuery("run slowly").options.slow).toBeGreaterThan(1);
    expect(parseQuery("walk in place").options.inPlace).toBe(true);
    expect(parseQuery("walk backwards").options.backwards).toBe(true);
    const m = searchMotions("kick with the left leg")[0];
    expect(m.motion.id).toBe("kick");
    expect(m.options.mirror).toBe(true);
  });

  it("stems common forms", () => {
    expect(stem("running")).toBe("run");
    expect(stem("kicks")).toBe("kick");
    expect(stem("dancing")).toBe(stem("dance"));
    expect(stem("waving")).toBe(stem("wave"));
  });
});
