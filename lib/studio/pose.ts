/** Mannequin pose: joint angles in degrees, relative to the scan's
 * A-pose (all zeros). Each joint has named degrees of freedom with
 * anatomical limits; the engine maps them onto the rigged skeleton.
 *
 * Sides are the figure's own: "L" is the mannequin's left (on the
 * viewer's right when it faces the camera). */

import { z } from "zod";

export type Dof = {
  label: string;
  min: number;
  max: number;
  hint?: string;
  /** Shown after the value; angles (the default) are "°". */
  unit?: string;
};

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
const ANKLE = {
  point: { label: "Point", min: -30, max: 45, hint: "Toes down" },
  tilt: { label: "Tilt", min: -25, max: 25, hint: "Sole inward" },
} as const satisfies Record<string, Dof>;
/** Knuckle (MCP): curls the whole finger and moves it sideways. */
const KNUCKLE = {
  curl: { label: "Curl", min: -20, max: 90, hint: "Towards the palm" },
  spread: { label: "Sideways", min: -20, max: 20, hint: "Towards the thumb" },
} as const satisfies Record<string, Dof>;
const MIDDLE_JOINT = {
  curl: { label: "Curl", min: 0, max: 110 },
} as const satisfies Record<string, Dof>;
const END_JOINT = {
  curl: { label: "Curl", min: 0, max: 80 },
} as const satisfies Record<string, Dof>;
const THUMB_BASE = {
  across: { label: "Across", min: -20, max: 50, hint: "Towards the fingers" },
  out: { label: "Out", min: -10, max: 60, hint: "Away from the palm" },
} as const satisfies Record<string, Dof>;
const THUMB_JOINT = {
  curl: { label: "Curl", min: -10, max: 70 },
} as const satisfies Record<string, Dof>;

export const FINGERS = ["index", "middle", "ring", "pinky"] as const;
export type Finger = (typeof FINGERS)[number];
const FINGER_NAMES: Record<Finger | "thumb", string> = {
  thumb: "thumb",
  index: "index finger",
  middle: "middle finger",
  ring: "ring finger",
  pinky: "little finger",
};

/** Ankles and every finger joint of one side, in a fixed order. */
function handAndFoot<S extends "L" | "R">(side: S) {
  const sideName = side === "L" ? "Left" : "Right";
  const finger = <F extends Finger>(f: F) => ({
    [`${f}1${side}`]: {
      label: `${sideName} ${FINGER_NAMES[f]}: knuckle`,
      dofs: KNUCKLE,
    },
    [`${f}2${side}`]: {
      label: `${sideName} ${FINGER_NAMES[f]}: middle`,
      dofs: MIDDLE_JOINT,
    },
    [`${f}3${side}`]: {
      label: `${sideName} ${FINGER_NAMES[f]}: tip`,
      dofs: END_JOINT,
    },
  });
  return {
    [`ankle${side}`]: { label: `${sideName} ankle`, dofs: ANKLE },
    [`thumb1${side}`]: { label: `${sideName} thumb: base`, dofs: THUMB_BASE },
    [`thumb2${side}`]: {
      label: `${sideName} thumb: middle`,
      dofs: THUMB_JOINT,
    },
    [`thumb3${side}`]: { label: `${sideName} thumb: tip`, dofs: THUMB_JOINT },
    ...finger("index"),
    ...finger("middle"),
    ...finger("ring"),
    ...finger("pinky"),
  } as {
    [K in `ankle${S}`]: { label: string; dofs: typeof ANKLE };
  } & {
    [K in `thumb1${S}`]: { label: string; dofs: typeof THUMB_BASE };
  } & {
    [K in `thumb${2 | 3}${S}`]: { label: string; dofs: typeof THUMB_JOINT };
  } & {
    [K in `${Finger}1${S}`]: { label: string; dofs: typeof KNUCKLE };
  } & {
    [K in `${Finger}2${S}`]: { label: string; dofs: typeof MIDDLE_JOINT };
  } & {
    [K in `${Finger}3${S}`]: { label: string; dofs: typeof END_JOINT };
  };
}

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
  // Added later; kept last so older flattened poses (share links) still
  // line up, missing values reading as 0.
  ...handAndFoot("L"),
  ...handAndFoot("R"),
  // The face: no bones on the mannequin; an imported character's eye
  // bones and face shapes (lib/engine/face.ts). Expressions are percent.
  eyes: {
    label: "Eyes",
    dofs: {
      turn: { label: "Look sideways", min: -35, max: 35, hint: "To its left" },
      raise: { label: "Look up", min: -25, max: 25, hint: "Up" },
    },
  },
  expression: {
    label: "Expression",
    dofs: {
      happy: { label: "Happy", min: 0, max: 100, unit: "%" },
      angry: { label: "Angry", min: 0, max: 100, unit: "%" },
      sad: { label: "Sad", min: 0, max: 100, unit: "%" },
      relaxed: { label: "Relaxed", min: 0, max: 100, unit: "%" },
      surprised: { label: "Surprised", min: 0, max: 100, unit: "%" },
    },
  },
  eyelids: {
    label: "Eyelids",
    dofs: {
      blink: { label: "Blink", min: 0, max: 100, unit: "%" },
      left: { label: "Close left eye", min: 0, max: 100, unit: "%" },
      right: { label: "Close right eye", min: 0, max: 100, unit: "%" },
    },
  },
  mouth: {
    label: "Mouth",
    dofs: {
      aa: { label: "A (father)", min: 0, max: 100, unit: "%" },
      ih: { label: "I (see)", min: 0, max: 100, unit: "%" },
      ou: { label: "U (you)", min: 0, max: 100, unit: "%" },
      ee: { label: "E (bed)", min: 0, max: 100, unit: "%" },
      oh: { label: "O (go)", min: 0, max: 100, unit: "%" },
    },
  },
} as const satisfies Record<
  string,
  { label: string; dofs: Record<string, Dof> }
>;

export type JointId = keyof typeof JOINTS;
export const JOINT_IDS = Object.keys(JOINTS) as JointId[];
/** The face's controls: no bone of their own on the mannequin. */
export const FACE_JOINT_IDS = [
  "eyes",
  "expression",
  "eyelids",
  "mouth",
] as const;
export type FaceJointId = (typeof FACE_JOINT_IDS)[number];
export type BodyJointId = Exclude<JointId, FaceJointId>;
export const isFaceJoint = (id: string): id is FaceJointId =>
  (FACE_JOINT_IDS as readonly string[]).includes(id);
/** Joints that turn a bone of the standard skeleton. */
export const BODY_JOINT_IDS = JOINT_IDS.filter(
  (id) => !isFaceJoint(id),
) as BodyJointId[];
export type JointValues<J extends JointId = JointId> = {
  [K in keyof (typeof JOINTS)[J]["dofs"]]: number;
};

/** The 15 joints of one hand: thumb first, then the fingers. */
export function handJoints<S extends "L" | "R">(side: S) {
  return [
    `thumb1${side}`,
    `thumb2${side}`,
    `thumb3${side}`,
    ...FINGERS.flatMap((f) =>
      ([1, 2, 3] as const).map((k) => `${f}${k}${side}` as const),
    ),
  ] as Array<`thumb${1 | 2 | 3}${S}` | `${Finger}${1 | 2 | 3}${S}`>;
}

/** Body-part groups, for the inspector and for tap-to-pose. */
export const POSE_GROUPS = [
  { id: "head", label: "Head", joints: ["head"] },
  { id: "torso", label: "Torso", joints: ["spine"] },
  { id: "armL", label: "Left arm", joints: ["shoulderL", "elbowL", "wristL"] },
  { id: "armR", label: "Right arm", joints: ["shoulderR", "elbowR", "wristR"] },
  { id: "handL", label: "Left hand", joints: handJoints("L") },
  { id: "handR", label: "Right hand", joints: handJoints("R") },
  { id: "legL", label: "Left leg", joints: ["hipL", "kneeL", "ankleL"] },
  { id: "legR", label: "Right leg", joints: ["hipR", "kneeR", "ankleR"] },
  { id: "face", label: "Face", joints: FACE_JOINT_IDS },
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
              `${JOINTS[id].label} ${d.label.toLowerCase()} is below ${d.min}${d.unit ?? "°"}`,
            )
            .max(
              d.max,
              `${JOINTS[id].label} ${d.label.toLowerCase()} is above ${d.max}${d.unit ?? "°"}`,
            ),
        ]),
      ),
    )
    .strict();
}

/** Joints added after poses were first saved: optional on input. */
const LATER = (id: string) =>
  /^(ankle|thumb|index|middle|ring|pinky)/.test(id) || isFaceJoint(id);

export const PoseJointsSchema = z
  .object(
    Object.fromEntries(
      JOINT_IDS.map((id) => [
        id,
        LATER(id)
          ? jointSchema(id).default(
              () =>
                Object.fromEntries(
                  Object.keys(JOINTS[id].dofs).map((k) => [k, 0]),
                ) as never,
            )
          : jointSchema(id),
      ]),
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
  out.eyes.turn = -src.eyes.turn || 0; // not -0
  out.eyelids.left = src.eyelids.right;
  out.eyelids.right = src.eyelids.left;
  return out as PoseJoints;
}

/** `joints` with the face (eyes, expression, eyelids, mouth) of
 * `face`: body poses and moves leave the face as it was. */
export function keepFace(joints: PoseJoints, face: PoseJoints): PoseJoints {
  const out = { ...joints };
  for (const id of FACE_JOINT_IDS) out[id] = { ...face[id] } as never;
  return out;
}

export function neutralFace(): Pick<PoseJoints, FaceJointId> {
  const n = neutralJoints();
  return Object.fromEntries(FACE_JOINT_IDS.map((id) => [id, n[id]])) as Pick<
    PoseJoints,
    FaceJointId
  >;
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
        // Older, shorter lists (before ankles/fingers): missing = 0.
        Object.keys(JOINTS[id].dofs).map((k) => {
          const v = values[i++];
          return [k, i > values.length ? 0 : v];
        }),
      ),
    ]),
  );
}

// --------------------------------------------------------------- hands

export interface HandShape {
  id: string;
  name: string;
  /** Angles for one hand's joints, by joint name without the side. */
  joints: Record<string, Record<string, number>>;
}

const curlAll = (k: number, m: number, t: number) =>
  Object.fromEntries(
    FINGERS.flatMap((f) => [
      [`${f}1`, { curl: k, spread: 0 }],
      [`${f}2`, { curl: m }],
      [`${f}3`, { curl: t }],
    ]),
  );

/** Quick shapes for one hand's fingers and thumb. */
export const HAND_SHAPES: HandShape[] = [
  {
    id: "relaxed",
    name: "Relaxed",
    joints: {
      ...curlAll(15, 20, 10),
      thumb1: { across: 10, out: 10 },
      thumb2: { curl: 10 },
      thumb3: { curl: 10 },
    },
  },
  {
    id: "fist",
    name: "Fist",
    joints: {
      ...curlAll(85, 100, 70),
      thumb1: { across: 40, out: 10 },
      thumb2: { curl: 40 },
      thumb3: { curl: 50 },
    },
  },
  {
    id: "point",
    name: "Point",
    joints: {
      ...curlAll(85, 100, 70),
      index1: { curl: 0, spread: 0 },
      index2: { curl: 0 },
      index3: { curl: 0 },
      thumb1: { across: 35, out: 5 },
      thumb2: { curl: 35 },
      thumb3: { curl: 40 },
    },
  },
  {
    id: "open",
    name: "Open",
    joints: {
      index1: { curl: -10, spread: 12 },
      middle1: { curl: -10, spread: 4 },
      ring1: { curl: -10, spread: -4 },
      pinky1: { curl: -10, spread: -12 },
      ...Object.fromEntries(
        FINGERS.flatMap((f) => [
          [`${f}2`, { curl: 0 }],
          [`${f}3`, { curl: 0 }],
        ]),
      ),
      thumb1: { across: -15, out: 40 },
      thumb2: { curl: 0 },
      thumb3: { curl: 0 },
    },
  },
];

/** A hand shape as joint patches for one side (one undoable action). */
export function handShapePatches(
  side: "L" | "R",
  id: string,
): Partial<Record<JointId, Record<string, number>>> | null {
  const shape = HAND_SHAPES.find((h) => h.id === id);
  if (!shape) return null;
  return Object.fromEntries(
    Object.entries(shape.joints).map(([j, v]) => [`${j}${side}`, v]),
  ) as Partial<Record<JointId, Record<string, number>>>;
}
