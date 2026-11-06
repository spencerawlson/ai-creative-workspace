/** A standard humanoid skeleton under the poses, so one pose (or move)
 * can drive any human character, not only the scanned mannequin.
 *
 * Poses stay defined on the mannequin (lib/studio/pose.ts, mapped onto
 * bones by posing.ts). A character's skeleton is matched to the
 * mannequin's joints by bone name, and each matched bone gets a fixed
 * correction, `retarget`, worked out once from its rest pose:
 *
 *   bone.quaternion = pre · q · post
 *
 * where q is the mannequin's rotation for that joint. `post` turns the
 * mannequin's rest frame into the bone's (bones may point any way, and
 * a T-pose arm is lined up with the mannequin's A-pose arm first);
 * `pre` undoes the same for the bone's real parent. Parents' rotations
 * cancel out, so each joint's correction is independent: setting one
 * joint (as a drag does) never touches the others. For the mannequin
 * itself both are identity and the pose is unchanged.
 *
 * Bones the mannequin has no joint for (chest, collarbones, head, toes)
 * keep their rest rotation relative to their parent. */

import * as THREE from "three";
import { FINGERS } from "@/lib/studio/pose";
import {
  BONE_NAMES,
  CORE_BONES,
  type BoneName,
  type RigDirections,
} from "./posing";

/** Standard humanoid bone (VRM 1.0 names) for each mannequin bone. The
 * mannequin's "neck" carries the head joint; "shoulder" is the upper
 * arm (VRM's "shoulder" is the collarbone, which has no joint here). */
export const HUMANOID_NAME: Record<BoneName, string> = {
  pelvis: "hips",
  spine: "spine",
  neck: "neck",
  ...(Object.fromEntries(
    (["L", "R"] as const).flatMap((s) => {
      const side = s === "L" ? "left" : "right";
      const cap = (f: string) => f[0].toUpperCase() + f.slice(1);
      return [
        [`shoulder${s}`, `${side}UpperArm`],
        [`elbow${s}`, `${side}LowerArm`],
        [`wrist${s}`, `${side}Hand`],
        [`hip${s}`, `${side}UpperLeg`],
        [`knee${s}`, `${side}LowerLeg`],
        [`ankle${s}`, `${side}Foot`],
        [`thumb1${s}`, `${side}ThumbMetacarpal`],
        [`thumb2${s}`, `${side}ThumbProximal`],
        [`thumb3${s}`, `${side}ThumbDistal`],
        ...FINGERS.flatMap((f) => [
          [`${f}1${s}`, `${side}${cap(f === "pinky" ? "little" : f)}Proximal`],
          [
            `${f}2${s}`,
            `${side}${cap(f === "pinky" ? "little" : f)}Intermediate`,
          ],
          [`${f}3${s}`, `${side}${cap(f === "pinky" ? "little" : f)}Distal`],
        ]),
      ];
    }),
  ) as Record<string, string>),
} as Record<BoneName, string>;

/** Each mannequin joint's parent joint: the nearest matched bone above a
 * matched bone must be this one, or the corrections don't hold. */
export const JOINT_PARENT: Record<BoneName, BoneName | null> = {
  pelvis: null,
  spine: "pelvis",
  neck: "spine",
  ...(Object.fromEntries(
    (["L", "R"] as const).flatMap((s) => [
      [`shoulder${s}`, "spine"],
      [`elbow${s}`, `shoulder${s}`],
      [`wrist${s}`, `elbow${s}`],
      [`hip${s}`, "pelvis"],
      [`knee${s}`, `hip${s}`],
      [`ankle${s}`, `knee${s}`],
      ...(["thumb", ...FINGERS] as const).flatMap((f) => [
        [`${f}1${s}`, `wrist${s}`],
        [`${f}2${s}`, `${f}1${s}`],
        [`${f}3${s}`, `${f}2${s}`],
      ]),
    ]),
  ) as Record<string, BoneName>),
} as Record<BoneName, BoneName | null>;

// ------------------------------------------------------------ bone names

type Side = "L" | "R";

/** A bone name without rig prefixes, split into side and base word:
 * "mixamorig:LeftForeArm" → R/L "forearm", "J_Bip_L_UpperArm" → L
 * "upperarm", "upper_arm.L" → L "upperarm", "calf_r" → R "calf". */
export function parseBoneName(raw: string): {
  side: Side | null;
  base: string;
} {
  let n = raw
    .toLowerCase()
    .replace(/^.*[|:]/, "") // "Armature|...", "mixamorig:..."
    .replace(/^(mixamorig\d*_?|j_bip_|def[-_]|org[-_]|bip\d*[\s_])/, "");
  let side: Side | null = null;
  const lead =
    /^(left|right|l|r|c)(?=[_.\s-]|left|right)/.exec(n) ??
    /^(left|right)/.exec(n);
  const trail = /[_.\s-](l|r|left|right)$/.exec(n);
  if (lead) {
    if (lead[1] !== "c") side = lead[1].startsWith("l") ? "L" : "R";
    n = n.slice(lead[0].length);
  } else if (trail) {
    side = trail[1].startsWith("l") ? "L" : "R";
    n = n.slice(0, trail.index);
  }
  return { side, base: n.replace(/[^a-z0-9]/g, "") };
}

const CENTRE: Record<string, BoneName | "other"> = {
  hips: "pelvis",
  pelvis: "pelvis",
  spine: "spine",
  spine0: "spine",
  spine01: "spine",
  neck: "neck",
  neck01: "neck",
  neck1: "neck",
};

const SIDED: Record<string, string> = {
  upperarm: "shoulder",
  arm: "shoulder",
  uparm: "shoulder",
  lowerarm: "elbow",
  forearm: "elbow",
  hand: "wrist",
  upperleg: "hip",
  upleg: "hip",
  thigh: "hip",
  lowerleg: "knee",
  leg: "knee",
  calf: "knee",
  shin: "knee",
  foot: "ankle",
};

const FINGER_WORD = /^(?:hand)?(thumb|index|middle|ring|pinky|little)(.*)$/;

/** The mannequin's own bone names, matched as they are. */
function mannequinBones(bones: THREE.Bone[]) {
  const byName = new Map(bones.map((b) => [b.name, b]));
  if (!CORE_BONES.every((n) => byName.has(n))) return null;
  const out: Partial<Record<BoneName, THREE.Bone>> = {};
  for (const n of BONE_NAMES) if (byName.has(n)) out[n] = byName.get(n)!;
  return out;
}

function depth(b: THREE.Object3D) {
  let d = 0;
  for (let p = b.parent; p; p = p.parent) d++;
  return d;
}

/** Match a skeleton's bones to the mannequin's joints by name. Knows the
 * mannequin's names, VRM/VRoid, Mixamo, Blender (Rigify, MPFB) and
 * Unreal styles. Fingers are numbered from the hand outwards, so
 * "Thumb1-3", "ThumbMetacarpal/Proximal/Distal" and "thumb_01-03" all
 * work; end bones ("Index4", "_end", "tip") are left out. */
export function matchHumanoid(
  bones: THREE.Bone[],
): Partial<Record<BoneName, THREE.Bone>> {
  const own = mannequinBones(bones);
  if (own) return own;
  const out: Partial<Record<BoneName, THREE.Bone>> = {};
  const digits = new Map<string, THREE.Bone[]>();
  for (const bone of bones) {
    const { side, base } = parseBoneName(bone.name);
    const finger = FINGER_WORD.exec(base);
    if (finger && side) {
      const f = finger[1] === "little" ? "pinky" : finger[1];
      const rest = finger[2];
      if (/end|tip|nub|^4$|^04$|^0$/.test(rest)) continue;
      // Metacarpals: the thumb's moves; the fingers' are left alone.
      if (/metacarpal/.test(rest) && f !== "thumb") continue;
      const key = `${f}${side}`;
      digits.set(key, [...(digits.get(key) ?? []), bone]);
      continue;
    }
    const name = side
      ? SIDED[base]
        ? (`${SIDED[base]}${side}` as BoneName)
        : undefined
      : CENTRE[base];
    if (name && name !== "other" && !out[name]) out[name] = bone;
  }
  for (const [key, list] of digits) {
    const side = key.slice(-1);
    const f = key.slice(0, -1);
    list
      .sort((a, b) => depth(a) - depth(b))
      .slice(0, 3)
      .forEach((bone, i) => {
        out[`${f}${i + 1}${side}` as BoneName] = bone;
      });
  }
  return out;
}

// ------------------------------------------------------------- retarget

/** Per-bone correction: bone.quaternion = pre · q · post. */
export type Retarget = Partial<
  Record<BoneName, { pre: THREE.Quaternion; post: THREE.Quaternion }>
>;

/** The mannequin's directions for posing other characters: the male
 * scan's, averaged left and right, with the fingers lying straight
 * along the forearm (scanned fingers are uneven). Fresh vectors. */
export function referenceDirections(): RigDirections {
  const v = (x: number, y: number, z: number) =>
    new THREE.Vector3(x, y, z).normalize();
  const both = (x: number, y: number, z: number) =>
    [v(x, y, z), v(-x, y, z)] as const;
  const [upperArmL, upperArmR] = both(0.4656, -0.8792, 0.0999);
  const [forearmL, forearmR] = both(0.3868, -0.8901, 0.2412);
  const [thighL, thighR] = both(0.0569, -0.9875, -0.146);
  const dirs: RigDirections = {
    upperArmL,
    upperArmR,
    forearmL,
    forearmR,
    thighL,
    thighR,
    bones: {},
    palm: {
      L: {
        normal: v(-0.9646, -0.169, 0.2022),
        thumb: v(0.1547, 0.2581, 0.9536),
      },
      R: {
        normal: v(0.9646, -0.169, 0.2022),
        thumb: v(-0.1547, 0.2581, 0.9536),
      },
    },
  };
  for (const s of ["L", "R"] as const) {
    const sx = s === "L" ? 1 : -1;
    for (const k of [1, 2, 3]) {
      dirs.bones![`thumb${k}${s}` as BoneName] = v(-0.08 * sx, -0.69, 0.72);
      for (const f of FINGERS)
        dirs.bones![`${f}${k}${s}` as BoneName] = (
          s === "L" ? forearmL : forearmR
        ).clone();
    }
  }
  return dirs;
}

/** Which measured direction lines a bone up with the mannequin: its
 * own limb, or (no direction of its own) the joint above it. */
function ownDirection(
  bone: BoneName,
  dirs: RigDirections,
): THREE.Vector3 | undefined {
  const s = bone.slice(-1) as Side;
  if (bone.startsWith("shoulder")) return dirs[`upperArm${s}`];
  if (bone.startsWith("elbow")) return dirs[`forearm${s}`];
  if (bone.startsWith("hip")) return dirs[`thigh${s}`];
  return dirs.bones?.[bone];
}

export interface RetargetResult {
  retarget: Retarget;
  /** Matched bones whose nearest matched ancestor isn't their joint's
   * parent (the corrections would be wrong): empty when usable. */
  problems: string[];
}

/** Work out each matched bone's correction from the rest pose. `root`
 * is the figure's frame (+Y up, facing +Z, its left = +X); `restDirs`
 * are this skeleton's limb directions at rest and `refDirs` the
 * mannequin's, both in that frame. Bones must be at rest. */
export function computeRetarget(
  root: THREE.Object3D,
  bones: Partial<Record<BoneName, THREE.Bone>>,
  restDirs: RigDirections,
  refDirs: RigDirections,
): RetargetResult {
  root.updateMatrixWorld(true);
  const rootInv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const restOf = (o: THREE.Object3D) =>
    rootInv.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion()));
  const matched = new Map<THREE.Object3D, BoneName>();
  for (const [name, bone] of Object.entries(bones))
    matched.set(bone!, name as BoneName);

  // Alignment (figure frame) taking the bone's rest frame onto the
  // mannequin's. Each bone starts from its parent's and swings the
  // least that lines up its own direction, so twist carries down a
  // limb; a hand lines up its palm (which way it faces, where the thumb
  // is), so a palms-down T-pose curls its fingers the right way.
  const align = new Map<BoneName, THREE.Quaternion>();
  const alignOf = (b: BoneName | null): THREE.Quaternion => {
    if (!b) return new THREE.Quaternion();
    const known = align.get(b);
    if (known) return known;
    const parent = alignOf(JOINT_PARENT[b]);
    const s = b.slice(-1) as Side;
    const from = ownDirection(b, restDirs);
    const to = ownDirection(b, refDirs);
    let q: THREE.Quaternion;
    if (b.startsWith("wrist") && restDirs.palm && refDirs.palm)
      q = frameTurn(restDirs.palm[s], refDirs.palm[s]);
    else if (from && to)
      q = new THREE.Quaternion()
        .setFromUnitVectors(
          from.clone().applyQuaternion(parent).normalize(),
          to.clone().normalize(),
        )
        .multiply(parent);
    else q = parent.clone();
    align.set(b, q);
    return q;
  };

  const retarget: Retarget = {};
  const problems: string[] = [];
  for (const [name, bone] of Object.entries(bones) as [
    BoneName,
    THREE.Bone,
  ][]) {
    let anc: THREE.Object3D | null = bone.parent;
    while (anc && anc !== root && !matched.has(anc)) anc = anc.parent;
    const found = anc && matched.has(anc) ? matched.get(anc)! : null;
    const expected = JOINT_PARENT[name];
    if (found !== expected && !(expected && !bones[expected])) {
      problems.push(
        `${bone.name}: expected under ${expected ?? "nothing"}, found under ${found ?? "nothing"}`,
      );
      continue;
    }
    const parentRest = bone.parent
      ? restOf(bone.parent)
      : new THREE.Quaternion();
    const pre = alignOf(expected).clone().multiply(parentRest).invert();
    const post = alignOf(name).clone().multiply(restOf(bone));
    retarget[name] = { pre, post };
  }
  return { retarget, problems };
}

/** The rotation taking one palm frame (normal, towards the thumb) onto
 * another. */
function frameTurn(
  from: { normal: THREE.Vector3; thumb: THREE.Vector3 },
  to: { normal: THREE.Vector3; thumb: THREE.Vector3 },
): THREE.Quaternion {
  const basis = (p: { normal: THREE.Vector3; thumb: THREE.Vector3 }) => {
    const n = p.normal.clone().normalize();
    const t = p.thumb.clone().projectOnPlane(n).normalize();
    return new THREE.Matrix4().makeBasis(n, t, n.clone().cross(t));
  };
  const m = basis(to).multiply(basis(from).transpose());
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

/** True when every correction is (almost) identity: the skeleton is the
 * mannequin's own, posed as before. */
export function isIdentityRetarget(r: Retarget, eps = 1e-6): boolean {
  const id = new THREE.Quaternion();
  return Object.values(r).every(
    (c) =>
      1 - Math.abs(c!.pre.dot(id)) < eps && 1 - Math.abs(c!.post.dot(id)) < eps,
  );
}

/** A VRM file's own bone map (VRM 1.0 `VRMC_vrm` or 0.x `VRM`
 * extension), as mannequin joints; null for files that aren't VRM.
 * `node(i)` gives the loaded object for glTF node i. */
export function vrmHumanoid(
  json: unknown,
  node: (index: number) => THREE.Object3D | undefined,
): Partial<Record<BoneName, THREE.Bone>> | null {
  const ext = (json as { extensions?: Record<string, unknown> } | null)
    ?.extensions;
  const v1 = (ext?.VRMC_vrm as { humanoid?: { humanBones?: unknown } })
    ?.humanoid?.humanBones;
  const v0 = (ext?.VRM as { humanoid?: { humanBones?: unknown } })?.humanoid
    ?.humanBones;
  let pairs: Array<[string, unknown]>;
  if (v1 && typeof v1 === "object")
    pairs = Object.entries(v1 as Record<string, { node?: unknown }>).map(
      ([k, v]) => [k, v?.node],
    );
  else if (Array.isArray(v0))
    pairs = (v0 as Array<{ bone?: unknown; node?: unknown }>).map((h) => [
      // 0.x thumbs are Proximal/Intermediate/Distal; 1.0's are
      // Metacarpal/Proximal/Distal for the same three bones.
      String(h?.bone ?? "")
        .replace(/Thumb(Proximal)$/, "ThumbMetacarpal")
        .replace(/Thumb(Intermediate)$/, "ThumbProximal"),
      h?.node,
    ]);
  else return null;
  const byHumanoid = new Map(
    Object.entries(HUMANOID_NAME).map(([b, h]) => [h, b as BoneName]),
  );
  const out: Partial<Record<BoneName, THREE.Bone>> = {};
  for (const [name, index] of pairs) {
    const b = byHumanoid.get(name);
    const o = typeof index === "number" ? node(index) : undefined;
    if (b && (o as THREE.Bone | undefined)?.isBone) out[b] = o as THREE.Bone;
  }
  return out;
}
