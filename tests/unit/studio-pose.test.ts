import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { jointQuaternion, type RigDirections } from "@/lib/engine/posing";
import {
  applyAction,
  coalesceKey,
  describeAction,
  tryApplyAction,
} from "@/lib/studio/actions";
import {
  JOINTS,
  JOINT_IDS,
  POSE_PRESETS,
  PoseSchema,
  flattenJoints,
  mirrorJoints,
  neutralJoints,
  unflattenJoints,
} from "@/lib/studio/pose";
import { defaultScene } from "@/lib/studio/presets";
import { SceneSchema, type SceneDoc } from "@/lib/studio/schema";
import { decodeScene, encodeScene } from "@/lib/studio/share";

const scene = () => defaultScene();
const apply = (s: SceneDoc, a: unknown) => {
  const r = tryApplyAction(s, a);
  if (!r.ok) throw new Error(r.error);
  return r.scene;
};

describe("pose model", () => {
  it("defaults to the scan's A-pose", () => {
    const s = scene();
    expect(s.pose.preset).toBe("neutral");
    expect(flattenJoints(s.pose.joints).every((v) => v === 0)).toBe(true);
  });

  it("scenes saved before posing existed still load, in the A-pose", () => {
    const { pose: _pose, ...old } = scene();
    const parsed = SceneSchema.parse(old);
    expect(parsed.pose).toEqual({ preset: "neutral", joints: neutralJoints() });
  });

  it("every preset is valid and within joint limits", () => {
    for (const p of POSE_PRESETS) {
      expect(
        PoseSchema.safeParse({ preset: p.id, joints: p.joints }).success,
      ).toBe(true);
    }
  });

  it("rejects out-of-range angles and unknown joints or movements", () => {
    const joints = neutralJoints() as Record<string, Record<string, number>>;
    joints.elbowL.bend = 200;
    expect(PoseSchema.safeParse({ preset: "x", joints }).success).toBe(false);
    joints.elbowL.bend = 0;
    expect(
      PoseSchema.safeParse({
        preset: "x",
        joints: { ...joints, tail: { wag: 1 } },
      }).success,
    ).toBe(false);
    expect(
      PoseSchema.safeParse({
        preset: "x",
        joints: { ...joints, elbowL: { bend: 0, twist: 10 } },
      }).success,
    ).toBe(false);
  });

  it("flatten/unflatten round-trips in a fixed order", () => {
    const joints = POSE_PRESETS.find((p) => p.id === "thinker")!.joints;
    expect(unflattenJoints(flattenJoints(joints))).toEqual(joints);
  });

  it("mirror swaps sides and flips the trunk's sideways angles", () => {
    const raised = POSE_PRESETS.find((p) => p.id === "hand-raised")!.joints;
    const m = mirrorJoints({
      ...raised,
      head: { nod: 5, tilt: 10, turn: 20 },
      spine: { bend: 3, side: 4, twist: 6 },
    });
    expect(m.shoulderL).toEqual(raised.shoulderR);
    expect(m.shoulderR).toEqual(raised.shoulderL);
    expect(m.head).toEqual({ nod: 5, tilt: -10, turn: -20 });
    expect(m.spine).toEqual({ bend: 3, side: -4, twist: -6 });
    expect(mirrorJoints(m)).toEqual({
      ...raised,
      head: { nod: 5, tilt: 10, turn: 20 },
      spine: { bend: 3, side: 4, twist: 6 },
    });
  });
});

describe("pose actions", () => {
  it("applies presets, and refuses unknown ones", () => {
    const s = apply(scene(), { type: "applyPosePreset", presetId: "arms-up" });
    expect(s.pose.preset).toBe("arms-up");
    expect(s.pose.joints.shoulderL.raise).toBe(140);
    expect(s.preset).toBe(scene().preset); // lighting preset untouched
    expect(
      tryApplyAction(scene(), { type: "applyPosePreset", presetId: "nope" }).ok,
    ).toBe(false);
  });

  it("edits one movement of one joint and marks the pose custom", () => {
    const s = apply(scene(), {
      type: "updateJoint",
      joint: "wristR",
      patch: { lift: 30 },
    });
    expect(s.pose.preset).toBe("custom");
    expect(s.pose.joints.wristR).toEqual({ bend: 0, lift: 30, twist: 0 });
  });

  it("rejects out-of-range values and movements a joint doesn't have", () => {
    const before = scene();
    const tooFar = tryApplyAction(before, {
      type: "updateJoint",
      joint: "elbowL",
      patch: { bend: 170 },
    });
    expect(tooFar.ok).toBe(false);
    const noSuch = tryApplyAction(before, {
      type: "updateJoint",
      joint: "elbowL",
      patch: { twist: 10 },
    });
    expect(noSuch).toEqual({
      ok: false,
      error: 'Left elbow has no "twist" movement',
    });
    expect(
      tryApplyAction(before, {
        type: "updateJoint",
        joint: "tail",
        patch: { wag: 1 },
      }).ok,
    ).toBe(false);
  });

  it("mirror and reset", () => {
    const raised = apply(scene(), {
      type: "applyPosePreset",
      presetId: "hand-raised",
    });
    const m = apply(raised, { type: "mirrorPose" });
    expect(m.pose.joints.shoulderL.raise).toBe(120);
    const reset = applyAction(m, {
      type: "applyPosePreset",
      presetId: "neutral",
    });
    expect(reset.ok && flattenJoints(reset.scene.pose.joints)).toEqual(
      flattenJoints(neutralJoints()),
    );
  });

  it("slider drags on one joint coalesce; labels read well", () => {
    const a = { type: "updateJoint", joint: "elbowL", patch: { bend: 10 } };
    const b = { type: "updateJoint", joint: "elbowL", patch: { bend: 40 } };
    const c = { type: "updateJoint", joint: "elbowR", patch: { bend: 40 } };
    expect(coalesceKey(a as never)).toBe(coalesceKey(b as never));
    expect(coalesceKey(a as never)).not.toBe(coalesceKey(c as never));
    expect(describeAction(scene(), a as never)).toBe("Left elbow: bend");
    expect(
      describeAction(scene(), {
        type: "applyPosePreset",
        presetId: "thinker",
      }),
    ).toBe("Pose: Hand to chin");
  });
});

describe("pose in share links", () => {
  it("round-trips a pose", () => {
    const s = apply(
      apply(scene(), { type: "applyPosePreset", presetId: "stride" }),
      { type: "updateJoint", joint: "head", patch: { turn: 25 } },
    );
    const back = decodeScene(encodeScene(s));
    expect(back?.pose).toEqual(s.pose);
  });

  it("leaves unposed links exactly as before (no pose field)", () => {
    const json = atob(
      encodeScene(scene()).replace(/-/g, "+").replace(/_/g, "/"),
    );
    expect(json).not.toContain('"po"');
    expect(decodeScene(encodeScene(scene()))?.pose.preset).toBe("neutral");
  });

  it("rejects a link with a tampered pose", () => {
    const s = apply(scene(), { type: "applyPosePreset", presetId: "arms-up" });
    const payload = JSON.parse(
      atob(encodeScene(s).replace(/-/g, "+").replace(/_/g, "/")),
    );
    payload.po[1][3] = 999; // shoulderL.raise far out of range
    const bad = btoa(JSON.stringify(payload))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeScene(bad)).toBeNull();
  });
});

describe("joint rotations (figure faces +Z, its left is +X)", () => {
  const down = (x: number) => new THREE.Vector3(x, -1, 0).normalize();
  const dirs: RigDirections = {
    upperArmL: down(0.5),
    upperArmR: down(-0.5),
    forearmL: down(0.4),
    forearmR: down(-0.4),
    thighL: down(0.05),
    thighR: down(-0.05),
  };
  const turn = (
    joint: (typeof JOINT_IDS)[number],
    values: Record<string, number>,
    v: THREE.Vector3,
  ) => v.clone().applyQuaternion(jointQuaternion(joint, values, dirs));

  it("raising either shoulder lifts the arm up and out to its own side", () => {
    const l = turn("shoulderL", { raise: 90 }, dirs.upperArmL);
    const r = turn("shoulderR", { raise: 90 }, dirs.upperArmR);
    expect(l.y).toBeGreaterThan(0.4);
    expect(l.x).toBeGreaterThan(0);
    expect(r.y).toBeCloseTo(l.y, 6);
    expect(r.x).toBeCloseTo(-l.x, 6);
  });

  it("swinging the shoulder forward and bending the elbow move towards +Z", () => {
    expect(
      turn("shoulderL", { forward: 60 }, dirs.upperArmL).z,
    ).toBeGreaterThan(0.5);
    expect(turn("elbowR", { bend: 90 }, dirs.forearmR).z).toBeCloseTo(1, 6);
    expect(turn("hipL", { forward: 45 }, dirs.thighL).z).toBeGreaterThan(0.5);
  });

  it("knees bend backwards; heads turn and nod the right way", () => {
    expect(turn("kneeL", { bend: 90 }, new THREE.Vector3(0, -1, 0)).z).toBe(-1);
    const face = new THREE.Vector3(0, 0, 1);
    expect(turn("head", { turn: 90 }, face).x).toBeCloseTo(1, 6); // its left
    expect(turn("head", { nod: 90 }, face).y).toBeCloseTo(-1, 6); // chin down
  });

  it("wrist twist turns the palm forward on both sides", () => {
    // Palms face the body midline in the scan.
    const palmL = new THREE.Vector3(-1, 0, 0);
    const palmR = new THREE.Vector3(1, 0, 0);
    expect(
      turn("wristL", { twist: 90 }, palmL.projectOnPlane(dirs.forearmL)).z,
    ).toBeGreaterThan(0.9);
    expect(
      turn("wristR", { twist: 90 }, palmR.projectOnPlane(dirs.forearmR)).z,
    ).toBeGreaterThan(0.9);
  });

  it("zero angles are the bind pose for every joint", () => {
    for (const id of JOINT_IDS) {
      const zeros = Object.fromEntries(
        Object.keys(JOINTS[id].dofs).map((k) => [k, 0]),
      );
      expect(
        jointQuaternion(id, zeros, dirs).equals(new THREE.Quaternion()),
      ).toBe(true);
    }
  });
});
