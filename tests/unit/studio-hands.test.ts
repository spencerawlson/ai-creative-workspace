import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { jointQuaternion, type RigDirections } from "@/lib/engine/posing";
import { tryApplyAction } from "@/lib/studio/actions";
import {
  FACE_JOINT_IDS,
  FINGERS,
  HAND_SHAPES,
  JOINT_IDS,
  PoseJointsSchema,
  flattenJoints,
  groupOfJoint,
  handShapePatches,
  isFaceJoint,
  mirrorJoints,
  neutralJoints,
  unflattenJoints,
} from "@/lib/studio/pose";
import { defaultScene } from "@/lib/studio/presets";
import { SceneSchema } from "@/lib/studio/schema";

const LATER = /^(ankle|thumb|index|middle|ring|pinky)/;

describe("feet and fingers in the pose model", () => {
  it("adds ankles and 15 joints per hand, after the original joints", () => {
    const later = JOINT_IDS.filter((id) => LATER.test(id));
    expect(later).toHaveLength(2 + 2 * 15);
    // All new joints come last, so older flattened poses still line up;
    // the face came after them.
    const firstLater = JOINT_IDS.findIndex((id) => LATER.test(id));
    expect(
      JOINT_IDS.slice(firstLater).every(
        (id) => LATER.test(id) || isFaceJoint(id),
      ),
    ).toBe(true);
    expect(JOINT_IDS.slice(-FACE_JOINT_IDS.length)).toEqual([
      ...FACE_JOINT_IDS,
    ]);
    expect(groupOfJoint("index2R")).toBe("handR");
    expect(groupOfJoint("ankleL")).toBe("legL");
  });

  it("poses saved before feet and fingers still load, relaxed at 0", () => {
    const old = Object.fromEntries(
      Object.entries(neutralJoints()).filter(([id]) => !LATER.test(id)),
    );
    const parsed = PoseJointsSchema.parse(old);
    expect(parsed.index1L).toEqual({ curl: 0, spread: 0 });
    expect(parsed.ankleR).toEqual({ point: 0, tilt: 0 });
    // ...also inside a whole scene.
    const scene = defaultScene();
    scene.figures[0].pose.joints = old as never;
    expect(SceneSchema.safeParse(scene).success).toBe(true);
  });

  it("older, shorter flattened lists (share links) fill the rest with 0", () => {
    const full = flattenJoints(neutralJoints());
    const older = full.slice(0, 33); // the 33 values from before
    expect(older).toHaveLength(33);
    older[0] = 10; // head nod
    const joints = PoseJointsSchema.parse(unflattenJoints(older));
    expect(joints.head.nod).toBe(10);
    expect(joints.pinky3R.curl).toBe(0);
  });

  it("every hand shape is valid on both hands, as one action", () => {
    for (const side of ["L", "R"] as const)
      for (const h of HAND_SHAPES) {
        const r = tryApplyAction(defaultScene(), {
          type: "updateJoints",
          patches: handShapePatches(side, h.id)!,
        });
        expect(r.ok, `${h.id} ${side}`).toBe(true);
      }
    expect(handShapePatches("L", "nope")).toBeNull();
  });

  it("mirroring swaps the hands", () => {
    const j = neutralJoints() as unknown as Record<
      string,
      Record<string, number>
    >;
    j.index2L.curl = 70;
    j.ankleR.point = 30;
    const m = mirrorJoints(j as unknown as ReturnType<typeof neutralJoints>);
    expect(m.index2R.curl).toBe(70);
    expect(m.index2L.curl).toBe(0);
    expect(m.ankleL.point).toBe(30);
  });
});

describe("finger and ankle rotations", () => {
  // A right hand hanging down: palm facing +X (the body's midline),
  // thumb towards +Z (forward), as in the scan.
  const down = new THREE.Vector3(0, -1, 0);
  const dirs: RigDirections = {
    upperArmL: down,
    upperArmR: down,
    forearmL: down,
    forearmR: down,
    thighL: down,
    thighR: down,
    bones: Object.fromEntries(
      ["thumb", ...FINGERS].flatMap((f) =>
        [1, 2, 3].map((k) => [`${f}${k}R`, down.clone()]),
      ),
    ),
    palm: {
      R: {
        normal: new THREE.Vector3(1, 0, 0),
        thumb: new THREE.Vector3(0, 0, 1),
      },
      L: {
        normal: new THREE.Vector3(-1, 0, 0),
        thumb: new THREE.Vector3(0, 0, 1),
      },
    },
  };
  const turned = (joint: string, values: Record<string, number>) =>
    down.clone().applyQuaternion(jointQuaternion(joint as never, values, dirs));

  it("curl turns a finger towards the palm; sideways towards the thumb", () => {
    expect(turned("middle1R", { curl: 90, spread: 0 }).x).toBeCloseTo(1, 5);
    expect(turned("middle2R", { curl: 45 }).x).toBeGreaterThan(0.6);
    expect(turned("index1R", { curl: 0, spread: 20 }).z).toBeGreaterThan(0.3);
  });

  it("the thumb's base goes across the palm and out of it", () => {
    expect(turned("thumb1R", { across: 45, out: 0 }).z).toBeLessThan(-0.6);
    expect(turned("thumb1R", { across: 0, out: 45 }).x).toBeLessThan(-0.6);
  });

  it("the ankle points the toes down", () => {
    const toes = new THREE.Vector3(0, 0, 1).applyQuaternion(
      jointQuaternion("ankleR", { point: 45, tilt: 0 }, dirs),
    );
    expect(toes.y).toBeLessThan(-0.6);
  });

  it("an older rig (no finger directions) leaves fingers unturned", () => {
    const q = jointQuaternion(
      "index1R",
      { curl: 60, spread: 0 },
      { ...dirs, bones: undefined, palm: undefined },
    );
    expect(q.equals(new THREE.Quaternion())).toBe(true);
  });
});
