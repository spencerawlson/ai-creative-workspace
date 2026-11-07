/** Pose from a photo: body landmarks (MediaPipe Pose, run on the device;
 * see components/studio/poseDetector.ts) turned into the mannequin's
 * joint angles.
 *
 * The landmarks are 3D points in metres around the hips. Each body part
 * gives a direction: hips to shoulders, shoulder to elbow, heel to toe…
 * For each part, the joint angles are fitted (damped least squares, the
 * same joint maths as lib/engine/posing.ts) so that the figure's part
 * points the same way, root first: the torso, then the head and arms on
 * it, and the legs. Angles stay within each joint's limits. Parts the
 * photo doesn't show clearly are left as they are.
 *
 * Two things make a photo's directions differ from the rig's bones, and
 * both are allowed for:
 * - The landmarks are on the body's surface (the top of the shoulder,
 *   the side of the hip), the rig's joints inside it. So the fit lines up
 *   each part as a photo *shows* the figure at rest, measured by running
 *   MediaPipe on renders of the mannequin (SEEN below).
 * - Depth (towards the camera) is the landmarks' weakest axis, so it
 *   counts for less than the directions across the photo.
 *
 * Poses are relative to the hips: which way the person faces the camera
 * doesn't matter, and the figure keeps its own place and turn. */

import * as THREE from "three";
import { JOINTS, type BodyJointId, type Dof } from "@/lib/studio/pose";
import { referenceDirections } from "./humanoid";
import { jointQuaternion, solveLinear, type RigDirections } from "./posing";

/** A landmark: metres, x to the image's right, y down, z away from the
 * camera (MediaPipe's world landmarks); visibility 0..1. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

/** MediaPipe Pose's landmark numbers ("L" is the person's own left). */
export const LANDMARK = {
  eyeL: 2,
  eyeR: 5,
  earL: 7,
  earR: 8,
  shoulderL: 11,
  shoulderR: 12,
  elbowL: 13,
  elbowR: 14,
  wristL: 15,
  wristR: 16,
  pinkyL: 17,
  pinkyR: 18,
  indexL: 19,
  indexR: 20,
  hipL: 23,
  hipR: 24,
  kneeL: 25,
  kneeR: 26,
  ankleL: 27,
  ankleR: 28,
  heelL: 29,
  heelR: 30,
  toeL: 31,
  toeR: 32,
} as const;
export const LANDMARK_COUNT = 33;
type Point = keyof typeof LANDMARK;
type Side = "L" | "R";
type V3 = [number, number, number];

/** Body-part directions (unit vectors) in the hips' frame: x to the
 * person's left, y up, z the way the hips face. */
export interface Segments {
  /** Hips' midpoint to the shoulders' midpoint. */
  torso: THREE.Vector3;
  /** Right shoulder to left, square to the torso. */
  shoulders: THREE.Vector3;
  /** Right ear to left. */
  ears: THREE.Vector3;
  /** From between the ears to between the eyes, square to the ears. */
  face: THREE.Vector3;
  upperArm: Record<Side, THREE.Vector3>;
  forearm: Record<Side, THREE.Vector3>;
  /** Wrist to the knuckles. */
  hand: Record<Side, THREE.Vector3>;
  /** Little finger to index, square to the hand. */
  thumb: Record<Side, THREE.Vector3>;
  thigh: Record<Side, THREE.Vector3>;
  shin: Record<Side, THREE.Vector3>;
  /** Heel to toe. */
  foot: Record<Side, THREE.Vector3>;
}
const SIDED = [
  "upperArm",
  "forearm",
  "hand",
  "thumb",
  "thigh",
  "shin",
  "foot",
] as const;
const SINGLE = ["torso", "shoulders", "ears", "face"] as const;

/** `v` without its part along unit `n`, normalised. */
const square = (v: THREE.Vector3, n: THREE.Vector3) =>
  v
    .clone()
    .sub(n.clone().multiplyScalar(v.dot(n)))
    .normalize();

/** Where the photo's landmarks are on the image (MediaPipe's image
 * landmarks, 0..1 across and down) and its width over its height. */
export interface PhotoImage {
  points: Landmark[];
  aspect: number;
}

/** The directions a photo's landmarks show, and the camera's depth axis
 * (towards it), in the hips' frame. Throws if the hips coincide.
 *
 * With `image`, each part's direction across the photo comes from where
 * it is in the image (the landmarks' most accurate part) and only its
 * length and which way it goes in depth from the 3D landmarks: the depth
 * is whatever the part's length leaves once its length across the photo
 * is taken, so a forearm raised to the chin, short in the image, isn't
 * read as pointing at the camera. */
export function photoDirections(
  landmarks: Landmark[],
  image?: PhotoImage,
): {
  segments: Segments;
  depth: THREE.Vector3;
} {
  const avg = (pts: Landmark[], ps: Point[]) => {
    const v = new THREE.Vector3();
    for (const p of ps) {
      const l = pts[LANDMARK[p]];
      v.x += l.x / ps.length;
      v.y += l.y / ps.length;
      v.z += l.z / ps.length;
    }
    return v;
  };
  // Image units: the photo's height, x scaled to match. Metres per unit
  // from fitting the 3D landmarks across the photo to the image ones.
  let scale = 0;
  if (image) {
    const hipsW = avg(landmarks, ["hipL", "hipR"]);
    const hipsI = avg(image.points, ["hipL", "hipR"]);
    let num = 0;
    let den = 0;
    for (let i = 11; i < LANDMARK_COUNT; i++) {
      const w = landmarks[i];
      const p = image.points[i];
      const ix = (p.x - hipsI.x) * image.aspect;
      const iy = p.y - hipsI.y;
      num += (w.x - hipsW.x) * ix + (w.y - hipsW.y) * iy;
      den += ix * ix + iy * iy;
    }
    scale = den > 1e-9 && num > 0 ? num / den : 0;
  }
  /** From the middle of `from` to the middle of `to`, in camera space
   * with y up and z towards the camera. */
  const cam = (from: Point[], to: Point[], lift = false) => {
    const w = avg(landmarks, to).sub(avg(landmarks, from));
    if (lift && scale && image) {
      const d = avg(image.points, to).sub(avg(image.points, from));
      const x = d.x * image.aspect * scale;
      const y = d.y * scale;
      const across = Math.hypot(x, y);
      const length = Math.max(w.length(), across);
      const z = Math.sqrt(Math.max(0, length * length - across * across));
      w.set(x, y, w.z < 0 ? -z : z);
    }
    return new THREE.Vector3(w.x, -w.y, -w.z);
  };
  // The hips' frame: x along the hips, y straight up, z = x × y.
  const across = cam(["hipR"], ["hipL"]).setY(0);
  if (across.lengthSq() < 1e-12)
    throw new PhotoPoseError("The hips can't be told apart in this photo.");
  across.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const basis = new THREE.Matrix4()
    .makeBasis(across, up, across.clone().cross(up))
    .invert();
  const vec = (from: Point[], to: Point[], lift = false) =>
    cam(from, to, lift).applyMatrix4(basis);
  const dir = (from: Point[], to: Point[], lift = false) =>
    vec(from, to, lift).normalize();
  const sided = (f: (s: Side) => THREE.Vector3) => ({ L: f("L"), R: f("R") });

  const torso = dir(["hipL", "hipR"], ["shoulderL", "shoulderR"]);
  const ears = dir(["earR"], ["earL"]);
  // Limbs from the image; the trunk and head from the 3D landmarks
  // (their parts lie nearly flat to the camera, where depth from length
  // is too sensitive).
  const limb = (from: Point, to: Point | [Point, Point]) =>
    dir([from], Array.isArray(to) ? to : [to], true);
  const hand = sided((s) => limb(`wrist${s}`, [`index${s}`, `pinky${s}`]));
  return {
    segments: {
      torso,
      shoulders: square(vec(["shoulderR"], ["shoulderL"]), torso),
      ears,
      face: square(vec(["earL", "earR"], ["eyeL", "eyeR"]), ears),
      upperArm: sided((s) => limb(`shoulder${s}`, `elbow${s}`)),
      forearm: sided((s) => limb(`elbow${s}`, `wrist${s}`)),
      hand,
      thumb: sided((s) =>
        square(vec([`pinky${s}`], [`index${s}`], true), hand[s]),
      ),
      thigh: sided((s) => limb(`hip${s}`, `knee${s}`)),
      shin: sided((s) => limb(`knee${s}`, `ankle${s}`)),
      foot: sided((s) => limb(`heel${s}`, `toe${s}`)),
    },
    depth: new THREE.Vector3(0, 0, 1).applyMatrix4(basis).normalize(),
  };
}

/** The same parts on a rig at rest, from its bone directions. `torso`
 * and `shin` are measured on the figure (rig directions don't have
 * them); the face looks along +z, the ears and shoulders run along +x. */
function rigSegments(
  dirs: RigDirections,
  torso: THREE.Vector3,
  shin: Record<Side, THREE.Vector3>,
): Segments {
  const sided = (f: (s: Side) => THREE.Vector3) => ({ L: f("L"), R: f("R") });
  const hand = sided((s) =>
    (dirs.bones?.[`middle1${s}`] ?? dirs[`forearm${s}`]).clone(),
  );
  return {
    torso: torso.clone(),
    shoulders: new THREE.Vector3(1, 0, 0),
    ears: new THREE.Vector3(1, 0, 0),
    face: new THREE.Vector3(0, 0, 1),
    upperArm: sided((s) => dirs[`upperArm${s}`].clone()),
    forearm: sided((s) => dirs[`forearm${s}`].clone()),
    hand,
    thumb: sided((s) =>
      square(dirs.palm?.[s].thumb ?? new THREE.Vector3(0, 0, 1), hand[s]),
    ),
    thigh: sided((s) => dirs[`thigh${s}`].clone()),
    shin: sided((s) => shin[s].clone()),
    foot: sided(() => new THREE.Vector3(0, 0, 1)),
  };
}

/** The male scan's torso and shin at rest (scripts/rig-mannequin.mjs). */
const MALE_TORSO: V3 = [0, 0.504, -0.105];
const MALE_SHIN: V3 = [0.069, -0.995, -0.066];

/** How MediaPipe sees the male mannequin standing at rest (its scan
 * A-pose), with the limbs read as photoDirections reads them from an
 * image: averaged over renders with a level camera at chest height (as
 * most photos are taken), from the front and three-quarters, left and
 * right mirrored together; the trunk and head made symmetric. Left
 * side; the right is the mirror (x negated). Checked against public-
 * domain photos of people standing and in yoga
 * poses: upright people come out upright, bent elbows bent. */
const SEEN: Record<(typeof SINGLE)[number] | (typeof SIDED)[number], V3> = {
  torso: [0, 0.973, 0.22],
  shoulders: [1, 0, 0],
  ears: [1, 0, 0],
  face: [0, 0.026, 0.992],
  upperArm: [0.386, -0.919, -0.084],
  forearm: [0.363, -0.892, 0.269],
  hand: [0.313, -0.862, 0.398],
  thumb: [-0.47, 0.228, 0.853],
  thigh: [0.081, -0.986, 0.144],
  shin: [0.064, -0.936, -0.345],
  foot: [0.313, -0.649, 0.693],
};

/** The figure's rest as a photo would show it, and its rig directions
 * for the joint maths. */
export interface PhotoRest {
  dirs: RigDirections;
  seen: Segments;
}

/** A figure's photo rest: its own rig's parts, each turned by how much
 * MediaPipe's view of the male mannequin differs from the male rig.
 * `torso` and `shin` default to the male scan's (characters are posed
 * through the male mannequin's directions, lib/engine/humanoid.ts). */
export function photoRest(
  dirs: RigDirections,
  torso = new THREE.Vector3(...MALE_TORSO).normalize(),
  shin: Record<Side, THREE.Vector3> = {
    L: new THREE.Vector3(...MALE_SHIN).normalize(),
    R: new THREE.Vector3(-MALE_SHIN[0], MALE_SHIN[1], MALE_SHIN[2]).normalize(),
  },
): PhotoRest {
  const rig = rigSegments(dirs, torso, shin);
  const ref = rigSegments(
    referenceDirections(),
    new THREE.Vector3(...MALE_TORSO).normalize(),
    {
      L: new THREE.Vector3(...MALE_SHIN).normalize(),
      R: new THREE.Vector3(
        -MALE_SHIN[0],
        MALE_SHIN[1],
        MALE_SHIN[2],
      ).normalize(),
    },
  );
  const turn = (from: THREE.Vector3, seen: V3, v: THREE.Vector3) =>
    v.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        from.clone().normalize(),
        new THREE.Vector3(...seen).normalize(),
      ),
    );
  for (const k of SINGLE) turn(ref[k], SEEN[k], rig[k]);
  for (const k of SIDED)
    for (const s of ["L", "R"] as const) {
      const [x, y, z] = SEEN[k];
      turn(ref[k][s], s === "L" ? [x, y, z] : [-x, y, z], rig[k][s]);
    }
  return { dirs, seen: rig };
}

export type PhotoPart =
  | "torso"
  | "head"
  | "armL"
  | "armR"
  | "handL"
  | "handR"
  | "legL"
  | "legR"
  | "footL"
  | "footR";

/** What each part needs to be seen. */
const PART_POINTS: Record<PhotoPart, Point[]> = {
  torso: ["shoulderL", "shoulderR", "hipL", "hipR"],
  head: ["eyeL", "eyeR", "earL", "earR"],
  armL: ["shoulderL", "elbowL", "wristL"],
  armR: ["shoulderR", "elbowR", "wristR"],
  handL: ["wristL", "indexL", "pinkyL"],
  handR: ["wristR", "indexR", "pinkyR"],
  legL: ["hipL", "kneeL", "ankleL"],
  legR: ["hipR", "kneeR", "ankleR"],
  footL: ["ankleL", "heelL", "toeL"],
  footR: ["ankleR", "heelR", "toeR"],
};

/** Landmarks less visible than this count as not in the photo. */
export const MIN_VISIBILITY = 0.5;
/** How much depth counts against the directions across the photo. */
const DEPTH_TRUST = 0.25;
/** How strongly an arm swung forward past 100° (over the top) is
 * resisted; see the arm fit. */
const OVER_THE_TOP = 1.2;

export interface PhotoPoseResult {
  /** New angles for the parts that were found (integers, in limits). */
  patches: Partial<Record<BodyJointId, Record<string, number>>>;
  found: PhotoPart[];
  missing: PhotoPart[];
  /** Mean angle between the photo's and the fitted part directions. */
  errorDeg: number;
}

export class PhotoPoseError extends Error {}

const DEG = Math.PI / 180;

/** One angle being fitted, with how strongly it's held near 0: twists
 * and the wrist are underdetermined from a few points, so they stay
 * small unless the photo clearly asks for them. */
interface FitVar {
  joint: BodyJointId;
  dof: string;
  min: number;
  max: number;
  hold: number;
}

function fitVars(joint: BodyJointId, hold: Record<string, number>): FitVar[] {
  const dofs = JOINTS[joint].dofs as Record<string, Dof>;
  return Object.keys(dofs).map((dof) => ({
    joint,
    dof,
    min: dofs[dof].min,
    max: dofs[dof].max,
    hold: hold[dof] ?? 0.02,
  }));
}

function valuesOf(vars: FitVar[], x: number[]) {
  const out: Partial<Record<BodyJointId, Record<string, number>>> = {};
  vars.forEach((v, i) => ((out[v.joint] ??= {})[v.dof] = x[i]));
  return out;
}

const sumSq = (r: number[]) => r.reduce((s, v) => s + v * v, 0);

/** Levenberg–Marquardt on `residual`, within each angle's limits, from
 * each start; the best answer wins. Angles are degrees. */
function fit(
  vars: FitVar[],
  residual: (x: number[]) => number[],
  starts: number[][],
): number[] {
  const clamp = (x: number[]) =>
    x.map((v, i) => Math.min(vars[i].max, Math.max(vars[i].min, v)));
  const full = (x: number[]) => [
    ...residual(x),
    ...vars.map((v, i) => v.hold * x[i] * DEG),
  ];
  let best = { x: clamp(starts[0]), cost: Infinity };
  for (const start of starts) {
    let x = clamp(start);
    let r = full(x);
    let cost = sumSq(r);
    let lambda = 1e-2;
    for (let it = 0; it < 80; it++) {
      // Jacobian columns, per radian (stepping inwards at a limit).
      const cols = vars.map((v, i) => {
        const xi = x.slice();
        const h = xi[i] + 0.25 > v.max ? -0.25 : 0.25;
        xi[i] += h;
        return full(xi).map((ri, k) => (ri - r[k]) / (h * DEG));
      });
      const A = cols.map((a) =>
        cols.map((b) => a.reduce((s, ak, k) => s + ak * b[k], 0)),
      );
      const g = cols.map((a) => a.reduce((s, ak, k) => s + ak * r[k], 0));
      let moved = 0;
      let accepted = false;
      for (let tries = 0; tries < 8 && !accepted; tries++) {
        const M = A.map((row, i) =>
          row.map((v, j) => (i === j ? v + lambda * (v + 1e-6) : v)),
        );
        const d = solveLinear(
          M,
          g.map((v) => -v),
        );
        const cand = clamp(x.map((v, i) => v + d[i] / DEG));
        const rc = full(cand);
        const cc = sumSq(rc);
        if (cc < cost) {
          moved = Math.max(...cand.map((v, i) => Math.abs(v - x[i])));
          x = cand;
          r = rc;
          cost = cc;
          lambda = Math.max(lambda / 3, 1e-7);
          accepted = true;
        } else lambda *= 4;
      }
      if (!accepted || moved < 1e-3) break;
    }
    if (cost < best.cost) best = { x, cost };
  }
  return best.x;
}

/** Every combination of the listed start values (others start at 0). */
function grid(vars: FitVar[], seeds: Record<string, number[]>): number[][] {
  let out: number[][] = [vars.map(() => 0)];
  vars.forEach((v, i) => {
    const values = seeds[`${v.joint}.${v.dof}`];
    if (!values) return;
    out = out.flatMap((s) =>
      values.map((val) => s.map((x, j) => (j === i ? val : x))),
    );
  });
  return out;
}

/** The fitted pose for a photo's landmarks. Throws PhotoPoseError when
 * the photo doesn't show a person's shoulders and hips. */
export function poseFromLandmarks(
  landmarks: Landmark[],
  rest: PhotoRest,
  image?: PhotoImage,
): PhotoPoseResult {
  if (landmarks.length < LANDMARK_COUNT)
    throw new PhotoPoseError("No person was found in the photo.");
  const seen = (p: Point) =>
    (landmarks[LANDMARK[p]].visibility ?? 1) >= MIN_VISIBILITY;
  const visible = (part: PhotoPart) => PART_POINTS[part].every(seen);
  if (!visible("torso"))
    throw new PhotoPoseError(
      "The photo needs to show the person's shoulders and hips.",
    );
  const { segments: photo, depth } = photoDirections(landmarks, image);
  const at = rest.seen;

  const jq = (
    joint: BodyJointId,
    values: Partial<Record<BodyJointId, Record<string, number>>>,
  ) => jointQuaternion(joint, values[joint] ?? {}, rest.dirs);
  /** Residual: rest direction `a` turned by `q`, against `target`, with
   * the miss along the camera's depth counting for less. */
  const miss = (
    a: THREE.Vector3,
    q: THREE.Quaternion,
    target: THREE.Vector3,
    w: number,
  ) => {
    const d = a.clone().applyQuaternion(q).sub(target);
    d.addScaledVector(depth, -(1 - DEPTH_TRUST) * d.dot(depth));
    return [d.x * w, d.y * w, d.z * w];
  };

  const patches: PhotoPoseResult["patches"] = {};
  const errors: number[] = [];
  const angle = (a: THREE.Vector3, q: THREE.Quaternion, t: THREE.Vector3) =>
    errors.push(a.clone().applyQuaternion(q).angleTo(t) / DEG);
  const keep = (vars: FitVar[], x: number[]) =>
    vars.forEach((v, i) => {
      (patches[v.joint] ??= {})[v.dof] = Math.round(x[i]) || 0;
    });
  /** Rounded values, as the figure will get them. */
  const rounded = (vars: FitVar[], x: number[]) =>
    valuesOf(
      vars,
      x.map((v) => Math.round(v)),
    );
  const found: PhotoPart[] = ["torso"];
  const missing: PhotoPart[] = [];

  // Torso: hips to shoulders, and the shoulder line for its twist.
  const spineVars = fitVars("spine", { twist: 0.05 });
  const spineX = fit(
    spineVars,
    (x) => {
      const q = jq("spine", valuesOf(spineVars, x));
      return [
        ...miss(at.torso, q, photo.torso, 1),
        ...miss(at.shoulders, q, photo.shoulders, 0.6),
      ];
    },
    [[0, 0, 0]],
  );
  keep(spineVars, spineX);
  const spineQ = jq("spine", rounded(spineVars, spineX));
  angle(at.torso, spineQ, photo.torso);

  // Head: the ear line, and eyes in front of the ears.
  if (visible("head")) {
    found.push("head");
    const headVars = fitVars("head", {});
    const headX = fit(
      headVars,
      (x) => {
        const q = spineQ.clone().multiply(jq("head", valuesOf(headVars, x)));
        return [
          ...miss(at.ears, q, photo.ears, 0.6),
          ...miss(at.face, q, photo.face, 1),
        ];
      },
      [[0, 0, 0]],
    );
    keep(headVars, headX);
    const q = spineQ.clone().multiply(jq("head", rounded(headVars, headX)));
    angle(at.face, q, photo.face);
  } else missing.push("head");

  for (const s of ["L", "R"] as const) {
    const sh = `shoulder${s}` as const;
    const el = `elbow${s}` as const;
    const wr = `wrist${s}` as const;
    // Arm: upper arm and forearm; with the hand in view, the wrist too
    // (the hand's direction and which side the thumb is on).
    if (visible(`arm${s}`)) {
      found.push(`arm${s}`);
      const hand = visible(`hand${s}`);
      (hand ? found : missing).push(`hand${s}`);
      const vars = [
        ...fitVars(sh, { twist: 0.15 }),
        ...fitVars(el, {}),
        ...(hand ? fitVars(wr, { bend: 0.2, lift: 0.2, twist: 0.2 }) : []),
      ];
      const chain = (v: ReturnType<typeof valuesOf>) => {
        const qs = spineQ.clone().multiply(jq(sh, v));
        const qe = qs.clone().multiply(jq(el, v));
        const qw = qe.clone().multiply(jq(wr, v));
        return { qs, qe, qw };
      };
      const x = fit(
        vars,
        (x) => {
          const v = valuesOf(vars, x);
          const { qs, qe, qw } = chain(v);
          return [
            ...miss(at.upperArm[s], qs, photo.upperArm[s], 1),
            ...miss(at.forearm[s], qe, photo.forearm[s], 1),
            ...(hand ? miss(at.hand[s], qw, photo.hand[s], 0.5) : []),
            ...(hand ? miss(at.thumb[s], qw, photo.thumb[s], 0.35) : []),
            // A raised arm seen from the front can read as swung forward
            // over the top; people far more often lift out to the side.
            OVER_THE_TOP * Math.max(0, v[sh]!.forward - 100) * DEG,
          ];
        },
        grid(vars, {
          [`${sh}.raise`]: [0, 90, 140],
          [`${sh}.forward`]: [0, 90],
          [`${el}.bend`]: [10, 90],
        }),
      );
      keep(vars, x);
      const { qs, qe } = chain(rounded(vars, x));
      angle(at.upperArm[s], qs, photo.upperArm[s]);
      angle(at.forearm[s], qe, photo.forearm[s]);
    } else missing.push(`arm${s}`, `hand${s}`);

    // Leg: thigh and shin; with the foot in view, the ankle too (the
    // heel-to-toe line, which also says how the leg is turned).
    const hp = `hip${s}` as const;
    const kn = `knee${s}` as const;
    const an = `ankle${s}` as const;
    if (visible(`leg${s}`)) {
      found.push(`leg${s}`);
      const foot = visible(`foot${s}`);
      (foot ? found : missing).push(`foot${s}`);
      const vars = [
        ...fitVars(hp, { twist: 0.1 }),
        ...fitVars(kn, {}),
        ...(foot ? fitVars(an, { point: 0.1, tilt: 0.3 }) : []),
      ];
      const chain = (v: ReturnType<typeof valuesOf>) => {
        const qh = jq(hp, v);
        const qk = qh.clone().multiply(jq(kn, v));
        const qa = qk.clone().multiply(jq(an, v));
        return { qh, qk, qa };
      };
      const x = fit(
        vars,
        (x) => {
          const { qh, qk, qa } = chain(valuesOf(vars, x));
          return [
            ...miss(at.thigh[s], qh, photo.thigh[s], 1),
            ...miss(at.shin[s], qk, photo.shin[s], 1),
            ...(foot ? miss(at.foot[s], qa, photo.foot[s], 0.6) : []),
          ];
        },
        grid(vars, { [`${hp}.forward`]: [0, 90], [`${kn}.bend`]: [5, 90] }),
      );
      keep(vars, x);
      const { qh, qk } = chain(rounded(vars, x));
      angle(at.thigh[s], qh, photo.thigh[s]);
      angle(at.shin[s], qk, photo.shin[s]);
    } else missing.push(`leg${s}`, `foot${s}`);
  }

  return {
    patches,
    found,
    missing,
    errorDeg: errors.reduce((a, b) => a + b, 0) / errors.length,
  };
}
