/** Mannequin pose: joint angles in degrees, relative to the scan's
 * A-pose (all zeros). Each joint has named degrees of freedom with
 * anatomical limits; the engine maps them onto the rigged skeleton.
 *
 * Sides are the figure's own: "L" is the mannequin's left (on the
 * viewer's right when it faces the camera). */

import { z } from "zod";

export type Dof = { label: string; min: number; max: number; hint?: string };

const SHOULDER = {
  raise: { label: "Raise", min: -25, max: 150, hint: "Out to the side" },
  forward: { label: "Forward", min: -50, max: 160, hint: "Swing forward" },
  twist: { label: "Twist", min: -90, max: 90, hint: "Roll outward" },
} as const satisfies Record<string, Dof>;
const ELBOW = {
  bend: { label: "Bend", min: 0, max: 145 },
} as const satisfies Record<string, Dof>;
const WRIST = {
  bend: { label: "Bend", min: -70, max: 70, hint: "Towards the palm" },
  lift: { label: "Lift", min: -45, max: 45, hint: "Thumb side up" },
  twist: { label: "Twist", min: -80, max: 80, hint: "Palm forward" },
} as const satisfies Record<string, Dof>;
const HIP = {
  forward: { label: "Forward", min: -30, max: 110, hint: "Swing forward" },
  out: { label: "Out", min: -15, max: 60, hint: "Out to the side" },
  twist: { label: "Twist", min: -45, max: 45, hint: "Toes outward" },
} as const satisfies Record<string, Dof>;
const KNEE = {
  bend: { label: "Bend", min: 0, max: 140 },
} as const satisfies Record<string, Dof>;

export const JOINTS = {
  head: {
    label: "Head",
    dofs: {
      nod: { label: "Nod", min: -40, max: 50, hint: "Chin down" },
      tilt: { label: "Tilt", min: -35, max: 35, hint: "To its left" },
      turn: { label: "Turn", min: -70, max: 70, hint: "To its left" },
    },
  },
  spine: {
    label: "Torso",
    dofs: {
      bend: { label: "Bend", min: -25, max: 45, hint: "Lean forward" },
      side: { label: "Side", min: -30, max: 30, hint: "Lean to its left" },
      twist: { label: "Twist", min: -45, max: 45, hint: "Turn to its left" },
    },
  },
  shoulderL: { label: "Left shoulder", dofs: SHOULDER },
  elbowL: { label: "Left elbow", dofs: ELBOW },
  wristL: { label: "Left wrist", dofs: WRIST },
  shoulderR: { label: "Right shoulder", dofs: SHOULDER },
  elbowR: { label: "Right elbow", dofs: ELBOW },
  wristR: { label: "Right wrist", dofs: WRIST },
  hipL: { label: "Left hip", dofs: HIP },
  kneeL: { label: "Left knee", dofs: KNEE },
  hipR: { label: "Right hip", dofs: HIP },
  kneeR: { label: "Right knee", dofs: KNEE },
} as const satisfies Record<
  string,
  { label: string; dofs: Record<string, Dof> }
>;

export type JointId = keyof typeof JOINTS;
export const JOINT_IDS = Object.keys(JOINTS) as JointId[];
export type JointValues<J extends JointId = JointId> = {
  [K in keyof (typeof JOINTS)[J]["dofs"]]: number;
};

/** Body-part groups, for the inspector and for tap-to-pose. */
export const POSE_GROUPS = [
  { id: "head", label: "Head", joints: ["head"] },
  { id: "torso", label: "Torso", joints: ["spine"] },
  { id: "armL", label: "Left arm", joints: ["shoulderL", "elbowL", "wristL"] },
  { id: "armR", label: "Right arm", joints: ["shoulderR", "elbowR", "wristR"] },
  { id: "legL", label: "Left leg", joints: ["hipL", "kneeL"] },
  { id: "legR", label: "Right leg", joints: ["hipR", "kneeR"] },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  joints: readonly JointId[];
}>;
export type PoseGroupId = (typeof POSE_GROUPS)[number]["id"];

export function groupOfJoint(joint: JointId): PoseGroupId {
  return POSE_GROUPS.find((g) =>
    (g.joints as readonly string[]).includes(joint),
  )!.id;
}

function jointSchema(id: JointId) {
  const dofs = JOINTS[id].dofs as Record<string, Dof>;
  return z
    .object(
      Object.fromEntries(
        Object.entries(dofs).map(([k, d]) => [
          k,
          z
            .number()
            .finite()
            .min(
              d.min,
              `${JOINTS[id].label} ${d.label.toLowerCase()} is below ${d.min}°`,
            )
            .max(
              d.max,
              `${JOINTS[id].label} ${d.label.toLowerCase()} is above ${d.max}°`,
            ),
        ]),
      ),
    )
    .strict();
}

export const PoseJointsSchema = z
  .object(
    Object.fromEntries(
      JOINT_IDS.map((id) => [id, jointSchema(id)]),
    ) as unknown as {
      [J in JointId]: z.ZodType<JointValues<J>>;
    },
  )
  .strict();

export const PoseSchema = z.object({
  /** Pose preset id, or "custom" after a manual edit. */
  preset: z.string().max(32),
  joints: PoseJointsSchema,
});
export type Pose = z.infer<typeof PoseSchema>;
export type PoseJoints = Pose["joints"];

/** Partial update for one joint; values outside the joint's limits fail
 * validation (the reducer re-validates the whole scene). */
export const JointPatchSchema = z.record(z.string(), z.number().finite());

export function neutralJoints(): PoseJoints {
  return Object.fromEntries(
    JOINT_IDS.map((id) => [
      id,
      Object.fromEntries(Object.keys(JOINTS[id].dofs).map((k) => [k, 0])),
    ]),
  ) as PoseJoints;
}

type PosePartial = { [J in JointId]?: Partial<JointValues<J>> };

function build(partial: PosePartial): PoseJoints {
  const joints = neutralJoints() as Record<string, Record<string, number>>;
  for (const [id, values] of Object.entries(partial))
    Object.assign(joints[id], values);
  return joints as PoseJoints;
}

export interface PosePreset {
  id: string;
  name: string;
  note: string;
  joints: PoseJoints;
}

export const POSE_PRESETS: PosePreset[] = [
  {
    id: "neutral",
    name: "Scan A-pose",
    note: "The figure as scanned. Every slider at 0.",
    joints: neutralJoints(),
  },
  {
    id: "relaxed",
    name: "Relaxed",
    note: "Arms by the sides, a slight bend at the elbows.",
    joints: build({
      shoulderL: { raise: -18, forward: 4 },
      shoulderR: { raise: -18, forward: 4 },
      elbowL: { bend: 12 },
      elbowR: { bend: 12 },
    }),
  },
  {
    id: "hand-raised",
    name: "Hand raised",
    note: "Right hand lifted up, like asking a question. Watch the shadow it throws on the face.",
    joints: build({
      shoulderR: { raise: 120, forward: 20, twist: 20 },
      elbowR: { bend: 35 },
      wristR: { lift: 15 },
      shoulderL: { raise: -18, forward: 4 },
      elbowL: { bend: 12 },
    }),
  },
  {
    id: "hand-on-hip",
    name: "Hand on hip",
    note: "Left hand on the hip, elbow out: opens a triangle of light between arm and body.",
    joints: build({
      shoulderL: { raise: 10, forward: -15, twist: -30 },
      elbowL: { bend: 95 },
      wristL: { bend: 20 },
      shoulderR: { raise: -18, forward: 4 },
      elbowR: { bend: 12 },
      spine: { side: -4 },
      head: { tilt: 5 },
    }),
  },
  {
    id: "thinker",
    name: "Hand to chin",
    note: "Classic portrait pose: the forearm and hand become a second plane for the light to model.",
    joints: build({
      shoulderR: { raise: -10, forward: 45, twist: -35 },
      elbowR: { bend: 135 },
      wristR: { bend: -20, lift: 20 },
      shoulderL: { raise: -18, forward: 4 },
      elbowL: { bend: 12 },
      head: { nod: 8, tilt: -5 },
    }),
  },
  {
    id: "arms-up",
    name: "Arms up",
    note: "Both arms overhead: shows how the light wraps the ribcage and armpits.",
    joints: build({
      shoulderL: { raise: 140, forward: 10 },
      shoulderR: { raise: 140, forward: 10 },
      elbowL: { bend: 15 },
      elbowR: { bend: 15 },
      head: { nod: -10 },
    }),
  },
  {
    id: "stride",
    name: "Mid-stride",
    note: "A walking step with counter-swinging arms.",
    joints: build({
      hipL: { forward: 22 },
      kneeL: { bend: 18 },
      hipR: { forward: -12 },
      kneeR: { bend: 6 },
      shoulderL: { raise: -20, forward: -18 },
      shoulderR: { raise: -20, forward: 22 },
      elbowL: { bend: 10 },
      elbowR: { bend: 25 },
      spine: { twist: 6 },
    }),
  },
];

export function posePreset(id: string): PosePreset | undefined {
  return POSE_PRESETS.find((p) => p.id === id);
}

export function defaultPose(): Pose {
  return { preset: "neutral", joints: neutralJoints() };
}

/** Swap left and right. Per-side angles carry over unchanged (each side
 * uses its own anatomical directions); the trunk's sideways angles flip. */
export function mirrorJoints(joints: PoseJoints): PoseJoints {
  const out = structuredClone(joints) as Record<string, Record<string, number>>;
  const src = joints as Record<string, Record<string, number>>;
  for (const id of JOINT_IDS) {
    const other = id.endsWith("L")
      ? `${id.slice(0, -1)}R`
      : id.endsWith("R")
        ? `${id.slice(0, -1)}L`
        : null;
    if (other) out[id] = { ...src[other] };
  }
  out.head.tilt = -src.head.tilt;
  out.head.turn = -src.head.turn;
  out.spine.side = -src.spine.side;
  out.spine.twist = -src.spine.twist;
  return out as PoseJoints;
}

export function isNeutral(joints: PoseJoints): boolean {
  return Object.values(joints as Record<string, Record<string, number>>).every(
    (v) => Object.values(v).every((x) => x === 0),
  );
}

/** Flat list of every value in a fixed order (share links). */
export function flattenJoints(joints: PoseJoints): number[] {
  const src = joints as Record<string, Record<string, number>>;
  return JOINT_IDS.flatMap((id) =>
    Object.keys(JOINTS[id].dofs).map((k) => src[id][k]),
  );
}

export function unflattenJoints(values: unknown[]): unknown {
  let i = 0;
  return Object.fromEntries(
    JOINT_IDS.map((id) => [
      id,
      Object.fromEntries(
        Object.keys(JOINTS[id].dofs).map((k) => [k, values[i++]]),
      ),
    ]),
  );
}
