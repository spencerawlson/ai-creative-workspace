/** Maps pose angles (lib/studio/pose.ts) onto the rigged skeleton.
 *
 * The rig's bones are world-aligned in the bind pose (see
 * scripts/rig-mannequin.mjs), so each bone's local frame starts out as
 * the figure's own axes: +Y up, facing +Z, its left = +X. A joint's
 * rotation is a product of axis-angle turns in that frame; children
 * inherit their parent's rotation, so an elbow bends correctly whatever
 * the shoulder is doing. */

import * as THREE from "three";
import {
  FINGERS,
  JOINTS,
  type JointId,
  type PoseJoints,
} from "@/lib/studio/pose";

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
  // Version 2 rigs: feet and fingers (bone name = pose joint name).
  ...(["L", "R"] as const).flatMap(
    (s) =>
      [
        `ankle${s}`,
        `thumb1${s}`,
        `thumb2${s}`,
        `thumb3${s}`,
        ...FINGERS.flatMap((f) =>
          ([1, 2, 3] as const).map((k) => `${f}${k}${s}` as const),
        ),
      ] as const,
  ),
] as const;
export type BoneName = (typeof BONE_NAMES)[number];
/** Bones every rig has; the rest arrived with feet and fingers. */
export const CORE_BONES = BONE_NAMES.slice(0, 13);

/** Which bone each pose joint drives (feet and fingers: same name). */
export const JOINT_BONE = {
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
  ...Object.fromEntries(BONE_NAMES.slice(13).map((b) => [b, b])),
} as Record<JointId, BoneName>;

/** Bind-pose limb directions, measured from the rig. */
export interface RigDirections {
  upperArmL: THREE.Vector3;
  upperArmR: THREE.Vector3;
  forearmL: THREE.Vector3;
  forearmR: THREE.Vector3;
  thighL: THREE.Vector3;
  thighR: THREE.Vector3;
  /** Version 2 rigs: each finger bone's direction (to the next joint
   * or its tip) and, per hand, which way the palm faces and which way
   * is towards the thumb, all in the bind pose. */
  bones?: Partial<Record<BoneName, THREE.Vector3>>;
  palm?: Record<"L" | "R", { normal: THREE.Vector3; thumb: THREE.Vector3 }>;
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
  if (joint.startsWith("ankle"))
    // Point: toes down (+Z towards -Y, about +X). Tilt: sole inward.
    return compose([
      [X, v("point")],
      [Z.clone().multiplyScalar(-side), v("tilt")],
    ]);
  // Fingers and thumb: axes from the finger's own direction and the
  // palm. Rotating `d` about d x target turns it towards `target`.
  const d = dirs.bones?.[joint as BoneName];
  const palm = dirs.palm?.[s];
  if (!d || !palm) return new THREE.Quaternion();
  const towards = (target: THREE.Vector3) =>
    d.clone().cross(target).normalize();
  if (joint.startsWith("thumb1"))
    return compose([
      [towards(palm.thumb.clone().negate()), v("across")],
      [towards(palm.normal.clone().negate()), v("out")],
    ]);
  if (/^(index|middle|ring|pinky)1/.test(joint))
    return compose([
      [towards(palm.normal), v("curl")],
      [towards(palm.thumb), v("spread")],
    ]);
  return compose([[towards(palm.normal), v("curl")]]);
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

// ------------------------------------------------------------ drag to pose

/** One angle a viewport drag may change. */
export interface DragVar {
  joint: JointId;
  dof: string;
  min: number;
  max: number;
}

/** What dragging each body part moves: the joint above it, except the
 * hand, which carries the whole arm (shoulder + elbow) like a puppet's.
 * Twists are left to the sliders — a drag can't express them well. The
 * pelvis has no entry: dragging it orbits the camera. */
const DRAG_CHAINS: Partial<Record<BoneName, Array<[JointId, string[]]>>> = {
  spine: [["spine", ["bend", "side"]]],
  neck: [["head", ["nod", "turn"]]],
  shoulderL: [["shoulderL", ["raise", "forward"]]],
  elbowL: [["elbowL", ["bend"]]],
  wristL: [
    ["shoulderL", ["raise", "forward"]],
    ["elbowL", ["bend"]],
  ],
  shoulderR: [["shoulderR", ["raise", "forward"]]],
  elbowR: [["elbowR", ["bend"]]],
  wristR: [
    ["shoulderR", ["raise", "forward"]],
    ["elbowR", ["bend"]],
  ],
  hipL: [["hipL", ["forward", "out"]]],
  kneeL: [["kneeL", ["bend"]]],
  hipR: [["hipR", ["forward", "out"]]],
  kneeR: [["kneeR", ["bend"]]],
  // Feet and fingers: the joint at the part's own base.
  ...Object.fromEntries(
    (["L", "R"] as const).flatMap((s) => [
      [`ankle${s}`, [[`ankle${s}`, ["point", "tilt"]]]],
      [`thumb1${s}`, [[`thumb1${s}`, ["across", "out"]]]],
      [`thumb2${s}`, [[`thumb2${s}`, ["curl"]]]],
      [`thumb3${s}`, [[`thumb3${s}`, ["curl"]]]],
      ...FINGERS.flatMap((f) => [
        [`${f}1${s}`, [[`${f}1${s}`, ["curl", "spread"]]]],
        [`${f}2${s}`, [[`${f}2${s}`, ["curl"]]]],
        [`${f}3${s}`, [[`${f}3${s}`, ["curl"]]]],
      ]),
    ]),
  ),
};

/** The angles a drag on `bone` changes, root-most joint first; empty if
 * that part isn't draggable. */
export function dragVariables(bone: BoneName): DragVar[] {
  return toVars(DRAG_CHAINS[bone] ?? []);
}

/** A dot drawn on a joint in pose mode. Dragging it turns that joint so
 * the part below follows the pointer, measured at `effector`: the next
 * joint down, or the limb's tip (crown, fingertips, sole). */
export interface JointDot {
  bone: BoneName;
  joint: JointId;
  effector: BoneName | "tip";
  vars: DragVar[];
  /** Finger and thumb dots: shown only while that hand is being posed
   * (15 dots per hand would crowd a full-body view, worse on a phone). */
  detail?: "L" | "R";
}

export const JOINT_DOTS: JointDot[] = (
  [
    // The crown doesn't move when the head turns, so the dot nods/tilts.
    ["neck", "head", "tip", ["nod", "tilt"]],
    ["spine", "spine", "neck", ["bend", "side"]],
    ["shoulderL", "shoulderL", "elbowL", ["raise", "forward"]],
    ["elbowL", "elbowL", "wristL", ["bend"]],
    ["wristL", "wristL", "tip", ["bend", "lift"]],
    ["shoulderR", "shoulderR", "elbowR", ["raise", "forward"]],
    ["elbowR", "elbowR", "wristR", ["bend"]],
    ["wristR", "wristR", "tip", ["bend", "lift"]],
    ["hipL", "hipL", "kneeL", ["forward", "out"]],
    ["kneeL", "kneeL", "tip", ["bend"]],
    ["hipR", "hipR", "kneeR", ["forward", "out"]],
    // On version 2 rigs the shin ends at the ankle, then the foot.
    ["kneeR", "kneeR", "tip", ["bend"]],
    ...(["L", "R"] as const).flatMap((s) => [
      [`ankle${s}`, `ankle${s}`, "tip", ["point", "tilt"]],
      [`thumb1${s}`, `thumb1${s}`, `thumb2${s}`, ["across", "out"]],
      [`thumb2${s}`, `thumb2${s}`, `thumb3${s}`, ["curl"]],
      [`thumb3${s}`, `thumb3${s}`, "tip", ["curl"]],
      ...FINGERS.flatMap((f) => [
        [`${f}1${s}`, `${f}1${s}`, `${f}2${s}`, ["curl", "spread"]],
        [`${f}2${s}`, `${f}2${s}`, `${f}3${s}`, ["curl"]],
        [`${f}3${s}`, `${f}3${s}`, "tip", ["curl"]],
      ]),
    ]),
  ] as Array<[BoneName, JointId, BoneName | "tip", string[]]>
).map(([bone, joint, effector, dofs]) => ({
  bone,
  joint,
  effector,
  vars: toVars([[joint, dofs]]),
  ...(/^(thumb|index|middle|ring|pinky)/.test(bone)
    ? { detail: bone.slice(-1) as "L" | "R" }
    : {}),
}));

function toVars(chain: Array<[JointId, string[]]>): DragVar[] {
  return chain.flatMap(([joint, dofs]) =>
    dofs.map((dof) => {
      const d = (
        JOINTS[joint].dofs as Record<string, { min: number; max: number }>
      )[dof];
      return { joint, dof, min: d.min, max: d.max };
    }),
  );
}

/** Returns a function that poses `bones` with the drag variables set to
 * `x` (degrees; other angles from `joints`) and reports where the grabbed
 * point — `local`, in the frame of `grabbed` — ends up in world space.
 * Parents of the first variable's bone must have current world matrices. */
export function makeReach(
  bones: Record<BoneName, THREE.Bone>,
  dirs: RigDirections,
  joints: PoseJoints,
  vars: DragVar[],
  grabbed: THREE.Object3D,
  local: THREE.Vector3,
): (x: number[]) => THREE.Vector3 {
  const top = bones[JOINT_BONE[vars[0].joint]];
  const all = joints as Record<string, Record<string, number>>;
  return (x) => {
    const values: Partial<Record<JointId, Record<string, number>>> = {};
    vars.forEach((v, i) => {
      (values[v.joint] ??= { ...all[v.joint] })[v.dof] = x[i];
    });
    for (const [id, vals] of Object.entries(values) as [
      JointId,
      Record<string, number>,
    ][]) {
      bones[JOINT_BONE[id]].quaternion.copy(jointQuaternion(id, vals, dirs));
    }
    top.updateWorldMatrix(false, true);
    return grabbed.localToWorld(local.clone());
  };
}

/** Finite-difference step (degrees), damping (metres) and the largest
 * change per iteration (degrees) for `solveReach`. */
const FD_STEP = 0.5;
const DAMPING = 0.08;
const MAX_STEP = 12;

/** Damped least squares: move the angles `start` (degrees, clamped to
 * each variable's limits) so that `reach(x)` gets as close as it can to
 * `target`. Starting from the current pose keeps a drag continuous, and
 * the damping makes small pointer moves give small, smooth changes. */
export function solveReach(
  vars: DragVar[],
  start: number[],
  reach: (x: number[]) => THREE.Vector3,
  target: THREE.Vector3,
  iterations = 8,
): number[] {
  const clamp = (x: number[]) =>
    x.map((v, i) => THREE.MathUtils.clamp(v, vars[i].min, vars[i].max));
  let x = clamp(start);
  let p = reach(x);
  let err = p.distanceToSquared(target);
  for (let it = 0; it < iterations && err > 1e-8; it++) {
    // Jacobian columns, metres per radian (step inwards at a limit).
    const cols = vars.map((v, i) => {
      const xi = x.slice();
      const s = xi[i] + FD_STEP > v.max ? -FD_STEP : FD_STEP;
      xi[i] += s;
      return reach(xi)
        .sub(p)
        .divideScalar(s * DEG);
    });
    const e = target.clone().sub(p);
    // (JᵀJ + λ²I) d = Jᵀe
    const A = cols.map((ci, i) =>
      cols.map((cj, j) => ci.dot(cj) + (i === j ? DAMPING * DAMPING : 0)),
    );
    const b = cols.map((c) => c.dot(e));
    const d = solveLinear(A, b);
    let step = d.map((r) =>
      THREE.MathUtils.clamp(r / DEG, -MAX_STEP, MAX_STEP),
    );
    let improved = false;
    for (let tries = 0; tries < 3 && !improved; tries++) {
      const cand = clamp(x.map((v, i) => v + step[i]));
      const pc = reach(cand);
      const ec = pc.distanceToSquared(target);
      if (ec < err) {
        x = cand;
        p = pc;
        err = ec;
        improved = true;
      } else {
        step = step.map((s) => s / 2);
      }
    }
    if (!improved) {
      // Stuck where the gradient vanishes, e.g. a hanging hand pulled
      // straight up: nudge each angle both ways and keep the best.
      let best: number[] | null = null;
      for (let i = 0; i < x.length; i++) {
        for (const s of [MAX_STEP, -MAX_STEP]) {
          const cand = clamp(x.map((v, j) => (j === i ? v + s : v)));
          const pc = reach(cand);
          const ec = pc.distanceToSquared(target);
          if (ec < err) {
            best = cand;
            p = pc;
            err = ec;
          }
        }
      }
      if (!best) break;
      x = best;
    }
  }
  reach(x); // leave the bones at the answer
  return x;
}

/** Gaussian elimination with partial pivoting, for the tiny (≤ 3×3)
 * systems above. The damping keeps them well conditioned. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
    [m[c], m[pivot]] = [m[pivot], m[c]];
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let k = r + 1; k < n; k++) s -= m[r][k] * x[k];
    x[r] = s / m[r][r];
  }
  return x;
}
