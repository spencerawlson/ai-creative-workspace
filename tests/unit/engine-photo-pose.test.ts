import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  LANDMARK,
  LANDMARK_COUNT,
  PhotoPoseError,
  poseFromLandmarks,
  photoRest,
  type Landmark,
} from "@/lib/engine/photoPose";
import { referenceDirections } from "@/lib/engine/humanoid";
import { jointQuaternion } from "@/lib/engine/posing";
import {
  JOINTS,
  POSE_PRESETS,
  neutralJoints,
  type BodyJointId,
  type Dof,
  type PoseJoints,
} from "@/lib/studio/pose";

const rest = photoRest(referenceDirections());
const { seen } = rest;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** `from` plus `d` turned by `q`, times `k`. */
const step = (
  from: THREE.Vector3,
  d: THREE.Vector3,
  q: THREE.Quaternion,
  k: number,
) => from.clone().add(d.clone().applyQuaternion(q).multiplyScalar(k));

/** MediaPipe-style landmarks for the mannequin in `joints` as a photo
 * shows it (the calibrated rest directions), turned `yaw` degrees from
 * facing the camera: the solver's inverse. */
function landmarksFor(joints: PoseJoints, yaw = 0): Landmark[] {
  const j = joints as Record<string, Record<string, number>>;
  const q = (id: BodyJointId) => jointQuaternion(id, j[id], rest.dirs);
  const p: Record<string, THREE.Vector3> = {};
  const spine = q("spine");
  const chest = step(v(0, 0, 0), seen.torso, spine, 0.5);
  const head = spine.clone().multiply(q("head"));
  const crown = step(chest, v(0, 0.15, 0), head, 1);
  p.earL = step(crown, seen.ears, head, 0.07);
  p.earR = step(crown, seen.ears, head, -0.07);
  const eyes = step(crown, seen.face, head, 0.08);
  p.eyeL = step(eyes, seen.ears, head, 0.03);
  p.eyeR = step(eyes, seen.ears, head, -0.03);
  for (const s of ["L", "R"] as const) {
    const sx = s === "L" ? 1 : -1;
    const shoulder = step(chest, seen.shoulders, spine, 0.18 * sx);
    const qs = spine.clone().multiply(q(`shoulder${s}`));
    const qe = qs.clone().multiply(q(`elbow${s}`));
    const qw = qe.clone().multiply(q(`wrist${s}`));
    const elbow = step(shoulder, seen.upperArm[s], qs, 0.3);
    const wrist = step(elbow, seen.forearm[s], qe, 0.27);
    const knuckles = step(wrist, seen.hand[s], qw, 0.08);
    p[`shoulder${s}`] = shoulder;
    p[`elbow${s}`] = elbow;
    p[`wrist${s}`] = wrist;
    p[`index${s}`] = step(knuckles, seen.thumb[s], qw, 0.03);
    p[`pinky${s}`] = step(knuckles, seen.thumb[s], qw, -0.03);

    const hip = v(0.09 * sx, 0, 0);
    const qh = q(`hip${s}`);
    const qk = qh.clone().multiply(q(`knee${s}`));
    const qa = qk.clone().multiply(q(`ankle${s}`));
    const knee = step(hip, seen.thigh[s], qh, 0.42);
    const ankle = step(knee, seen.shin[s], qk, 0.42);
    const heel = step(ankle, v(0, -0.06, -0.04), qa, 1);
    p[`hip${s}`] = hip;
    p[`knee${s}`] = knee;
    p[`ankle${s}`] = ankle;
    p[`heel${s}`] = heel;
    p[`toe${s}`] = step(heel, seen.foot[s], qa, 0.2);
  }
  const turn = new THREE.Quaternion().setFromAxisAngle(
    v(0, 1, 0),
    (yaw * Math.PI) / 180,
  );
  const out: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 0.99,
  }));
  for (const [name, at] of Object.entries(p)) {
    const c = at.clone().applyQuaternion(turn);
    out[LANDMARK[name as keyof typeof LANDMARK]] = {
      x: c.x,
      y: -c.y,
      z: -c.z,
      visibility: 0.99,
    };
  }
  return out;
}

function build(partial: Partial<Record<BodyJointId, Record<string, number>>>) {
  const joints = neutralJoints() as Record<string, Record<string, number>>;
  for (const [id, values] of Object.entries(partial))
    Object.assign(joints[id], values);
  return joints as PoseJoints;
}

const SITTING = build({
  hipL: { forward: 90, out: 8 },
  hipR: { forward: 85, out: 5 },
  kneeL: { bend: 90 },
  kneeR: { bend: 80 },
  ankleL: { point: 10 },
  spine: { bend: 10, twist: -8 },
  head: { nod: 12, turn: 25, tilt: -6 },
  shoulderL: { raise: 20, forward: 40, twist: 10 },
  elbowL: { bend: 70 },
  wristL: { bend: 15 },
  shoulderR: { raise: 60, forward: -20 },
  elbowR: { bend: 100 },
});

describe("pose from a photo", () => {
  const cases: Array<[string, PoseJoints]> = [
    ...POSE_PRESETS.map((p) => [p.name, p.joints] as [string, PoseJoints]),
    ["sitting", SITTING],
  ];

  it.each(cases)("recovers %s from its landmarks", (_, joints) => {
    const r = poseFromLandmarks(landmarksFor(joints), rest);
    expect(r.missing).toEqual([]);
    expect(r.errorDeg).toBeLessThan(2);
    const j = joints as Record<string, Record<string, number>>;
    // The big, well-seen angles come back within a few degrees.
    for (const [id, dof] of [
      ["spine", "bend"],
      ["head", "nod"],
      ["head", "turn"],
      ["shoulderL", "raise"],
      ["shoulderR", "raise"],
      ["shoulderL", "forward"],
      ["shoulderR", "forward"],
      ["elbowL", "bend"],
      ["elbowR", "bend"],
      ["hipL", "forward"],
      ["hipR", "forward"],
      ["kneeL", "bend"],
      ["kneeR", "bend"],
    ] as const)
      expect(
        Math.abs(r.patches[id]![dof] - j[id][dof]),
        `${id}.${dof}`,
      ).toBeLessThan(5);
  });

  it("doesn't care which way the person faces the camera", () => {
    const front = poseFromLandmarks(landmarksFor(SITTING), rest);
    for (const yaw of [35, -70, 160]) {
      const turned = poseFromLandmarks(landmarksFor(SITTING, yaw), rest);
      for (const [id, values] of Object.entries(front.patches))
        for (const [dof, x] of Object.entries(values))
          expect(
            Math.abs(turned.patches[id as BodyJointId]![dof] - x),
            `${yaw}° ${id}.${dof}`,
          ).toBeLessThanOrEqual(2);
    }
  });

  it("gives whole degrees within every joint's limits", () => {
    const r = poseFromLandmarks(landmarksFor(SITTING), rest);
    for (const [id, values] of Object.entries(r.patches))
      for (const [dof, x] of Object.entries(values)) {
        const d = (JOINTS[id as BodyJointId].dofs as Record<string, Dof>)[dof];
        expect(Number.isInteger(x)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(d.min);
        expect(x).toBeLessThanOrEqual(d.max);
      }
  });

  it("leaves parts the photo doesn't show as they are", () => {
    const lms = landmarksFor(SITTING);
    for (const k of [
      "kneeL",
      "kneeR",
      "ankleL",
      "ankleR",
      "heelL",
      "heelR",
      "toeL",
      "toeR",
    ] as const)
      lms[LANDMARK[k]].visibility = 0.1;
    const r = poseFromLandmarks(lms, rest);
    expect(r.missing).toEqual(["legL", "footL", "legR", "footR"]);
    expect(Object.keys(r.patches)).not.toContain("hipL");
    expect(Object.keys(r.patches)).not.toContain("kneeR");
    expect(r.patches.elbowR!.bend).toBeGreaterThan(90);
  });

  it("keeps the wrist when the hand isn't clear", () => {
    const lms = landmarksFor(SITTING);
    lms[LANDMARK.indexL].visibility = 0.2;
    const r = poseFromLandmarks(lms, rest);
    expect(r.missing).toContain("handL");
    expect(r.patches.wristL).toBeUndefined();
    expect(r.patches.elbowL!.bend).toBeGreaterThan(60);
  });

  it("stays close with noisy landmarks, as a real photo gives", () => {
    // Deterministic jitter of up to ±2 cm on every point.
    let seed = 7;
    const rnd = () =>
      ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.04;
    const lms = landmarksFor(SITTING).map((l) => ({
      ...l,
      x: l.x + rnd(),
      y: l.y + rnd(),
      z: l.z + rnd(),
    }));
    const r = poseFromLandmarks(lms, rest);
    expect(r.errorDeg).toBeLessThan(8);
    const j = SITTING as Record<string, Record<string, number>>;
    for (const [id, dof] of [
      ["elbowL", "bend"],
      ["elbowR", "bend"],
      ["kneeL", "bend"],
      ["kneeR", "bend"],
      ["hipL", "forward"],
      ["shoulderR", "raise"],
    ] as const)
      expect(
        Math.abs(r.patches[id]![dof] - j[id][dof]),
        `${id}.${dof}`,
      ).toBeLessThan(15);
  });

  it("needs the shoulders and hips", () => {
    const lms = landmarksFor(SITTING);
    lms[LANDMARK.hipL].visibility = 0;
    expect(() => poseFromLandmarks(lms, rest)).toThrow(PhotoPoseError);
    expect(() => poseFromLandmarks([], rest)).toThrow(/No person/);
  });

  it("takes a limb's direction across the photo from the image, not 3D depth", () => {
    // A forearm raised to the chin, but the 3D points have it short and
    // pointing at the camera (as MediaPipe often does); the image shows
    // where it really goes.
    const joints = build({
      shoulderR: { raise: -10, forward: 20 },
      elbowR: { bend: 120 },
    });
    const truth = landmarksFor(joints);
    const image = {
      points: truth.map((l) => ({
        ...l,
        x: 0.5 + l.x * 0.4,
        y: 0.5 + l.y * 0.4,
      })),
      aspect: 1,
    };
    const world = truth.map((l) => ({ ...l }));
    const e = world[LANDMARK.elbowR];
    const w = world[LANDMARK.wristR];
    const moved = {
      x: e.x + (w.x - e.x) * 0.35,
      y: e.y + (w.y - e.y) * 0.35,
      // Same way in depth as the truth, but far too much of it.
      z: e.z + Math.sign(w.z - e.z || -1) * 0.25,
    };
    // The hand goes with the wrist.
    for (const p of [LANDMARK.indexR, LANDMARK.pinkyR]) {
      world[p].x += moved.x - w.x;
      world[p].y += moved.y - w.y;
      world[p].z += moved.z - w.z;
    }
    Object.assign(w, moved);
    const without = poseFromLandmarks(world, rest).patches.elbowR!.bend;
    const withImage = poseFromLandmarks(world, rest, image).patches.elbowR!
      .bend;
    expect(Math.abs(withImage - 120)).toBeLessThan(10);
    expect(Math.abs(without - 120)).toBeGreaterThan(25);
  });
});

/** MediaPipe's real output (tests/fixtures/photo-landmarks.json): public-
 * domain photos of people, with what they show judged by eye, and renders
 * of the mannequin in known poses. */
describe("pose from real MediaPipe landmarks", () => {
  const fixture = JSON.parse(
    readFileSync("tests/fixtures/photo-landmarks.json", "utf8"),
  ) as Record<
    "photos" | "renders",
    Array<{ id: string; aspect: number; world: Landmark[]; image: Landmark[] }>
  >;
  const male = photoRest(referenceDirections());
  const solve = (set: "photos" | "renders", id: string) => {
    const d = fixture[set].find((p) => p.id === id)!;
    const r = poseFromLandmarks(d.world, male, {
      points: d.image,
      aspect: d.aspect,
    });
    return (joint: string, dof: string) =>
      (r.patches as Record<string, Record<string, number>>)[joint]?.[dof];
  };

  it.each(["standing-top-hat", "standing-2", "ranger-standing"])(
    "%s: someone standing comes out standing",
    (id) => {
      const at = solve("photos", id);
      expect(Math.abs(at("spine", "bend")!)).toBeLessThanOrEqual(12);
      for (const knee of ["kneeL", "kneeR"]) {
        const bend = at(knee, "bend");
        if (bend !== undefined) expect(bend).toBeLessThanOrEqual(20);
      }
      for (const s of ["L", "R"]) {
        const raise = at(`shoulder${s}`, "raise");
        if (raise !== undefined) expect(raise).toBeLessThan(15); // arms down
      }
    },
  );

  it("tree pose with hands together at the chest", () => {
    const at = solve("photos", "ranger-tree-prayer");
    expect(at("elbowL", "bend")).toBeGreaterThan(85);
    expect(at("elbowR", "bend")).toBeGreaterThan(85);
    // Her left foot is up against the other knee.
    expect(at("kneeL", "bend")).toBeGreaterThan(80);
    expect(at("hipL", "forward")).toBeGreaterThan(25);
  });

  it("hands raised to the face: elbows deeply bent", () => {
    const at = solve("photos", "ranger-hands-to-face");
    expect(at("elbowL", "bend")).toBeGreaterThan(95);
    expect(at("elbowR", "bend")).toBeGreaterThan(95);
  });

  it.each([
    ["neutral", { "shoulderR.raise": 0, "elbowR.bend": 0, "spine.bend": 0 }],
    ["hand-raised", { "shoulderR.raise": 120, "elbowL.bend": 12 }],
    ["thinker", { "elbowR.bend": 135, "shoulderL.raise": -18 }],
    ["arms-up", { "shoulderL.raise": 140, "shoulderR.raise": 140 }],
  ] as const)("the mannequin's %s preset, rendered", (id, truth) => {
    const at = solve("renders", id);
    for (const [k, v] of Object.entries(truth)) {
      const [joint, dof] = k.split(".");
      expect(Math.abs(at(joint, dof)! - v), k).toBeLessThan(25);
    }
  });
});
