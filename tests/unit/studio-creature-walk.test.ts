import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyAction, type SceneAction } from "@/lib/studio/actions";
import { planBeats } from "@/lib/studio/beats";
import {
  CREATURE_STRIDES,
  CREATURE_WALK_CLIP_SECONDS,
  creatureStrideMeters,
  creatureWalkPhase,
  motionAllowedForCreature,
} from "@/lib/studio/creatureWalk";
import { readCreaturesList } from "@/lib/studio/creatures";
import { findMotion, planMotion } from "@/lib/studio/motions";
import { neutralJoints } from "@/lib/studio/pose";
import { defaultScene } from "@/lib/studio/presets";
import { SceneSchema, type SceneDoc } from "@/lib/studio/schema";

const root = fileURLToPath(new URL("../../", import.meta.url));
const readJson = (p: string) => JSON.parse(readFileSync(`${root}${p}`, "utf8"));

const creatures = readCreaturesList(
  readJson("public/creatures/creatures.json"),
);

const apply = (s: SceneDoc, ...actions: SceneAction[]) =>
  actions.reduce((acc, a) => {
    const r = applyAction(acc, a);
    if (!r.ok) throw new Error(r.error);
    return r.scene;
  }, s);

const lionScene = () =>
  apply(defaultScene(), {
    type: "setCreature",
    figure: "fig-1",
    creature: "creature-lion",
    name: "Lion",
  });

const lionWalk = (s: SceneDoc, extra: Partial<SceneAction> = {}) =>
  apply(s, {
    type: "applyMotion",
    motion: "walk",
    figure: "fig-1",
    t: 0,
    ...extra,
  } as SceneAction);

describe("creature strides", () => {
  it("covers every served creature, at the stride the leg swing gives", () => {
    expect(creatures.length).toBe(12);
    for (const e of creatures) {
      const stride = CREATURE_STRIDES[e.id];
      expect(stride, e.id).toBeGreaterThan(0);
      // Hip height above ground, in raw mesh units, scaled to scene
      // metres — the stride is 4 × leg × sin(21°), the no-slide stride
      // for a ±21° leg swing (see lib/studio/creatureWalk.ts).
      const id = e.file.replace(".glb", "");
      const joints = readJson(`assets/creatures/rigged/${id}.joints.json`);
      const bones = Object.fromEntries(
        joints.bones.map((b: { name: string; head: number[] }) => [b.name, b]),
      );
      const hip = bones.legFL?.head ?? bones.legL.head;
      const leg =
        (hip[2] - joints.analysis.z0) * (e.heightMeters / joints.analysis.H);
      const expected = 4 * leg * Math.sin((21 * Math.PI) / 180);
      expect(stride, e.id).toBeCloseTo(expected, 1);
      expect(creatureStrideMeters(e.id)).toBe(stride);
    }
    expect(creatureStrideMeters(undefined)).toBe(0.5);
    expect(creatureStrideMeters("creature-nope")).toBe(0.5);
  });
});

describe("creature walk planning", () => {
  it("walks on the clip's timing, one stride per second, with a neutral pose", () => {
    const walk = findMotion("walk")!;
    const plan = planMotion(
      walk,
      { x: 0, z: 0, rotation: 180 },
      {
        cycle: CREATURE_WALK_CLIP_SECONDS,
        travel: creatureStrideMeters("creature-lion"),
        neutral: true,
      },
    );
    expect(plan.length).toBeCloseTo(4, 5);
    expect(plan.repeat).toBe(4);
    // One stride per cycle, straight ahead, on the floor.
    const at = (n: number) =>
      plan.steps.filter((s) => Math.abs(s.at - n) < 0.01)[0];
    expect(at(1).z).toBeCloseTo(at(0).z - 0.49, 2);
    expect(at(4).z).toBeCloseTo(at(0).z - 4 * 0.49, 2);
    expect(plan.steps.every((s) => s.y === 0)).toBe(true);
    const neutral = neutralJoints();
    expect(
      plan.steps.every(
        (s) => JSON.stringify(s.joints) === JSON.stringify(neutral),
      ),
    ).toBe(true);
  });

  it("a creature walk applies; any other motion is refused, plainly", () => {
    const scene = lionScene();
    const walked = lionWalk(scene);
    expect(SceneSchema.safeParse(walked).success).toBe(true);
    expect(walked.animation.keys.length).toBeGreaterThan(1);
    for (const id of ["wave", "run", "sit", "jump", "dance", "stand"]) {
      const r = applyAction(scene, {
        type: "applyMotion",
        motion: id,
        figure: "fig-1",
      });
      expect(r.ok, id).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/can only walk/i);
      expect(motionAllowedForCreature(findMotion(id)!), id).toBe(false);
    }
    expect(motionAllowedForCreature(findMotion("walk")!)).toBe(true);
    // Humans are untouched.
    const human = applyAction(defaultScene(), {
      type: "applyMotion",
      motion: "wave",
      figure: "fig-1",
    });
    expect(human.ok).toBe(true);
  });

  it("a creature walk in place still keys, on the spot", () => {
    const scene = lionWalk(lionScene(), { inPlace: true });
    const keys = scene.animation.keys;
    expect(keys.length).toBeGreaterThan(4);
    expect(
      keys.every(
        (k) => k.figures["fig-1"].x === 0 && k.figures["fig-1"].z === 0,
      ),
    ).toBe(true);
  });

  it("beats: a creature walks, turns and holds — but doesn't wave or sit", () => {
    const scene = lionScene();
    const plan = planBeats(scene.figures[0], 0, [
      {
        text: "walk 2 times",
        do: { kind: "motion", motion: "walk", repeat: 2 },
      },
      { text: "face the camera", do: { kind: "turn", to: "camera" } },
      { text: "pause 1 s", do: { kind: "hold", seconds: 1 } },
    ]);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.end).toBeCloseTo(2 + 0.8 + 1, 5);
    for (const motion of ["wave", "sit"]) {
      const bad = planBeats(scene.figures[0], 0, [
        { text: motion, do: { kind: "motion", motion } },
      ]);
      expect("error" in bad && bad.error, motion).toMatch(/can only walk/i);
    }
  });
});

describe("creature walk phase", () => {
  it("follows the distance travelled, loops every stride, and stands before and after", () => {
    // Walk from t=2 so "before" can be checked too.
    const scene = lionWalk(lionScene(), { t: 2 });
    expect(creatureWalkPhase(scene, "fig-1", 1)).toBeNull();
    const start = creatureWalkPhase(scene, "fig-1", 2);
    expect(start?.phase).toBeCloseTo(0, 5);
    expect(start?.weight).toBeCloseTo(0, 5);
    // Half a stride in: half a phase, fully blended in.
    const half = creatureWalkPhase(scene, "fig-1", 2.5);
    expect(half?.phase).toBeCloseTo(0.5, 1);
    expect(half?.weight).toBe(1);
    // One stride later the legs are where they were.
    const looped = creatureWalkPhase(scene, "fig-1", 3.5);
    expect(looped?.phase).toBeCloseTo(half!.phase, 1);
    // The walk ends at t=6: settling, then standing.
    expect(creatureWalkPhase(scene, "fig-1", 6)?.phase).toBeCloseTo(0, 5);
    expect(creatureWalkPhase(scene, "fig-1", 6.15)?.weight).toBeCloseTo(0.5, 1);
    expect(creatureWalkPhase(scene, "fig-1", 6.5)).toBeNull();
    // Not a creature, no phase.
    expect(creatureWalkPhase(defaultScene(), "fig-1", 0.5)).toBeNull();
  });

  it("a walk on the spot phases by the clock, and a long walk rounds a circle", () => {
    const spot = lionWalk(lionScene(), { inPlace: true });
    expect(creatureWalkPhase(spot, "fig-1", 0.5)?.phase).toBeCloseTo(0.5, 1);
    expect(creatureWalkPhase(spot, "fig-1", 1.5)?.phase).toBeCloseTo(0.5, 1);
    expect(creatureWalkPhase(spot, "fig-1", 4.5)).toBeNull();
    const long = lionWalk(lionScene(), { seconds: 20 });
    const mid = creatureWalkPhase(long, "fig-1", 10);
    expect(mid).not.toBeNull();
    expect(mid!.phase).toBeGreaterThanOrEqual(0);
    expect(mid!.phase).toBeLessThan(1);
  });
});
