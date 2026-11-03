import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  BONE_NAMES,
  CORE_BONES,
  JOINT_DOTS,
  dragVariables,
  makeReach,
  solveReach,
  type BoneName,
  type RigDirections,
} from "@/lib/engine/posing";
import {
  coalesceKey,
  describeAction,
  tryApplyAction,
} from "@/lib/studio/actions";
import { JOINT_IDS, neutralJoints, type PoseJoints } from "@/lib/studio/pose";
import { defaultScene } from "@/lib/studio/presets";

/** A small world-aligned skeleton laid out like the scanned A-pose
 * (figure faces +Z, its left is +X), built the same way the rig is. */
function skeleton() {
  const at: Partial<Record<BoneName, [number, number, number]>> = {
    pelvis: [0, 1.0, 0],
    spine: [0, 1.15, 0],
    neck: [0, 1.5, 0],
    shoulderL: [0.18, 1.45, 0],
    elbowL: [0.33, 1.2, 0],
    wristL: [0.45, 0.98, 0],
    shoulderR: [-0.18, 1.45, 0],
    elbowR: [-0.33, 1.2, 0],
    wristR: [-0.45, 0.98, 0],
    hipL: [0.1, 0.95, 0],
    kneeL: [0.12, 0.5, 0],
    hipR: [-0.1, 0.95, 0],
    kneeR: [-0.12, 0.5, 0],
  };
  const parent: Partial<Record<BoneName, BoneName>> = {
    spine: "pelvis",
    neck: "spine",
    shoulderL: "spine",
    elbowL: "shoulderL",
    wristL: "elbowL",
    shoulderR: "spine",
    elbowR: "shoulderR",
    wristR: "elbowR",
    hipL: "pelvis",
    kneeL: "hipL",
    hipR: "pelvis",
    kneeR: "hipR",
  };
  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const name of CORE_BONES) {
    const b = new THREE.Bone();
    b.name = name;
    const p = new THREE.Vector3(...at[name]!);
    const up = parent[name];
    if (up) {
      b.position.copy(p.sub(new THREE.Vector3(...at[up]!)));
      bones[up].add(b);
    } else b.position.copy(p);
    bones[name] = b;
  }
  bones.pelvis.updateMatrixWorld(true);
  const v = (n: BoneName) => new THREE.Vector3(...at[n]!);
  const dir = (a: BoneName, b: BoneName) => v(b).sub(v(a)).normalize();
  const dirs: RigDirections = {
    upperArmL: dir("shoulderL", "elbowL"),
    upperArmR: dir("shoulderR", "elbowR"),
    forearmL: dir("elbowL", "wristL"),
    forearmR: dir("elbowR", "wristR"),
    thighL: dir("hipL", "kneeL"),
    thighR: dir("hipR", "kneeR"),
  };
  return { bones, dirs };
}

/** Drag `point` (world, on bone `bone`) towards `to` in small pointer
 * steps, like a real drag; returns the final angles and grabbed point. */
function drag(
  bone: BoneName,
  point: THREE.Vector3,
  to: THREE.Vector3,
  joints: PoseJoints = neutralJoints(),
) {
  const { bones, dirs } = skeleton();
  const vars = dragVariables(bone);
  const all = joints as Record<string, Record<string, number>>;
  const reach = makeReach(
    bones,
    dirs,
    joints,
    vars,
    bones[bone],
    bones[bone].worldToLocal(point.clone()),
  );
  let x = vars.map((v) => all[v.joint][v.dof]);
  for (let i = 1; i <= 20; i++) {
    x = solveReach(vars, x, reach, point.clone().lerp(to, i / 20));
  }
  return { vars, x, reached: reach(x) };
}

describe("updateJoints action", () => {
  it("changes several joints as one step and marks the pose custom", () => {
    const r = tryApplyAction(defaultScene(), {
      type: "updateJoints",
      patches: { shoulderR: { raise: 90, forward: 10 }, elbowR: { bend: 30 } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scene.figures[0].pose.preset).toBe("custom");
    expect(r.scene.figures[0].pose.joints.shoulderR).toEqual({
      raise: 90,
      forward: 10,
      twist: 0,
    });
    expect(r.scene.figures[0].pose.joints.elbowR.bend).toBe(30);
  });

  it("rejects out-of-range angles, unknown movements and empty patches", () => {
    const bad = (patches: unknown) =>
      tryApplyAction(defaultScene(), { type: "updateJoints", patches }).ok;
    expect(bad({ elbowR: { bend: 170 } })).toBe(false);
    expect(bad({ elbowR: { twist: 5 } })).toBe(false);
    expect(bad({ tail: { wag: 1 } })).toBe(false);
    expect(bad({})).toBe(false);
  });

  it("a whole drag coalesces into one undo step, labelled by body part", () => {
    const a = {
      type: "updateJoints" as const,
      patches: { shoulderR: { raise: 10, forward: 0 }, elbowR: { bend: 5 } },
    };
    const b = {
      type: "updateJoints" as const,
      patches: { elbowR: { bend: 50 }, shoulderR: { forward: 9, raise: 80 } },
    };
    expect(coalesceKey(a)).toBe(coalesceKey(b));
    expect(describeAction(defaultScene(), a)).toBe("Move right arm");
  });
});

describe("drag to pose", () => {
  it("each body part drives the joint above it; a hand moves the whole arm", () => {
    const names = (b: BoneName) =>
      dragVariables(b).map((v) => `${v.joint}.${v.dof}`);
    expect(names("elbowL")).toEqual(["elbowL.bend"]);
    expect(names("kneeR")).toEqual(["kneeR.bend"]);
    expect(names("wristR")).toEqual([
      "shoulderR.raise",
      "shoulderR.forward",
      "elbowR.bend",
    ]);
    expect(names("pelvis")).toEqual([]);
    // Twists stay on the sliders.
    for (const b of BONE_NAMES)
      expect(dragVariables(b).some((v) => v.dof === "twist")).toBe(false);
  });

  it("dragging a hand up lifts the arm and the hand follows the pointer", () => {
    const hand = new THREE.Vector3(-0.5, 0.9, 0);
    const above = new THREE.Vector3(-0.35, 1.95, 0.05);
    const { vars, x, reached } = drag("wristR", hand, above);
    const raise = x[vars.findIndex((v) => v.dof === "raise")];
    expect(raise).toBeGreaterThan(100);
    expect(reached.distanceTo(above)).toBeLessThan(0.03);
  });

  it("dragging a forearm forwards bends the elbow", () => {
    const forearm = new THREE.Vector3(0.4, 1.08, 0);
    const front = new THREE.Vector3(0.36, 1.2, 0.2);
    const { x } = drag("elbowL", forearm, front);
    expect(x[0]).toBeGreaterThan(30);
  });

  it("never leaves the joint's limits, even dragged somewhere unreachable", () => {
    // Pull the shin forwards: a knee only bends backwards.
    const shin = new THREE.Vector3(0.12, 0.3, 0);
    const { vars, x } = drag("kneeL", shin, new THREE.Vector3(0.12, 0.4, 0.4));
    x.forEach((v, i) => {
      expect(v).toBeGreaterThanOrEqual(vars[i].min);
      expect(v).toBeLessThanOrEqual(vars[i].max);
    });
    // And a hand flung far away stays within every arm limit.
    const far = drag(
      "wristL",
      new THREE.Vector3(0.5, 0.9, 0),
      new THREE.Vector3(3, -2, 3),
    );
    far.x.forEach((v, i) => {
      expect(v).toBeGreaterThanOrEqual(far.vars[i].min);
      expect(v).toBeLessThanOrEqual(far.vars[i].max);
    });
  });

  it("small pointer moves give small changes (no jumps)", () => {
    const { bones, dirs } = skeleton();
    const vars = dragVariables("wristR");
    const hand = new THREE.Vector3(-0.5, 0.9, 0);
    const reach = makeReach(
      bones,
      dirs,
      neutralJoints(),
      vars,
      bones.wristR,
      bones.wristR.worldToLocal(hand.clone()),
    );
    const x = solveReach(
      vars,
      [0, 0, 0],
      reach,
      hand.clone().add(new THREE.Vector3(0, 0.01, 0)),
    );
    for (const v of x) expect(Math.abs(v)).toBeLessThan(3);
  });
});

describe("joint dots", () => {
  it("every posable joint has exactly one dot, driving that joint only", () => {
    expect(JOINT_DOTS.map((d) => d.joint).sort()).toEqual(
      [...JOINT_IDS].sort(),
    );
    for (const d of JOINT_DOTS) {
      expect(d.vars.length).toBeGreaterThan(0);
      expect(d.vars.every((v) => v.joint === d.joint)).toBe(true);
      expect(d.vars.some((v) => v.dof === "twist")).toBe(false);
    }
  });

  it("pulling a hanging hand's wrist dot straight up still bends it", () => {
    const { bones, dirs } = skeleton();
    const dot = JOINT_DOTS.find((d) => d.bone === "wristL")!;
    const wrist = bones.wristL.getWorldPosition(new THREE.Vector3());
    const tip = wrist.clone().add(dirs.forearmL.clone().multiplyScalar(0.18));
    const reach = makeReach(
      bones,
      dirs,
      neutralJoints(),
      dot.vars,
      bones.wristL,
      bones.wristL.worldToLocal(tip.clone()),
    );
    // Exactly opposite the way the hand points: no gradient to follow.
    const to = tip.clone().add(dirs.forearmL.clone().multiplyScalar(-0.3));
    let x = dot.vars.map(() => 0);
    for (let i = 1; i <= 10; i++)
      x = solveReach(dot.vars, x, reach, tip.clone().lerp(to, i / 10));
    expect(Math.max(...x.map(Math.abs))).toBeGreaterThan(30);
    expect(reach(x).distanceTo(to)).toBeLessThan(tip.distanceTo(to));
  });

  it("dragging the wrist dot bends the hand, and leaves the arm alone", () => {
    const { bones, dirs } = skeleton();
    const dot = JOINT_DOTS.find((d) => d.bone === "wristR")!;
    const wrist = bones.wristR.getWorldPosition(new THREE.Vector3());
    // Fingertips about a hand's length on along the forearm.
    const tip = wrist.clone().add(dirs.forearmR.clone().multiplyScalar(0.18));
    const reach = makeReach(
      bones,
      dirs,
      neutralJoints(),
      dot.vars,
      bones.wristR,
      bones.wristR.worldToLocal(tip.clone()),
    );
    // Pointer moves forwards (+Z): the fingers swing forwards.
    let x = dot.vars.map(() => 0);
    const to = tip.clone().add(new THREE.Vector3(0, 0, 0.1));
    for (let i = 1; i <= 10; i++)
      x = solveReach(dot.vars, x, reach, tip.clone().lerp(to, i / 10));
    expect(Math.max(...x.map(Math.abs))).toBeGreaterThan(20);
    expect(reach(x).z).toBeGreaterThan(0.05);
    // Only wrist angles were in play: the wrist itself hasn't moved.
    expect(
      bones.wristR.getWorldPosition(new THREE.Vector3()).distanceTo(wrist),
    ).toBeLessThan(1e-9);
  });
});
