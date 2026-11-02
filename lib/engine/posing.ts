/** Maps pose angles (lib/studio/pose.ts) onto the rigged skeleton.
 *
 * The rig's bones are world-aligned in the bind pose (see
 * scripts/rig-mannequin.mjs), so each bone's local frame starts out as
 * the figure's own axes: +Y up, facing +Z, its left = +X. A joint's
 * rotation is a product of axis-angle turns in that frame; children
 * inherit their parent's rotation, so an elbow bends correctly whatever
 * the shoulder is doing. */

import * as THREE from "three";
import { JOINTS, type JointId, type PoseJoints } from "@/lib/studio/pose";

export const BONE_NAMES = [
  "pelvis",
  "spine",
  "neck",
  "shoulderL",
  "elbowL",
  "wristL",
  "shoulderR",
  "elbowR",
  "wristR",
  "hipL",
  "kneeL",
  "hipR",
  "kneeR",
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

/** Which bone each pose joint drives. */
export const JOINT_BONE: Record<JointId, BoneName> = {
  head: "neck",
  spine: "spine",
  shoulderL: "shoulderL",
  elbowL: "elbowL",
  wristL: "wristL",
  shoulderR: "shoulderR",
  elbowR: "elbowR",
  wristR: "wristR",
  hipL: "hipL",
  kneeL: "kneeL",
  hipR: "hipR",
  kneeR: "kneeR",
};

/** Bind-pose limb directions, measured from the rig. */
export interface RigDirections {
  upperArmL: THREE.Vector3;
  upperArmR: THREE.Vector3;
  forearmL: THREE.Vector3;
  forearmR: THREE.Vector3;
  thighL: THREE.Vector3;
  thighR: THREE.Vector3;
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const DEG = Math.PI / 180;

type Turn = [axis: THREE.Vector3, degrees: number];

/** Product of turns, outermost first: compose([a, b]) applies b, then a. */
function compose(turns: Turn[]): THREE.Quaternion {
  const q = new THREE.Quaternion();
  const t = new THREE.Quaternion();
  for (const [axis, deg] of turns) {
    if (deg === 0) continue;
    q.multiply(t.setFromAxisAngle(axis, deg * DEG));
  }
  return q;
}

/** Local rotation for one joint. `values` are degrees, keyed by the
 * joint's degrees of freedom. */
export function jointQuaternion(
  joint: JointId,
  values: Record<string, number>,
  dirs: RigDirections,
): THREE.Quaternion {
  const v = (k: string) => values[k] ?? 0;
  const side = joint.endsWith("L") ? 1 : -1;
  const s = side === 1 ? "L" : "R";
  switch (joint) {
    case "head":
      // Nod (chin down) about +X, tilt (crown to its left) about −Z,
      // turn (face to its left) about +Y.
      return compose([
        [Y, v("turn")],
        [X, v("nod")],
        [Z.clone().negate(), v("tilt")],
      ]);
    case "spine":
      return compose([
        [Y, v("twist")],
        [X, v("bend")],
        [Z.clone().negate(), v("side")],
      ]);
    case "shoulderL":
    case "shoulderR": {
      const arm = dirs[`upperArm${s}`];
      // Twist first (about the arm's own axis, positive rolls the front
      // of the arm outward), then raise in the frontal plane, then swing
      // forward about −X.
      return compose([
        [X.clone().negate(), v("forward")],
        [Z.clone().multiplyScalar(side), v("raise")],
        [arm.clone().multiplyScalar(-side), v("twist")],
      ]);
    }
    case "elbowL":
    case "elbowR": {
      // Flexion brings the forearm forward: axis ⟂ forearm and +Z.
      const axis = dirs[`forearm${s}`].clone().cross(Z).normalize();
      return compose([[axis, v("bend")]]);
    }
    case "wristL":
    case "wristR": {
      const forearm = dirs[`forearm${s}`];
      // In the scan the palms face the thighs. Bend moves the hand
      // towards the palm (in the frontal plane); lift swings the fingers
      // forward; twist turns the palm forward (supination) about the
      // forearm, applied last so it carries the bent hand with it.
      const bendAxis = Z.clone()
        .multiplyScalar(-side)
        .projectOnPlane(forearm)
        .normalize();
      const liftAxis = forearm.clone().cross(Z).normalize();
      return compose([
        [forearm.clone().multiplyScalar(-side), v("twist")],
        [bendAxis, v("bend")],
        [liftAxis, v("lift")],
      ]);
    }
    case "hipL":
    case "hipR": {
      const thigh = dirs[`thigh${s}`];
      return compose([
        [X.clone().negate(), v("forward")],
        [Z.clone().multiplyScalar(side), v("out")],
        [thigh.clone().multiplyScalar(-side), v("twist")],
      ]);
    }
    case "kneeL":
    case "kneeR":
      // The shin swings backwards.
      return compose([[X, v("bend")]]);
  }
}

/** Set every driven bone's rotation from a pose. */
export function applyPose(
  bones: Record<BoneName, THREE.Bone>,
  joints: PoseJoints,
  dirs: RigDirections,
): void {
  for (const id of Object.keys(JOINTS) as JointId[]) {
    const values = (joints as Record<string, Record<string, number>>)[id];
    bones[JOINT_BONE[id]].quaternion.copy(jointQuaternion(id, values, dirs));
  }
}
