import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  HUMANOID_NAME,
  computeRetarget,
  isIdentityRetarget,
  matchHumanoid,
  parseBoneName,
} from "@/lib/engine/humanoid";
import {
  BONE_NAMES,
  applyPose,
  type BoneName,
  type RigDirections,
} from "@/lib/engine/posing";
import { MOTIONS, motionSteps } from "@/lib/studio/motions";
import {
  JOINTS,
  JOINT_IDS,
  POSE_PRESETS,
  type PoseJoints,
} from "@/lib/studio/pose";

type V3 = [number, number, number];

/** The mannequin's joints in the scanned A-pose (left side; the right is
 * mirrored), plus end points that aren't joints. */
const LEFT: Record<string, V3> = {
  shoulder: [0.18, 1.45, 0],
  elbow: [0.33, 1.2, 0],
  wrist: [0.45, 0.98, 0],
  thumb1: [0.47, 0.95, 0.03],
  thumb2: [0.49, 0.92, 0.05],
  thumb3: [0.5, 0.9, 0.06],
  thumbTip: [0.51, 0.88, 0.07],
  index1: [0.5, 0.9, 0.01],
  index2: [0.52, 0.86, 0.01],
  index3: [0.53, 0.83, 0.01],
  indexTip: [0.54, 0.81, 0.01],
  hip: [0.1, 0.95, 0],
  knee: [0.12, 0.5, 0],
  ankle: [0.13, 0.08, 0],
  toe: [0.13, 0.03, 0.1],
};
const CENTRE: Record<string, V3> = {
  pelvis: [0, 1.0, 0],
  spine: [0, 1.15, 0],
  neck: [0, 1.5, 0],
  head: [0, 1.6, 0],
};
const SIDES = ["L", "R"] as const;

function point(key: string): THREE.Vector3 {
  if (CENTRE[key]) return new THREE.Vector3(...CENTRE[key]);
  const s = key.slice(-1);
  const p = new THREE.Vector3(...LEFT[key.slice(0, -1)]);
  if (s === "R") p.x = -p.x;
  return p;
}

/** Mannequin bones and the parent of each (end points hang off bones). */
const REF_PARENT: Record<string, string | null> = {
  pelvis: null,
  spine: "pelvis",
  neck: "spine",
  head: "neck",
  ...Object.fromEntries(
    SIDES.flatMap((s) => [
      [`shoulder${s}`, "spine"],
      [`elbow${s}`, `shoulder${s}`],
      [`wrist${s}`, `elbow${s}`],
      [`thumb1${s}`, `wrist${s}`],
      [`thumb2${s}`, `thumb1${s}`],
      [`thumb3${s}`, `thumb2${s}`],
      [`thumbTip${s}`, `thumb3${s}`],
      [`index1${s}`, `wrist${s}`],
      [`index2${s}`, `index1${s}`],
      [`index3${s}`, `index2${s}`],
      [`indexTip${s}`, `index3${s}`],
      [`hip${s}`, "pelvis"],
      [`knee${s}`, `hip${s}`],
      [`ankle${s}`, `knee${s}`],
      [`toe${s}`, `ankle${s}`],
    ]),
  ),
};

/** Mixamo-named skeleton with extra bones the mannequin doesn't have. */
const MIXAMO: Record<string, { at: string | V3; parent: string | null }> = {
  Hips: { at: "pelvis", parent: null },
  Spine: { at: "spine", parent: "Hips" },
  Spine1: { at: [0, 1.3, 0], parent: "Spine" },
  Neck: { at: "neck", parent: "Spine1" },
  Head: { at: "head", parent: "Neck" },
  ...Object.fromEntries(
    SIDES.flatMap((s) => {
      const W = s === "L" ? "Left" : "Right";
      return [
        [
          `${W}Shoulder`,
          {
            at: s === "L" ? [0.06, 1.42, 0] : [-0.06, 1.42, 0],
            parent: "Spine1",
          },
        ],
        [`${W}Arm`, { at: `shoulder${s}`, parent: `${W}Shoulder` }],
        [`${W}ForeArm`, { at: `elbow${s}`, parent: `${W}Arm` }],
        [`${W}Hand`, { at: `wrist${s}`, parent: `${W}ForeArm` }],
        [`${W}HandThumb1`, { at: `thumb1${s}`, parent: `${W}Hand` }],
        [`${W}HandThumb2`, { at: `thumb2${s}`, parent: `${W}HandThumb1` }],
        [`${W}HandThumb3`, { at: `thumb3${s}`, parent: `${W}HandThumb2` }],
        [`${W}HandThumb4`, { at: `thumbTip${s}`, parent: `${W}HandThumb3` }],
        [`${W}HandIndex1`, { at: `index1${s}`, parent: `${W}Hand` }],
        [`${W}HandIndex2`, { at: `index2${s}`, parent: `${W}HandIndex1` }],
        [`${W}HandIndex3`, { at: `index3${s}`, parent: `${W}HandIndex2` }],
        [`${W}HandIndex4`, { at: `indexTip${s}`, parent: `${W}HandIndex3` }],
        [`${W}UpLeg`, { at: `hip${s}`, parent: "Hips" }],
        [`${W}Leg`, { at: `knee${s}`, parent: `${W}UpLeg` }],
        [`${W}Foot`, { at: `ankle${s}`, parent: `${W}Leg` }],
        [`${W}ToeBase`, { at: `toe${s}`, parent: `${W}Foot` }],
      ];
    }),
  ),
};
/** Which mannequin point each Mixamo bone sits on. */
const SAME_POINT = Object.entries(MIXAMO)
  .filter(([, v]) => typeof v.at === "string")
  .map(([k, v]) => [k, v.at as string] as const);

/** Seeded random numbers, so a failure can be reproduced. */
function random(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/** Place a bone so its world (figure-frame) position and rotation are
 * as given, whatever its parent's transform. */
function placeAt(
  obj: THREE.Object3D,
  parent: THREE.Object3D,
  pos: THREE.Vector3,
  quat: THREE.Quaternion,
) {
  parent.add(obj);
  parent.updateMatrixWorld(true);
  const local = parent.matrixWorld
    .clone()
    .invert()
    .multiply(
      new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1)),
    );
  local.decompose(obj.position, obj.quaternion, obj.scale);
  obj.updateMatrixWorld(true);
}

function dirsFrom(at: (k: string) => THREE.Vector3): RigDirections {
  const d = (a: string, b: string) => at(b).sub(at(a)).normalize();
  const dirs: RigDirections = {
    upperArmL: d("shoulderL", "elbowL"),
    upperArmR: d("shoulderR", "elbowR"),
    forearmL: d("elbowL", "wristL"),
    forearmR: d("elbowR", "wristR"),
    thighL: d("hipL", "kneeL"),
    thighR: d("hipR", "kneeR"),
    bones: {},
    palm: {
      L: {
        normal: new THREE.Vector3(-1, 0, 0),
        thumb: new THREE.Vector3(0, 0, 1),
      },
      R: {
        normal: new THREE.Vector3(1, 0, 0),
        thumb: new THREE.Vector3(0, 0, 1),
      },
    },
  };
  for (const s of SIDES)
    for (const f of ["thumb", "index"]) {
      dirs.bones![`${f}1${s}` as BoneName] = d(`${f}1${s}`, `${f}2${s}`);
      dirs.bones![`${f}2${s}` as BoneName] = d(`${f}2${s}`, `${f}3${s}`);
      dirs.bones![`${f}3${s}` as BoneName] = d(`${f}3${s}`, `${f}Tip${s}`);
    }
  return dirs;
}

/** The mannequin: world-aligned bones (identity rest rotations). */
function reference() {
  const root = new THREE.Group();
  const objects: Record<string, THREE.Object3D> = {};
  for (const [name, parent] of Object.entries(REF_PARENT)) {
    const isBone = (BONE_NAMES as readonly string[]).includes(name);
    const o = isBone ? new THREE.Bone() : new THREE.Object3D();
    o.name = name;
    placeAt(
      o,
      parent ? objects[parent] : root,
      point(name),
      new THREE.Quaternion(),
    );
    objects[name] = o;
  }
  const bones = Object.values(objects).filter(
    (o): o is THREE.Bone => (o as THREE.Bone).isBone,
  );
  return { root, objects, bones, dirs: dirsFrom(point) };
}

/** Turns an arm's rest pose from the A-pose up to a T-pose (about the
 * shoulder, in the frontal plane). */
function tPose(key: string): THREE.Vector3 {
  const p = point(key);
  const s = key.slice(-1);
  const arm =
    /^(shoulder|elbow|wrist|thumb|index)/.test(key) && "LR".includes(s);
  if (!arm) return p;
  const sh = point(`shoulder${s}`);
  const u = point(`elbow${s}`).sub(sh);
  const angle = Math.atan2(-u.y, Math.abs(u.x)) * (s === "L" ? 1 : -1);
  return p
    .sub(sh)
    .applyAxisAngle(new THREE.Vector3(0, 0, 1), angle)
    .add(sh);
}

/** A Mixamo-style character: T-pose, every bone at a random rest
 * rotation, extra bones, under a rotated and scaled armature. */
function character(seed = 7) {
  const rnd = random(seed);
  const root = new THREE.Group();
  const armature = new THREE.Object3D();
  armature.rotation.set(-Math.PI / 2, 0.3, 0);
  armature.scale.setScalar(0.01);
  root.add(armature);
  const bones: Record<string, THREE.Bone> = {};
  for (const [name, v] of Object.entries(MIXAMO)) {
    const b = new THREE.Bone();
    b.name = `mixamorig:${name}`;
    const pos =
      typeof v.at === "string" ? tPose(v.at) : new THREE.Vector3(...v.at);
    const q = new THREE.Quaternion()
      .random()
      .slerp(new THREE.Quaternion(), rnd() * 0.2);
    placeAt(b, v.parent ? bones[v.parent] : armature, pos, q);
    bones[name] = b;
  }
  // Measured where the bones are; the palm isn't used for lining up.
  return { root, bones, restDirs: dirsFrom(tPose) };
}

function posesToTry(): PoseJoints[] {
  const rnd = random(42);
  const randomPose = () =>
    Object.fromEntries(
      JOINT_IDS.map((id) => [
        id,
        Object.fromEntries(
          Object.entries(
            JOINTS[id].dofs as Record<string, { min: number; max: number }>,
          ).map(([k, d]) => [k, d.min + rnd() * (d.max - d.min)]),
        ),
      ]),
    ) as PoseJoints;
  const walk = MOTIONS.find((m) => m.id === "walk")!;
  return [
    ...POSE_PRESETS.map((p) => p.joints),
    ...motionSteps(walk, { x: 0, z: 0, rotation: 0 }).map((s) => s.joints),
    ...Array.from({ length: 20 }, randomPose),
  ];
}

describe("bone names", () => {
  it("reads sides and words from common rigs", () => {
    expect(parseBoneName("mixamorig:LeftForeArm")).toEqual({
      side: "L",
      base: "forearm",
    });
    expect(parseBoneName("J_Bip_R_UpperArm")).toEqual({
      side: "R",
      base: "upperarm",
    });
    expect(parseBoneName("J_Bip_C_Hips")).toEqual({ side: null, base: "hips" });
    expect(parseBoneName("DEF-upper_arm.L")).toEqual({
      side: "L",
      base: "upperarm",
    });
    expect(parseBoneName("calf_r")).toEqual({ side: "R", base: "calf" });
    expect(parseBoneName("leftIndexProximal")).toEqual({
      side: "L",
      base: "indexproximal",
    });
    expect(parseBoneName("ring_01_l")).toEqual({ side: "L", base: "ring01" });
    expect(parseBoneName("Armature|mixamorig:RightLeg")).toEqual({
      side: "R",
      base: "leg",
    });
  });

  const match = (names: string[][]) => {
    // names: chains from the root, each a list of nested bones
    const all = new Map<string, THREE.Bone>();
    for (const chain of names) {
      let parent: THREE.Bone | null = null;
      for (const n of chain) {
        let b = all.get(n);
        if (!b) {
          b = new THREE.Bone();
          b.name = n;
          parent?.add(b);
          all.set(n, b);
        }
        parent = b;
      }
    }
    const m = matchHumanoid([...all.values()]);
    return Object.fromEntries(Object.entries(m).map(([k, b]) => [k, b!.name]));
  };

  it("matches a VRoid skeleton", () => {
    const m = match([
      [
        "J_Bip_C_Hips",
        "J_Bip_C_Spine",
        "J_Bip_C_Chest",
        "J_Bip_C_UpperChest",
        "J_Bip_C_Neck",
        "J_Bip_C_Head",
      ],
      [
        "J_Bip_C_UpperChest",
        "J_Bip_L_Shoulder",
        "J_Bip_L_UpperArm",
        "J_Bip_L_LowerArm",
        "J_Bip_L_Hand",
        "J_Bip_L_Thumb1",
        "J_Bip_L_Thumb2",
        "J_Bip_L_Thumb3",
      ],
      ["J_Bip_L_Hand", "J_Bip_L_Little1", "J_Bip_L_Little2", "J_Bip_L_Little3"],
      [
        "J_Bip_C_Hips",
        "J_Bip_L_UpperLeg",
        "J_Bip_L_LowerLeg",
        "J_Bip_L_Foot",
        "J_Bip_L_ToeBase",
      ],
    ]);
    expect(m).toMatchObject({
      pelvis: "J_Bip_C_Hips",
      spine: "J_Bip_C_Spine",
      neck: "J_Bip_C_Neck",
      shoulderL: "J_Bip_L_UpperArm",
      elbowL: "J_Bip_L_LowerArm",
      wristL: "J_Bip_L_Hand",
      thumb1L: "J_Bip_L_Thumb1",
      thumb3L: "J_Bip_L_Thumb3",
      pinky1L: "J_Bip_L_Little1",
      hipL: "J_Bip_L_UpperLeg",
      kneeL: "J_Bip_L_LowerLeg",
      ankleL: "J_Bip_L_Foot",
    });
    expect(Object.values(m)).not.toContain("J_Bip_L_Shoulder");
  });

  it("matches VRM 1.0 finger names in order from the hand", () => {
    const m = match([
      ["hips", "spine", "chest", "neck"],
      [
        "chest",
        "rightUpperArm",
        "rightLowerArm",
        "rightHand",
        "rightThumbMetacarpal",
        "rightThumbProximal",
        "rightThumbDistal",
      ],
      [
        "rightHand",
        "rightMiddleProximal",
        "rightMiddleIntermediate",
        "rightMiddleDistal",
      ],
    ]);
    expect(m).toMatchObject({
      thumb1R: "rightThumbMetacarpal",
      thumb2R: "rightThumbProximal",
      thumb3R: "rightThumbDistal",
      middle1R: "rightMiddleProximal",
      middle3R: "rightMiddleDistal",
    });
  });

  it("matches an Unreal skeleton and skips finger metacarpals", () => {
    const m = match([
      ["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head"],
      [
        "spine_03",
        "clavicle_l",
        "upperarm_l",
        "lowerarm_l",
        "hand_l",
        "index_metacarpal_l",
        "index_01_l",
        "index_02_l",
        "index_03_l",
      ],
      ["pelvis", "thigh_r", "calf_r", "foot_r", "ball_r"],
    ]);
    expect(m).toMatchObject({
      pelvis: "pelvis",
      spine: "spine_01",
      neck: "neck_01",
      shoulderL: "upperarm_l",
      wristL: "hand_l",
      index1L: "index_01_l",
      index3L: "index_03_l",
      hipR: "thigh_r",
      kneeR: "calf_r",
      ankleR: "foot_r",
    });
  });

  it("names every mannequin bone in standard humanoid terms", () => {
    for (const b of BONE_NAMES) expect(HUMANOID_NAME[b]).toBeTruthy();
    expect(HUMANOID_NAME.shoulderL).toBe("leftUpperArm");
    expect(HUMANOID_NAME.pinky2R).toBe("rightLittleIntermediate");
    expect(new Set(Object.values(HUMANOID_NAME)).size).toBe(BONE_NAMES.length);
  });
});

describe("retargeting poses onto a character's skeleton", () => {
  it("leaves the mannequin's own skeleton exactly as before", () => {
    const ref = reference();
    const bones = matchHumanoid(ref.bones);
    const { retarget, problems } = computeRetarget(
      ref.root,
      bones,
      ref.dirs,
      ref.dirs,
    );
    expect(problems).toEqual([]);
    expect(isIdentityRetarget(retarget)).toBe(true);
    for (const joints of posesToTry().slice(0, 12)) {
      applyPose(bones, joints, ref.dirs);
      const plain = BONE_NAMES.filter((b) => bones[b]).map((b) =>
        bones[b]!.quaternion.clone(),
      );
      applyPose(bones, joints, ref.dirs, retarget);
      BONE_NAMES.filter((b) => bones[b]).forEach((b, i) =>
        expect(bones[b]!.quaternion.angleTo(plain[i])).toBeLessThan(1e-6),
      );
    }
  });

  it("puts a T-pose Mixamo character's joints where the mannequin's go", () => {
    const ref = reference();
    const refBones = matchHumanoid(ref.bones);
    const ch = character();
    const chBones = matchHumanoid(Object.values(ch.bones));
    expect(Object.keys(chBones).length).toBe(Object.keys(refBones).length);
    const { retarget, problems } = computeRetarget(
      ch.root,
      chBones,
      ch.restDirs,
      ref.dirs,
    );
    expect(problems).toEqual([]);
    expect(isIdentityRetarget(retarget)).toBe(false);

    for (const joints of posesToTry()) {
      applyPose(refBones, joints, ref.dirs);
      applyPose(chBones, joints, ref.dirs, retarget);
      ref.root.updateMatrixWorld(true);
      ch.root.updateMatrixWorld(true);
      for (const [mixamo, refPoint] of SAME_POINT) {
        const a = ch.bones[mixamo].getWorldPosition(new THREE.Vector3());
        const b = ref.objects[refPoint].getWorldPosition(new THREE.Vector3());
        expect(a.distanceTo(b), `${mixamo} vs ${refPoint}`).toBeLessThan(1e-6);
      }
    }
  });

  it("reports a skeleton whose bones are nested differently", () => {
    const ref = reference();
    const bones = matchHumanoid(ref.bones);
    // An elbow hanging off the spine instead of the shoulder.
    ref.objects.spine.attach(ref.objects.elbowL);
    const { problems } = computeRetarget(ref.root, bones, ref.dirs, ref.dirs);
    expect(problems.join()).toMatch(/elbowL: expected under shoulderL/);
  });
});
