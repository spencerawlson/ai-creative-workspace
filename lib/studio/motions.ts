/** Built-in motion library: poses (one frame) and moves (frames over
 * time) that can be put on a figure by typing their name. Pure data and
 * pure functions; no React or Three.js.
 *
 * Frames list only the joints that differ from a relaxed stance (arms
 * by the sides, hands relaxed). One-sided motions are written for the
 * figure's right side and mirrored for "left". A move's frames become
 * ordinary keyframes on one figure, so they can be edited afterwards
 * like any other key. */

import {
  JOINTS,
  handShapePatches,
  mirrorJoints,
  neutralJoints,
  type JointId,
  type PoseJoints,
} from "./pose";

type Patch = Partial<Record<JointId, Record<string, number>>>;
type Hands = { L?: string; R?: string };

export interface MotionFrame {
  /** Seconds from the start of the move (or of one cycle). */
  at: number;
  pose: Patch;
  /** Metres off the floor (jumps); the feet are kept on the floor
   * otherwise. */
  air?: number;
  /** Degrees turned since the start (spins). */
  turn?: number;
  hands?: Hands;
}

export type MotionCategory =
  | "Standing"
  | "Sitting and kneeling"
  | "Gestures"
  | "Everyday"
  | "Getting around"
  | "Sport and action"
  | "Dance and exercise";

export interface Motion {
  id: string;
  name: string;
  kind: "pose" | "move";
  category: MotionCategory;
  note: string;
  /** Other words people type for it. */
  words: string[];
  frames: MotionFrame[];
  /** Repeating moves: the frames are one cycle this long, played
   * `repeat` times and closed with the first frame. */
  cycle?: number;
  repeat?: number;
  /** Metres forward per cycle, the way the figure faces. */
  travel?: number;
  /** Metres up per cycle (climbing). */
  rise?: number;
  /** Uses one side more than the other: "left" mirrors it. */
  sided?: boolean;
  /** Hand shapes for every frame (default: relaxed). */
  hands?: Hands;
}

// ------------------------------------------------------------ helpers

const RELAXED: Patch = {
  shoulderL: { raise: -18, forward: 4 },
  shoulderR: { raise: -18, forward: 4 },
  elbowL: { bend: 12 },
  elbowR: { bend: 12 },
};

/** Swap a patch's sides (for writing symmetric frames). */
function mirrorPatch(p: Patch): Patch {
  const full = build(p, { L: "none", R: "none" }, true);
  const m = mirrorJoints(full) as Record<string, Record<string, number>>;
  const out: Patch = {};
  for (const id of Object.keys(p) as JointId[]) {
    const other = (
      id.endsWith("L")
        ? `${id.slice(0, -1)}R`
        : id.endsWith("R")
          ? `${id.slice(0, -1)}L`
          : id
    ) as JointId;
    out[other] = Object.fromEntries(
      Object.keys(p[id]!).map((k) => [k, m[other][k]]),
    );
  }
  return out;
}
/** A patch plus its mirror image (both arms, both legs). */
const both = (p: Patch): Patch => ({ ...p, ...mirrorPatch(p) });

const f = (at: number, pose: Patch, extra: Partial<MotionFrame> = {}) => ({
  at,
  pose,
  ...extra,
});

// Leg geometry of both mannequins (metres): hip to knee, knee to ankle,
// ankle to sole; the knee cap and seat sit a little in front of / below
// the joint.
const THIGH = 0.42;
const SHIN = 0.42;
const SOLE = 0.1;
const KNEE_CAP = 0.05;
const SEAT = 0.1;
const STANDING = THIGH + SHIN + SOLE;

/** How far to lower the figure so its lowest point (a foot, a knee, or
 * the seat when sitting) is on the floor. Legs swing in the side view;
 * spreading them sideways shortens them by cos(out). */
export function floorOffset(joints: PoseJoints): number {
  const rad = Math.PI / 180;
  const j = joints as Record<string, Record<string, number>>;
  let lowest = 0;
  for (const s of ["L", "R"]) {
    const a = j[`hip${s}`].forward * rad;
    const b = j[`knee${s}`].bend * rad;
    const out = Math.cos(j[`hip${s}`].out * rad);
    const knee = THIGH * Math.cos(a) * out;
    const foot = knee + SHIN * Math.cos(a - b) * out;
    const seat =
      SEAT * Math.min(1, Math.max(0, (j[`hip${s}`].forward - 30) / 40));
    lowest = Math.max(lowest, knee + KNEE_CAP, foot + SOLE, seat);
  }
  return lowest - STANDING;
}

function build(pose: Patch, hands: Hands, bare = false): PoseJoints {
  const joints = neutralJoints() as Record<string, Record<string, number>>;
  const put = (p: Patch | null) => {
    for (const [id, v] of Object.entries(p ?? {})) Object.assign(joints[id], v);
  };
  if (!bare) {
    put(RELAXED);
    put(handShapePatches("L", hands.L ?? "relaxed"));
    put(handShapePatches("R", hands.R ?? "relaxed"));
  }
  put(pose);
  return joints as PoseJoints;
}

// ------------------------------------------------------------ library

const GUARD: Patch = {
  ...both({
    shoulderL: { raise: -5, forward: 45, twist: -35 },
    elbowL: { bend: 125 },
  }),
  hipL: { forward: 18, twist: -10 },
  kneeL: { bend: 20 },
  hipR: { forward: -10, twist: 15 },
  kneeR: { bend: 22 },
  head: { nod: 10 },
};
const SEATED: Patch = {
  ...both({
    hipL: { forward: 90 },
    kneeL: { bend: 90 },
    shoulderL: { raise: -12, forward: 35 },
    elbowL: { bend: 45 },
  }),
};
const SQUAT: Patch = {
  ...both({
    hipL: { forward: 105, out: 10 },
    kneeL: { bend: 130 },
    ankleL: { point: -25 },
    shoulderL: { raise: -10, forward: 80 },
    elbowL: { bend: 10 },
  }),
  spine: { bend: 35 },
  head: { nod: -20 },
};

/** Walking-type cycle: contact, passing, other contact, passing. */
function gait(o: {
  hip: number;
  back: number;
  knee: number;
  lift: number;
  arm: number;
  elbow: number;
  lean: number;
  air?: number;
  ankle?: number;
}): MotionFrame[] {
  const contact = (front: "L" | "R"): Patch => {
    const back = front === "L" ? "R" : "L";
    return {
      [`hip${front}`]: { forward: o.hip },
      [`knee${front}`]: { bend: o.knee },
      [`ankle${front}`]: { point: -10 },
      [`hip${back}`]: { forward: -o.back },
      [`knee${back}`]: { bend: o.knee + 10 },
      [`ankle${back}`]: { point: o.ankle ?? 20 },
      [`shoulder${front}`]: { raise: -18, forward: -o.arm },
      [`shoulder${back}`]: { raise: -18, forward: o.arm },
      [`elbow${front}`]: { bend: o.elbow * 0.6 },
      [`elbow${back}`]: { bend: o.elbow },
      spine: { bend: o.lean, twist: front === "L" ? -6 : 6 },
    } as Patch;
  };
  const passing = (stance: "L" | "R"): Patch => {
    const swing = stance === "L" ? "R" : "L";
    return {
      [`hip${stance}`]: { forward: 2 },
      [`knee${stance}`]: { bend: o.knee + 4 },
      [`hip${swing}`]: { forward: o.lift },
      [`knee${swing}`]: { bend: o.lift * 1.6 + 10 },
      [`ankle${swing}`]: { point: 5 },
      shoulderL: { raise: -18, forward: 4 },
      shoulderR: { raise: -18, forward: 4 },
      elbowL: { bend: o.elbow * 0.8 },
      elbowR: { bend: o.elbow * 0.8 },
      spine: { bend: o.lean },
    } as Patch;
  };
  return [
    f(0, contact("R")),
    f(0.25, passing("R"), o.air ? { air: o.air } : {}),
    f(0.5, contact("L")),
    f(0.75, passing("L"), o.air ? { air: o.air } : {}),
  ];
}
/** Gait frames with times scaled to a cycle length. */
const timed = (frames: MotionFrame[], cycle: number) =>
  frames.map((fr) => ({ ...fr, at: fr.at * cycle }));

export const MOTIONS: Motion[] = [
  // ------------------------------------------------------- standing
  {
    id: "stand",
    name: "Stand",
    kind: "pose",
    category: "Standing",
    note: "Relaxed, arms by the sides.",
    words: [
      "standing",
      "idle",
      "rest",
      "neutral",
      "relaxed",
      "default",
      "still",
    ],
    frames: [f(0, {})],
  },
  {
    id: "t-pose",
    name: "T-pose",
    kind: "pose",
    category: "Standing",
    note: "Arms straight out to the sides.",
    words: ["tpose", "t", "arms out", "airplane", "aeroplane", "cross"],
    frames: [
      f(
        0,
        both({ shoulderL: { raise: 56, forward: 0 }, elbowL: { bend: 0 } }),
        {
          hands: { L: "open", R: "open" },
        },
      ),
    ],
  },
  {
    id: "hands-on-hips",
    name: "Hands on hips",
    kind: "pose",
    category: "Standing",
    note: "Both hands on the hips, elbows out.",
    words: ["akimbo", "superhero", "power pose", "confident", "hero", "hips"],
    frames: [
      f(0, {
        ...both({
          shoulderL: { raise: 10, forward: -15, twist: -30 },
          elbowL: { bend: 95 },
          wristL: { bend: 20 },
        }),
        head: { nod: -5 },
      }),
    ],
  },
  {
    id: "arms-crossed",
    name: "Arms crossed",
    kind: "pose",
    category: "Standing",
    note: "Arms folded across the chest.",
    words: ["crossed arms", "fold", "folded", "waiting", "stern", "serious"],
    frames: [
      f(0, {
        ...both({
          shoulderL: { raise: -10, forward: 40, twist: -55 },
          elbowL: { bend: 120 },
        }),
        wristL: { bend: 10 },
      }),
    ],
  },
  {
    id: "thinking",
    name: "Thinking",
    kind: "pose",
    category: "Standing",
    note: "Hand to the chin.",
    words: ["think", "ponder", "wonder", "hmm", "chin", "thinker", "curious"],
    sided: true,
    frames: [
      f(0, {
        shoulderR: { raise: -10, forward: 45, twist: -35 },
        elbowR: { bend: 135 },
        wristR: { bend: -20, lift: 20 },
        shoulderL: { raise: -10, forward: 30, twist: -40 },
        elbowL: { bend: 95 },
        head: { nod: 8, tilt: -5 },
      }),
    ],
    hands: { R: "fist" },
  },
  {
    id: "boxing-guard",
    name: "Boxing guard",
    kind: "pose",
    category: "Sport and action",
    note: "Fists up, one foot forward.",
    words: [
      "boxing",
      "boxer",
      "guard",
      "fight",
      "fighting",
      "stance",
      "martial",
      "karate",
    ],
    frames: [f(0, GUARD)],
    hands: { L: "fist", R: "fist" },
  },
  {
    id: "lunge",
    name: "Lunge",
    kind: "pose",
    category: "Dance and exercise",
    note: "One long step forward, back knee low.",
    words: ["lunging", "step", "stretch legs", "fencing"],
    sided: true,
    frames: [
      f(0, {
        hipR: { forward: 75 },
        kneeR: { bend: 75 },
        hipL: { forward: -25 },
        kneeL: { bend: 70 },
        ankleL: { point: 30 },
        ...both({
          shoulderL: { raise: 10, forward: -15, twist: -30 },
          elbowL: { bend: 95 },
        }),
      }),
    ],
  },
  {
    id: "tree-pose",
    name: "Tree pose",
    kind: "pose",
    category: "Dance and exercise",
    note: "Yoga: standing on one leg, arms overhead.",
    words: ["yoga", "tree", "balance", "one leg", "flamingo"],
    sided: true,
    frames: [
      f(0, {
        hipR: { forward: 25, out: 55, twist: 40 },
        kneeR: { bend: 130 },
        ...both({
          shoulderL: { raise: 150, forward: 10 },
          elbowL: { bend: 25 },
        }),
      }),
    ],
    hands: { L: "open", R: "open" },
  },
  {
    id: "hug",
    name: "Open arms",
    kind: "pose",
    category: "Gestures",
    note: "Arms open in front, ready to hug.",
    words: ["hug", "hugging", "embrace", "cuddle", "welcome", "open arms"],
    frames: [
      f(
        0,
        both({
          shoulderL: { raise: -12, forward: 62, twist: -20 },
          elbowL: { bend: 45 },
        }),
        {
          hands: { L: "open", R: "open" },
        },
      ),
    ],
  },
  {
    id: "sad",
    name: "Sad",
    kind: "pose",
    category: "Standing",
    note: "Head down, shoulders slumped.",
    words: [
      "upset",
      "unhappy",
      "depressed",
      "down",
      "gloomy",
      "sorrow",
      "lonely",
      "disappointed",
    ],
    frames: [
      f(0, {
        head: { nod: 35, tilt: 5 },
        spine: { bend: 15 },
        ...both({
          shoulderL: { raise: -22, forward: 12, twist: -15 },
          elbowL: { bend: 8 },
        }),
      }),
    ],
  },
  {
    id: "tired",
    name: "Tired",
    kind: "pose",
    category: "Standing",
    note: "Drooping, arms hanging, weight on one leg.",
    words: ["exhausted", "sleepy", "weary", "worn out", "fatigued", "bored"],
    frames: [
      f(0, {
        head: { nod: 25, tilt: -12 },
        spine: { bend: 20, side: 6 },
        ...both({
          shoulderL: { raise: -22, forward: 15 },
          elbowL: { bend: 5 },
        }),
        kneeR: { bend: 12 },
        hipR: { forward: 6 },
      }),
    ],
  },
  {
    id: "angry",
    name: "Angry",
    kind: "pose",
    category: "Standing",
    note: "Fists clenched, leaning in.",
    words: [
      "mad",
      "furious",
      "rage",
      "cross",
      "annoyed",
      "frustrated",
      "fists",
    ],
    hands: { L: "fist", R: "fist" },
    frames: [
      f(0, {
        head: { nod: 12 },
        spine: { bend: 8 },
        ...both({
          shoulderL: { raise: -5, forward: 10, twist: -10 },
          elbowL: { bend: 40 },
        }),
        ...both({ hipL: { out: 8 } }),
      }),
    ],
  },
  {
    id: "read",
    name: "Read",
    kind: "pose",
    category: "Everyday",
    note: "Holding a book up, head bowed to it.",
    words: [
      "reading",
      "book",
      "newspaper",
      "study",
      "magazine",
      "tablet",
      "menu",
    ],
    hands: { L: "open", R: "open" },
    frames: [
      f(0, {
        ...both({
          shoulderL: { raise: -14, forward: 22, twist: -10 },
          elbowL: { bend: 78 },
          wristL: { twist: 50 },
        }),
        head: { nod: 30 },
      }),
    ],
  },
  // --------------------------------------------- sitting and kneeling
  {
    id: "sit",
    name: "Sit",
    kind: "pose",
    category: "Sitting and kneeling",
    note: "Seated, as on a chair (the chair isn't drawn).",
    words: ["sitting", "seated", "chair", "seat", "bench"],
    frames: [f(0, SEATED)],
  },
  {
    id: "sit-floor",
    name: "Sit on the floor",
    kind: "pose",
    category: "Sitting and kneeling",
    note: "Legs out in front, leaning back on the hands.",
    words: ["floor", "ground", "sitting on the floor", "beach", "relax"],
    frames: [
      f(0, {
        ...both({
          hipL: { forward: 85, out: 5 },
          kneeL: { bend: 15 },
          shoulderL: { raise: -5, forward: -40 },
          elbowL: { bend: 0 },
          wristL: { bend: -50 },
        }),
        spine: { bend: -15 },
      }),
    ],
    hands: { L: "open", R: "open" },
  },
  {
    id: "cross-legged",
    name: "Cross-legged",
    kind: "pose",
    category: "Sitting and kneeling",
    note: "Sitting on the floor, legs crossed.",
    words: ["meditate", "meditation", "lotus", "crossed legs", "zen", "calm"],
    frames: [
      f(0, {
        ...both({
          hipL: { forward: 80, out: 50, twist: 40 },
          kneeL: { bend: 135 },
          shoulderL: { raise: -10, forward: 40 },
          elbowL: { bend: 30 },
        }),
        spine: { bend: 5 },
      }),
    ],
  },
  {
    id: "kneel",
    name: "Kneel",
    kind: "pose",
    category: "Sitting and kneeling",
    note: "Upright on both knees.",
    words: ["kneeling", "knees", "on knees", "knee"],
    frames: [f(0, both({ kneeL: { bend: 90 }, ankleL: { point: 40 } }))],
  },
  {
    id: "one-knee",
    name: "On one knee",
    kind: "pose",
    category: "Sitting and kneeling",
    note: "One knee down, the other foot forward.",
    words: [
      "propose",
      "proposal",
      "marriage",
      "take a knee",
      "genuflect",
      "knight",
    ],
    sided: true,
    frames: [
      f(0, {
        hipL: { forward: 0 },
        kneeL: { bend: 90 },
        ankleL: { point: 40 },
        hipR: { forward: 90 },
        kneeR: { bend: 90 },
        shoulderR: { raise: -10, forward: 40 },
        elbowR: { bend: 70 },
      }),
    ],
  },
  {
    id: "squat",
    name: "Squat",
    kind: "pose",
    category: "Sitting and kneeling",
    note: "Deep squat, arms forward for balance.",
    words: ["squatting", "crouch", "crouching", "hunker", "low"],
    frames: [f(0, SQUAT)],
  },
  // ------------------------------------------------------- gestures
  {
    id: "point",
    name: "Point",
    kind: "pose",
    category: "Gestures",
    note: "Pointing straight ahead.",
    words: ["pointing", "point at", "show", "there", "that way", "direct"],
    sided: true,
    frames: [
      f(0, {
        shoulderR: { raise: -5, forward: 85 },
        elbowR: { bend: 5 },
        head: { turn: -5 },
      }),
    ],
    hands: { R: "point" },
  },
  {
    id: "salute",
    name: "Salute",
    kind: "pose",
    category: "Gestures",
    note: "Hand to the brow.",
    words: ["saluting", "military", "soldier", "attention", "army", "respect"],
    sided: true,
    frames: [
      f(0, {
        shoulderR: { raise: 80, forward: 30, twist: 30 },
        elbowR: { bend: 142 },
        wristR: { lift: -10 },
      }),
    ],
    hands: { R: "open" },
  },
  {
    id: "hands-up",
    name: "Hands up",
    kind: "pose",
    category: "Gestures",
    note: "Both hands raised, palms forward.",
    words: [
      "surrender",
      "hands up",
      "dont shoot",
      "arrest",
      "freeze",
      "stick up",
    ],
    frames: [
      f(
        0,
        both({
          shoulderL: { raise: 80, forward: 10, twist: 70 },
          elbowL: { bend: 85 },
        }),
      ),
    ],
    hands: { L: "open", R: "open" },
  },
  {
    id: "victory",
    name: "Victory",
    kind: "pose",
    category: "Gestures",
    note: "Both fists high in a V.",
    words: [
      "win",
      "winner",
      "champion",
      "triumph",
      "yay",
      "hooray",
      "cheer",
      "arms up",
    ],
    frames: [
      f(0, {
        ...both({ shoulderL: { raise: 140, forward: 5 }, elbowL: { bend: 5 } }),
        head: { nod: -15 },
      }),
    ],
    hands: { L: "fist", R: "fist" },
  },
  {
    id: "shrug",
    name: "Shrug",
    kind: "pose",
    category: "Gestures",
    note: "Palms up: “who knows?”",
    words: [
      "dunno",
      "dont know",
      "whatever",
      "confused",
      "idk",
      "unsure",
      "no idea",
    ],
    frames: [
      f(0, {
        ...both({
          shoulderL: { raise: -5, forward: 15, twist: 55 },
          elbowL: { bend: 90 },
        }),
        head: { tilt: 10 },
      }),
    ],
    hands: { L: "open", R: "open" },
  },
  {
    id: "phone-call",
    name: "On the phone",
    kind: "pose",
    category: "Everyday",
    note: "Hand to the ear.",
    words: [
      "phone",
      "call",
      "calling",
      "telephone",
      "talk",
      "mobile",
      "cellphone",
    ],
    sided: true,
    frames: [
      f(0, {
        shoulderR: { raise: 30, forward: 30, twist: 60 },
        elbowR: { bend: 145 },
        head: { tilt: -10 },
      }),
    ],
    hands: { R: "fist" },
  },
  {
    id: "pray",
    name: "Hands together",
    kind: "pose",
    category: "Gestures",
    note: "Palms together in front of the chest.",
    words: [
      "pray",
      "praying",
      "prayer",
      "namaste",
      "please",
      "thank you",
      "beg",
    ],
    frames: [
      f(0, {
        ...both({
          shoulderL: { raise: -10, forward: 30, twist: -45 },
          elbowL: { bend: 110 },
          wristL: { bend: -40 },
        }),
        head: { nod: 15 },
      }),
    ],
    hands: { L: "open", R: "open" },
  },

  // ------------------------------------------------- getting around
  {
    id: "walk",
    name: "Walk",
    kind: "move",
    category: "Getting around",
    note: "Two strides forward.",
    words: ["walking", "stroll", "step", "steps", "go", "pace", "amble"],
    cycle: 1.1,
    repeat: 4,
    travel: 1.3,
    frames: timed(
      gait({
        hip: 25,
        back: 15,
        knee: 5,
        lift: 25,
        arm: 20,
        elbow: 20,
        lean: 3,
      }),
      1.1,
    ),
  },
  {
    id: "run",
    name: "Run",
    kind: "move",
    category: "Getting around",
    note: "Running strides, arms pumping.",
    words: ["running", "sprint", "sprinting", "dash", "race", "rush", "flee"],
    cycle: 0.7,
    repeat: 6,
    travel: 1.4,
    frames: timed(
      gait({
        hip: 40,
        back: 25,
        knee: 25,
        lift: 60,
        arm: 45,
        elbow: 90,
        lean: 12,
        air: 0.06,
        ankle: 35,
      }),
      0.7,
    ),
  },
  {
    id: "jog",
    name: "Jog",
    kind: "move",
    category: "Getting around",
    note: "An easy run.",
    words: ["jogging", "trot", "light run"],
    cycle: 0.8,
    repeat: 5,
    travel: 1.1,
    frames: timed(
      gait({
        hip: 30,
        back: 18,
        knee: 18,
        lift: 45,
        arm: 30,
        elbow: 85,
        lean: 6,
        air: 0.03,
      }),
      0.8,
    ),
  },
  {
    id: "march",
    name: "March",
    kind: "move",
    category: "Getting around",
    note: "Knees high, arms swinging.",
    words: ["marching", "parade", "high knees", "soldier"],
    cycle: 1.2,
    repeat: 2,
    travel: 0.9,
    frames: timed(
      gait({
        hip: 15,
        back: 5,
        knee: 5,
        lift: 65,
        arm: 45,
        elbow: 10,
        lean: 0,
      }),
      1.2,
    ),
  },
  {
    id: "tiptoe",
    name: "Tiptoe",
    kind: "move",
    category: "Getting around",
    note: "Sneaking forward, crouched.",
    words: [
      "sneak",
      "sneaking",
      "creep",
      "creeping",
      "tip toe",
      "stealth",
      "quiet",
    ],
    cycle: 1.6,
    repeat: 2,
    travel: 0.8,
    frames: timed(
      gait({
        hip: 30,
        back: 10,
        knee: 30,
        lift: 45,
        arm: 25,
        elbow: 70,
        lean: 18,
        ankle: 35,
      }),
      1.6,
    ).map((fr) => ({
      ...fr,
      pose: {
        ...fr.pose,
        ...both({ shoulderL: { raise: 5, forward: 30 }, elbowL: { bend: 80 } }),
      },
    })),
  },
  {
    id: "turn-around",
    name: "Turn around",
    kind: "move",
    category: "Getting around",
    note: "A half turn on the spot.",
    words: [
      "turn",
      "turning",
      "about face",
      "spin round",
      "face back",
      "rotate",
    ],
    frames: [
      f(0, {}),
      f(0.5, { hipR: { forward: 15 }, kneeR: { bend: 30 } }, { turn: 90 }),
      f(1, {}, { turn: 180 }),
    ],
  },
  {
    id: "climb",
    name: "Climb",
    kind: "move",
    category: "Getting around",
    note: "Climbing a ladder, rising as it goes.",
    words: ["climbing", "ladder", "scale", "climb up", "rope"],
    cycle: 1.2,
    repeat: 2,
    rise: 0.3,
    frames: [
      f(
        0,
        {
          shoulderR: { raise: 20, forward: 150 },
          elbowR: { bend: 20 },
          shoulderL: { raise: 15, forward: 110 },
          elbowL: { bend: 80 },
          hipL: { forward: 70 },
          kneeL: { bend: 90 },
        },
        { air: 0, hands: { L: "fist", R: "fist" } },
      ),
      f(
        0.6,
        {
          shoulderL: { raise: 20, forward: 150 },
          elbowL: { bend: 20 },
          shoulderR: { raise: 15, forward: 110 },
          elbowR: { bend: 80 },
          hipR: { forward: 70 },
          kneeR: { bend: 90 },
        },
        { air: 0.15, hands: { L: "fist", R: "fist" } },
      ),
    ],
  },
  // -------------------------------------------------- sport and action
  {
    id: "jump",
    name: "Jump",
    kind: "move",
    category: "Sport and action",
    note: "Crouch, spring up, land.",
    words: ["jumping", "leap", "leaping", "spring", "bounce", "hop up"],
    frames: [
      f(0, {}),
      f(0.35, {
        ...both({
          hipL: { forward: 60 },
          kneeL: { bend: 95 },
          ankleL: { point: -20 },
          shoulderL: { raise: -15, forward: -45 },
        }),
        spine: { bend: 30 },
      }),
      f(
        0.55,
        {
          ...both({
            shoulderL: { raise: 10, forward: 150 },
            ankleL: { point: 35 },
          }),
        },
        { air: 0.15 },
      ),
      f(
        0.8,
        {
          ...both({
            hipL: { forward: 35 },
            kneeL: { bend: 50 },
            shoulderL: { raise: 20, forward: 140 },
          }),
        },
        { air: 0.45 },
      ),
      f(1.05, {
        ...both({
          hipL: { forward: 50 },
          kneeL: { bend: 80 },
          ankleL: { point: -15 },
          shoulderL: { raise: 0, forward: 50 },
        }),
        spine: { bend: 20 },
      }),
      f(1.5, {}),
    ],
  },
  {
    id: "jumping-jacks",
    name: "Jumping jacks",
    kind: "move",
    category: "Dance and exercise",
    note: "Arms and legs out and in.",
    words: [
      "star jumps",
      "jacks",
      "jumping jack",
      "warm up",
      "workout",
      "exercise",
    ],
    cycle: 0.8,
    repeat: 4,
    frames: [
      f(0, {}),
      f(0.2, {}, { air: 0.08 }),
      f(
        0.4,
        {
          ...both({
            hipL: { out: 25 },
            shoulderL: { raise: 145, forward: 5 },
            elbowL: { bend: 10 },
          }),
        },
        { hands: { L: "open", R: "open" } },
      ),
      f(0.6, both({ hipL: { out: 10 }, shoulderL: { raise: 60 } }), {
        air: 0.08,
      }),
    ],
  },
  {
    id: "kick",
    name: "Kick",
    kind: "move",
    category: "Sport and action",
    note: "A front kick: lift the knee, snap the leg out, back down.",
    words: [
      "kicking",
      "front kick",
      "football",
      "soccer",
      "karate kick",
      "boot",
    ],
    sided: true,
    hands: { L: "fist", R: "fist" },
    frames: [
      f(0, GUARD),
      f(0.3, {
        ...GUARD,
        hipR: { forward: 85 },
        kneeR: { bend: 110 },
        hipL: { forward: 0 },
        kneeL: { bend: 15 },
      }),
      f(0.5, {
        ...GUARD,
        hipR: { forward: 90 },
        kneeR: { bend: 5 },
        ankleR: { point: -15 },
        hipL: { forward: 0 },
        kneeL: { bend: 10 },
        spine: { bend: -12 },
      }),
      f(0.75, {
        ...GUARD,
        hipR: { forward: 80 },
        kneeR: { bend: 110 },
        hipL: { forward: 0 },
        kneeL: { bend: 15 },
      }),
      f(1.1, GUARD),
    ],
  },
  {
    id: "punch",
    name: "Punch",
    kind: "move",
    category: "Sport and action",
    note: "Jab, then a cross, from a boxing guard.",
    words: ["punching", "jab", "hit", "strike", "box", "cross", "one two"],
    sided: true,
    hands: { L: "fist", R: "fist" },
    frames: [
      f(0, GUARD),
      f(0.2, {
        ...GUARD,
        shoulderL: { raise: -5, forward: 85, twist: -20 },
        elbowL: { bend: 5 },
        spine: { twist: -10 },
      }),
      f(0.4, GUARD),
      f(0.65, {
        ...GUARD,
        shoulderR: { raise: -5, forward: 88, twist: -20 },
        elbowR: { bend: 5 },
        spine: { twist: 25 },
        hipR: { forward: -10, twist: 35 },
      }),
      f(1, GUARD),
    ],
  },
  {
    id: "throw",
    name: "Throw",
    kind: "move",
    category: "Sport and action",
    note: "Overarm throw: wind up, step, release, follow through.",
    words: [
      "throwing",
      "pitch",
      "toss",
      "hurl",
      "lob",
      "fling",
      "baseball",
      "ball",
    ],
    sided: true,
    frames: [
      f(0, {}),
      f(0.5, {
        shoulderR: { raise: 85, forward: -30, twist: 60 },
        elbowR: { bend: 95 },
        shoulderL: { raise: 0, forward: 70 },
        elbowL: { bend: 20 },
        spine: { twist: -30, bend: -5 },
        hipL: { forward: 25 },
        kneeL: { bend: 10 },
        hipR: { forward: -10 },
        kneeR: { bend: 20 },
        head: { turn: 25 },
      }),
      f(
        0.72,
        {
          shoulderR: { raise: 40, forward: 120 },
          elbowR: { bend: 20 },
          shoulderL: { raise: -15, forward: -20 },
          elbowL: { bend: 40 },
          spine: { twist: 25, bend: 15 },
          hipL: { forward: 30 },
          kneeL: { bend: 25 },
          hipR: { forward: -20 },
          kneeR: { bend: 25 },
        },
        { hands: { R: "open" } },
      ),
      f(
        0.95,
        {
          shoulderR: { raise: -10, forward: 55, twist: -20 },
          elbowR: { bend: 25 },
          spine: { twist: 30, bend: 30 },
          hipL: { forward: 35 },
          kneeL: { bend: 35 },
          hipR: { forward: -15 },
          kneeR: { bend: 30 },
          ankleR: { point: 30 },
        },
        { hands: { R: "open" } },
      ),
      f(1.6, {}),
    ],
    hands: { R: "fist" },
  },
  {
    id: "catch",
    name: "Catch",
    kind: "move",
    category: "Sport and action",
    note: "Reach out and pull the catch in to the chest.",
    words: ["catching", "grab", "receive", "ball"],
    frames: [
      f(0, {}),
      f(
        0.4,
        both({ shoulderL: { raise: 5, forward: 85 }, elbowL: { bend: 15 } }),
        { hands: { L: "open", R: "open" } },
      ),
      f(0.65, {
        ...both({
          shoulderL: { raise: -5, forward: 50, twist: -30 },
          elbowL: { bend: 100 },
        }),
        spine: { bend: 10 },
        ...both({ kneeL: { bend: 15 }, hipL: { forward: 10 } }),
      }),
      f(1.2, {}),
    ],
  },
  {
    id: "swing",
    name: "Bat swing",
    kind: "move",
    category: "Sport and action",
    note: "Two-handed swing, like a bat or a club.",
    words: [
      "bat",
      "swinging",
      "golf",
      "club",
      "hit ball",
      "baseball swing",
      "cricket",
    ],
    sided: true,
    hands: { L: "fist", R: "fist" },
    frames: [
      f(0, {
        ...both({
          shoulderL: { raise: -5, forward: 40, twist: -40 },
          elbowL: { bend: 60 },
        }),
        ...both({ hipL: { out: 12 }, kneeL: { bend: 15 } }),
      }),
      f(0.5, {
        shoulderR: { raise: 60, forward: 20, twist: 40 },
        elbowR: { bend: 100 },
        shoulderL: { raise: -5, forward: 60, twist: -60 },
        elbowL: { bend: 30 },
        spine: { twist: -35 },
        ...both({ hipL: { out: 12 }, kneeL: { bend: 15 } }),
        head: { turn: 30 },
      }),
      f(0.75, {
        shoulderL: { raise: 40, forward: 40, twist: 30 },
        elbowL: { bend: 90 },
        shoulderR: { raise: 0, forward: 70, twist: -40 },
        elbowR: { bend: 20 },
        spine: { twist: 40 },
        ...both({ hipL: { out: 12 }, kneeL: { bend: 15 } }),
        ankleR: { point: 25 },
      }),
      f(1.3, {}),
    ],
  },
  {
    id: "hop",
    name: "Hop",
    kind: "move",
    category: "Sport and action",
    note: "Hopping on one leg.",
    words: ["hopping", "one leg", "single leg", "hopscotch"],
    sided: true,
    cycle: 0.6,
    repeat: 4,
    travel: 0.3,
    frames: [
      f(0, {
        hipL: { forward: 40 },
        kneeL: { bend: 85 },
        kneeR: { bend: 25 },
        hipR: { forward: 15 },
      }),
      f(
        0.3,
        {
          hipL: { forward: 40 },
          kneeL: { bend: 85 },
          ankleR: { point: 30 },
          ...both({ shoulderL: { raise: 25 } }),
        },
        { air: 0.14 },
      ),
    ],
  },
  {
    id: "skip",
    name: "Skip",
    kind: "move",
    category: "Getting around",
    note: "Skipping along: step, hop, knee up.",
    words: ["skipping", "skip along", "happy walk", "bounce"],
    cycle: 0.9,
    repeat: 3,
    travel: 1.2,
    frames: timed(
      gait({
        hip: 20,
        back: 10,
        knee: 10,
        lift: 75,
        arm: 40,
        elbow: 70,
        lean: 2,
        air: 0.12,
        ankle: 30,
      }),
      0.9,
    ),
  },
  {
    id: "flap",
    name: "Flap arms",
    kind: "move",
    category: "Gestures",
    note: "Flapping arms like wings.",
    words: ["fly", "flying", "bird", "wings", "flapping", "chicken", "eagle"],
    hands: { L: "open", R: "open" },
    cycle: 0.6,
    repeat: 4,
    frames: [
      f(
        0,
        both({ shoulderL: { raise: 75, forward: 0 }, elbowL: { bend: 10 } }),
        { air: 0 },
      ),
      f(
        0.3,
        both({ shoulderL: { raise: -10, forward: 5 }, elbowL: { bend: 20 } }),
        { air: 0 },
      ),
    ],
  },
  {
    id: "laugh",
    name: "Laugh",
    kind: "move",
    category: "Gestures",
    note: "Head back, shoulders shaking, hand on the belly.",
    words: [
      "laughing",
      "lol",
      "funny",
      "giggle",
      "chuckle",
      "happy",
      "joy",
      "haha",
    ],
    sided: true,
    cycle: 0.4,
    repeat: 4,
    frames: [
      f(0, {
        head: { nod: -25 },
        spine: { bend: -8 },
        shoulderR: { raise: -10, forward: 25, twist: -40 },
        elbowR: { bend: 90 },
        ...both({ hipL: { out: 4 } }),
      }),
      f(0.2, {
        head: { nod: -15 },
        spine: { bend: 4 },
        shoulderR: { raise: -10, forward: 25, twist: -40 },
        elbowR: { bend: 90 },
        shoulderL: { raise: -14, forward: 8 },
      }),
    ],
  },
  {
    id: "cry",
    name: "Cry",
    kind: "move",
    category: "Gestures",
    note: "Face in the hands, shoulders shaking.",
    words: [
      "crying",
      "weep",
      "weeping",
      "sob",
      "sobbing",
      "tears",
      "hide face",
      "ashamed",
      "facepalm",
    ],
    hands: { L: "open", R: "open" },
    cycle: 0.6,
    repeat: 3,
    frames: [
      f(0, {
        ...both({
          shoulderL: { raise: 0, forward: 50, twist: -40 },
          elbowL: { bend: 140 },
          wristL: { bend: -20 },
        }),
        head: { nod: 30 },
        spine: { bend: 15 },
      }),
      f(0.3, {
        ...both({
          shoulderL: { raise: 5, forward: 52, twist: -40 },
          elbowL: { bend: 138 },
          wristL: { bend: -20 },
        }),
        head: { nod: 25 },
        spine: { bend: 10 },
      }),
    ],
  },
  // ------------------------------------------------------ everyday
  {
    id: "wave",
    name: "Wave",
    kind: "move",
    category: "Gestures",
    note: "Waving hello or goodbye.",
    words: [
      "waving",
      "hello",
      "hi",
      "bye",
      "goodbye",
      "greet",
      "greeting",
      "hey",
    ],
    sided: true,
    hands: { R: "open" },
    frames: [
      f(0, {}),
      f(0.35, {
        shoulderR: { raise: 110, forward: 20, twist: 30 },
        elbowR: { bend: 50 },
        wristR: { lift: 15 },
      }),
      f(0.6, {
        shoulderR: { raise: 110, forward: 20, twist: 30 },
        elbowR: { bend: 80 },
        wristR: { lift: -20 },
      }),
      f(0.85, {
        shoulderR: { raise: 110, forward: 20, twist: 30 },
        elbowR: { bend: 50 },
        wristR: { lift: 15 },
      }),
      f(1.1, {
        shoulderR: { raise: 110, forward: 20, twist: 30 },
        elbowR: { bend: 80 },
        wristR: { lift: -20 },
      }),
      f(1.35, {
        shoulderR: { raise: 110, forward: 20, twist: 30 },
        elbowR: { bend: 50 },
        wristR: { lift: 15 },
      }),
      f(1.8, {}),
    ],
  },
  {
    id: "clap",
    name: "Clap",
    kind: "move",
    category: "Gestures",
    note: "Clapping in front of the chest.",
    words: ["clapping", "applause", "applaud", "bravo", "well done"],
    hands: { L: "open", R: "open" },
    cycle: 0.5,
    repeat: 4,
    frames: [
      f(
        0,
        both({
          shoulderL: { raise: 20, forward: 55, twist: -20 },
          elbowL: { bend: 85 },
        }),
      ),
      f(
        0.25,
        both({
          shoulderL: { raise: -5, forward: 50, twist: -40 },
          elbowL: { bend: 75 },
        }),
      ),
    ],
  },
  {
    id: "nod",
    name: "Nod yes",
    kind: "move",
    category: "Gestures",
    note: "Nodding the head.",
    words: ["nod", "nodding", "yes", "agree", "ok", "okay"],
    cycle: 0.6,
    repeat: 3,
    frames: [f(0, { head: { nod: -5 } }), f(0.3, { head: { nod: 25 } })],
  },
  {
    id: "shake-head",
    name: "Shake head no",
    kind: "move",
    category: "Gestures",
    note: "Shaking the head.",
    words: ["no", "shake", "shaking", "disagree", "nope", "refuse"],
    cycle: 0.6,
    repeat: 3,
    frames: [f(0, { head: { turn: -30 } }), f(0.3, { head: { turn: 30 } })],
  },
  {
    id: "look-around",
    name: "Look around",
    kind: "move",
    category: "Everyday",
    note: "Looking left, then right.",
    words: ["looking", "look", "search", "scan", "watch", "lost"],
    frames: [
      f(0, {}),
      f(0.7, { head: { turn: 60, nod: -5 }, spine: { twist: 15 } }),
      f(1.4, { head: { turn: 60, nod: -5 }, spine: { twist: 15 } }),
      f(2.2, { head: { turn: -60, nod: -5 }, spine: { twist: -15 } }),
      f(2.9, { head: { turn: -60, nod: -5 }, spine: { twist: -15 } }),
      f(3.5, {}),
    ],
  },
  {
    id: "bow",
    name: "Bow",
    kind: "move",
    category: "Gestures",
    note: "A bow from the waist.",
    words: ["bowing", "greet", "thank", "respect", "curtsy"],
    frames: [
      f(0, {}),
      f(0.6, {
        spine: { bend: 45 },
        head: { nod: 30 },
        ...both({
          shoulderL: { raise: -18, forward: 30 },
        }),
      }),
      f(1.2, {
        spine: { bend: 45 },
        head: { nod: 30 },
        ...both({
          shoulderL: { raise: -18, forward: 30 },
        }),
      }),
      f(1.8, {}),
    ],
  },
  {
    id: "eat",
    name: "Eat",
    kind: "move",
    category: "Everyday",
    note: "Taking bites, hand to mouth.",
    words: [
      "eating",
      "food",
      "meal",
      "dinner",
      "lunch",
      "breakfast",
      "bite",
      "fork",
      "spoon",
      "snack",
      "hungry",
    ],
    sided: true,
    cycle: 1.6,
    repeat: 2,
    hands: { R: "fist" },
    frames: [
      f(0, {
        shoulderR: { raise: -15, forward: 30 },
        elbowR: { bend: 95 },
        shoulderL: { raise: -15, forward: 25 },
        elbowL: { bend: 85 },
        head: { nod: 15 },
      }),
      f(0.6, {
        shoulderR: { raise: -5, forward: 58, twist: -35 },
        elbowR: { bend: 143 },
        wristR: { bend: -10 },
        shoulderL: { raise: -15, forward: 25 },
        elbowL: { bend: 85 },
        head: { nod: 5 },
      }),
      f(1.0, {
        shoulderR: { raise: -5, forward: 58, twist: -35 },
        elbowR: { bend: 143 },
        wristR: { bend: -10 },
        shoulderL: { raise: -15, forward: 25 },
        elbowL: { bend: 85 },
        head: { nod: 5 },
      }),
    ],
  },
  {
    id: "drink",
    name: "Drink",
    kind: "move",
    category: "Everyday",
    note: "Raise a cup, sip, lower it.",
    words: [
      "drinking",
      "sip",
      "cup",
      "glass",
      "coffee",
      "tea",
      "water",
      "beer",
      "thirsty",
      "toast",
    ],
    sided: true,
    hands: { R: "fist" },
    frames: [
      f(0, { shoulderR: { raise: -15, forward: 25 }, elbowR: { bend: 90 } }),
      f(0.7, {
        shoulderR: { raise: 5, forward: 55, twist: -30 },
        elbowR: { bend: 130 },
        wristR: { bend: 15 },
        head: { nod: -20 },
      }),
      f(1.6, {
        shoulderR: { raise: 10, forward: 60, twist: -30 },
        elbowR: { bend: 125 },
        wristR: { bend: 30 },
        head: { nod: -30 },
      }),
      f(2.3, { shoulderR: { raise: -15, forward: 25 }, elbowR: { bend: 90 } }),
    ],
  },
  {
    id: "sit-down",
    name: "Sit down",
    kind: "move",
    category: "Sitting and kneeling",
    note: "From standing to seated (on an unseen chair).",
    words: ["sitting down", "take a seat", "be seated", "lower"],
    frames: [
      f(0, {}),
      f(0.7, {
        ...SEATED,
        ...both({ hipL: { forward: 70 }, kneeL: { bend: 70 } }),
        spine: { bend: 30 },
      }),
      f(1.4, SEATED),
    ],
  },
  {
    id: "stand-up",
    name: "Stand up",
    kind: "move",
    category: "Sitting and kneeling",
    note: "From seated to standing.",
    words: ["get up", "rise", "standing up", "arise"],
    frames: [
      f(0, SEATED),
      f(0.6, {
        ...SEATED,
        spine: { bend: 35 },
        ...both({ shoulderL: { raise: -10, forward: 50 } }),
      }),
      f(1.0, {
        ...both({ hipL: { forward: 50 }, kneeL: { bend: 55 } }),
        spine: { bend: 25 },
      }),
      f(1.6, {}),
    ],
  },
  {
    id: "pick-up",
    name: "Pick up",
    kind: "move",
    category: "Everyday",
    note: "Bend down, take something, stand.",
    words: [
      "picking up",
      "lift",
      "grab",
      "take",
      "get",
      "collect",
      "reach down",
    ],
    frames: [
      f(0, {}),
      f(
        0.8,
        {
          ...SQUAT,
          ...both({
            shoulderL: { raise: -10, forward: 75 },
            elbowL: { bend: 15 },
          }),
          spine: { bend: 40 },
          head: { nod: 10 },
        },
        { hands: { L: "open", R: "open" } },
      ),
      f(
        1.2,
        {
          ...SQUAT,
          ...both({
            shoulderL: { raise: -10, forward: 60, twist: -20 },
            elbowL: { bend: 50 },
          }),
          spine: { bend: 35 },
        },
        { hands: { L: "fist", R: "fist" } },
      ),
      f(
        2,
        both({
          shoulderL: { raise: -10, forward: 35, twist: -20 },
          elbowL: { bend: 80 },
        }),
        {
          hands: { L: "fist", R: "fist" },
        },
      ),
    ],
  },
  {
    id: "push",
    name: "Push",
    kind: "move",
    category: "Everyday",
    note: "Leaning into a push with both hands.",
    words: ["pushing", "shove", "press", "door"],
    hands: { L: "open", R: "open" },
    frames: [
      f(0, {}),
      f(0.5, {
        ...both({
          shoulderL: { raise: -5, forward: 70 },
          elbowL: { bend: 110 },
          wristL: { bend: -55 },
        }),
        hipL: { forward: 30 },
        kneeL: { bend: 30 },
        hipR: { forward: -20 },
        kneeR: { bend: 10 },
        spine: { bend: 15 },
      }),
      f(1.2, {
        ...both({
          shoulderL: { raise: -5, forward: 85 },
          elbowL: { bend: 10 },
          wristL: { bend: -55 },
        }),
        hipL: { forward: 35 },
        kneeL: { bend: 35 },
        hipR: { forward: -25 },
        kneeR: { bend: 5 },
        ankleR: { point: 20 },
        spine: { bend: 20 },
      }),
      f(1.8, {}),
    ],
  },
  {
    id: "pull",
    name: "Pull",
    kind: "move",
    category: "Everyday",
    note: "Pulling a rope towards the body.",
    words: ["pulling", "tug", "drag", "rope", "haul", "tug of war"],
    hands: { L: "fist", R: "fist" },
    frames: [
      f(0, {
        ...both({ shoulderL: { raise: -5, forward: 80 }, elbowL: { bend: 5 } }),
        hipL: { forward: 25 },
        kneeL: { bend: 20 },
        spine: { bend: 15 },
      }),
      f(0.8, {
        ...both({
          shoulderL: { raise: -10, forward: 20, twist: -10 },
          elbowL: { bend: 110 },
        }),
        hipL: { forward: 20 },
        kneeL: { bend: 10 },
        hipR: { forward: -5 },
        kneeR: { bend: 35 },
        spine: { bend: -15 },
      }),
      f(1.4, {
        ...both({ shoulderL: { raise: -5, forward: 80 }, elbowL: { bend: 5 } }),
        hipL: { forward: 25 },
        kneeL: { bend: 20 },
        spine: { bend: 15 },
      }),
    ],
  },
  {
    id: "typing",
    name: "Typing",
    kind: "move",
    category: "Everyday",
    note: "Hands on a keyboard, fingers tapping.",
    words: [
      "type",
      "keyboard",
      "computer",
      "laptop",
      "work",
      "office",
      "piano",
    ],
    cycle: 0.4,
    repeat: 5,
    frames: [
      f(0, {
        ...both({
          shoulderL: { raise: -15, forward: 25, twist: -15 },
          elbowL: { bend: 90 },
          wristL: { twist: -60 },
        }),
        head: { nod: 15 },
        index1L: { curl: 40, spread: 0 },
        middle1R: { curl: 40, spread: 0 },
        index1R: { curl: 10, spread: 0 },
      }),
      f(0.2, {
        ...both({
          shoulderL: { raise: -15, forward: 25, twist: -15 },
          elbowL: { bend: 90 },
          wristL: { twist: -60 },
        }),
        head: { nod: 15 },
        index1R: { curl: 40, spread: 0 },
        ring1L: { curl: 40, spread: 0 },
        index1L: { curl: 10, spread: 0 },
      }),
    ],
  },
  // --------------------------------------------- dance and exercise
  {
    id: "dance",
    name: "Dance",
    kind: "move",
    category: "Dance and exercise",
    note: "Side-to-side groove, arms up.",
    words: ["dancing", "groove", "party", "boogie", "sway", "club", "music"],
    cycle: 1,
    repeat: 4,
    frames: [
      f(
        0,
        {
          ...both({
            shoulderL: { raise: 30, forward: 40 },
            elbowL: { bend: 100 },
          }),
          hipL: { out: 12 },
          kneeL: { bend: 25 },
          kneeR: { bend: 5 },
          spine: { side: 10, twist: 8 },
          head: { tilt: 8 },
        },
        { hands: { L: "fist", R: "fist" } },
      ),
      f(
        0.5,
        {
          ...both({
            shoulderL: { raise: 30, forward: 40 },
            elbowL: { bend: 100 },
          }),
          hipR: { out: 12 },
          kneeR: { bend: 25 },
          kneeL: { bend: 5 },
          spine: { side: -10, twist: -8 },
          head: { tilt: -8 },
        },
        { hands: { L: "fist", R: "fist" } },
      ),
    ],
  },
  {
    id: "disco",
    name: "Disco point",
    kind: "move",
    category: "Dance and exercise",
    note: "Point up high, then down across.",
    words: ["disco", "seventies", "70s", "saturday night", "fever", "funk"],
    sided: true,
    hands: { R: "point" },
    cycle: 1,
    repeat: 3,
    frames: [
      f(0, {
        shoulderR: { raise: 130, forward: 30 },
        elbowR: { bend: 0 },
        shoulderL: { raise: 10, forward: -10, twist: -30 },
        elbowL: { bend: 95 },
        spine: { side: -10 },
        hipL: { out: 15 },
        kneeL: { bend: 15 },
        head: { nod: -15, turn: -15 },
      }),
      f(0.5, {
        shoulderR: { raise: -15, forward: 35, twist: -40 },
        elbowR: { bend: 0 },
        shoulderL: { raise: 10, forward: -10, twist: -30 },
        elbowL: { bend: 95 },
        spine: { side: 5, bend: 8 },
        kneeR: { bend: 15 },
        head: { nod: 15, turn: 15 },
      }),
    ],
  },
  {
    id: "spin",
    name: "Spin",
    kind: "move",
    category: "Dance and exercise",
    note: "A full turn on the spot.",
    words: ["spinning", "twirl", "pirouette", "whirl", "full turn", "360"],
    frames: [
      f(0, {}),
      f(0.4, both({ shoulderL: { raise: 50 } }), { turn: 120 }),
      f(0.8, both({ shoulderL: { raise: 50 } }), { turn: 240 }),
      f(1.2, {}, { turn: 360 }),
    ],
  },
  {
    id: "squats",
    name: "Squats",
    kind: "move",
    category: "Dance and exercise",
    note: "Exercise: down into a squat and back up.",
    words: [
      "squat exercise",
      "squatting",
      "workout",
      "leg day",
      "gym",
      "exercise",
      "fitness",
      "reps",
    ],
    cycle: 1.8,
    repeat: 3,
    frames: [f(0, {}), f(0.9, SQUAT)],
  },
  {
    id: "stretch",
    name: "Stretch",
    kind: "move",
    category: "Dance and exercise",
    note: "Arms up, lean one way, then the other.",
    words: ["stretching", "warm up", "yawn", "limber", "reach up", "wake up"],
    hands: { L: "open", R: "open" },
    frames: [
      f(0, {}),
      f(
        0.8,
        both({ shoulderL: { raise: 145, forward: 10 }, elbowL: { bend: 5 } }),
      ),
      f(1.8, {
        ...both({
          shoulderL: { raise: 145, forward: 10 },
          elbowL: { bend: 5 },
        }),
        spine: { side: 25 },
      }),
      f(2.8, {
        ...both({
          shoulderL: { raise: 145, forward: 10 },
          elbowL: { bend: 5 },
        }),
        spine: { side: -25 },
      }),
      f(
        3.6,
        both({ shoulderL: { raise: 145, forward: 10 }, elbowL: { bend: 5 } }),
      ),
      f(4.3, {}),
    ],
  },
  {
    id: "celebrate",
    name: "Fist pump",
    kind: "move",
    category: "Gestures",
    note: "Celebrating: “yes!”",
    words: [
      "celebrate",
      "celebrating",
      "yes",
      "goal",
      "score",
      "excited",
      "pump",
    ],
    sided: true,
    hands: { R: "fist" },
    frames: [
      f(0, {}),
      f(0.3, {
        shoulderR: { raise: 40, forward: 60, twist: 30 },
        elbowR: { bend: 120 },
      }),
      f(0.55, {
        shoulderR: { raise: -10, forward: 30, twist: 10 },
        elbowR: { bend: 130 },
        spine: { bend: 15 },
        ...both({ kneeL: { bend: 20 }, hipL: { forward: 15 } }),
      }),
      f(0.8, {
        shoulderR: { raise: 40, forward: 60, twist: 30 },
        elbowR: { bend: 120 },
      }),
      f(1.05, {
        shoulderR: { raise: -10, forward: 30, twist: 10 },
        elbowR: { bend: 130 },
        spine: { bend: 15 },
        ...both({ kneeL: { bend: 20 }, hipL: { forward: 15 } }),
      }),
      f(1.6, {}),
    ],
  },
];

export function findMotion(id: string): Motion | undefined {
  return MOTIONS.find((m) => m.id === id);
}

// ------------------------------------------------------------ playing

export interface MotionOptions {
  /** Do it with the left side ("left kick"). */
  mirror?: boolean;
  /** How many cycles (repeating moves). */
  repeat?: number;
  /** Time scale: 2 = half speed. */
  slow?: number;
  /** Stay on the spot instead of travelling. */
  inPlace?: boolean;
  /** Walk backwards. */
  backwards?: boolean;
  /** How long it should last, in seconds: repeats (and speed, a
   * little) are chosen to fill it exactly. */
  seconds?: number;
}

export interface MotionPlacement {
  x: number;
  z: number;
  rotation: number;
}

export interface MotionStep {
  /** Seconds from the start. */
  at: number;
  x: number;
  y: number;
  z: number;
  rotation: number;
  joints: PoseJoints;
}

/** Where a travelling figure may go (metres): the studio's floor,
 * stopping well short of the camera, which looks from the front (+z). */
const ROOM = { x: 2.6, back: -2.6, front: 1.5 };

/** How far (metres) a figure at `p` can go along unit direction `d`
 * before leaving the room. */
function roomAhead(from: MotionPlacement, dx: number, dz: number): number {
  let room = Infinity;
  const limit = (p: number, d: number, lo: number, hi: number) => {
    if (d > 1e-6) room = Math.min(room, (hi - p) / d);
    else if (d < -1e-6) room = Math.min(room, (lo - p) / d);
  };
  limit(from.x, dx, -ROOM.x, ROOM.x);
  limit(from.z, dz, ROOM.back, ROOM.front);
  return Math.max(0, room);
}

export interface MotionPlan {
  steps: MotionStep[];
  /** Cycles (or whole repeats) played. */
  repeat: number;
  /** Seconds it lasts. */
  length: number;
  /** How it travels: straight ahead, round a circle (a long walk that
   * wouldn't fit straight), or on the spot (no room for even that). */
  path: "straight" | "circle" | "spot";
  /** Fewer repeats than asked: at most MAX_STEPS keys per move. */
  capped: boolean;
}

/** Keys one move may make. */
const MAX_STEPS = 280;

const samePose = (a: MotionFrame, b: MotionFrame) =>
  JSON.stringify(a.pose) === JSON.stringify(b.pose) &&
  (a.air ?? 0) === (b.air ?? 0) &&
  JSON.stringify(a.hands ?? {}) === JSON.stringify(b.hands ?? {});

/** Whether a move can be done again straight after itself: cycles, and
 * moves that end as they start (a wave, a kick, a jump; not sit down). */
export function repeatable(motion: Motion): boolean {
  if (motion.kind !== "move") return false;
  if (motion.cycle) return true;
  const f = motion.frames;
  return samePose(f[0], f[f.length - 1]);
}

/** A circle a travelling figure can walk round from `from`, heading the
 * way it faces: the largest that stays in the room, turning towards the
 * centre of the studio when both sides fit. */
function fitCircle(
  from: MotionPlacement,
  sign: number,
): { radius: number; turn: 1 | -1 } | null {
  const th0 = (from.rotation * Math.PI) / 180;
  for (const radius of [1.3, 1.1, 0.9, 0.7]) {
    const fits = ([1, -1] as const).filter((k) => {
      for (let i = 0; i <= 48; i++) {
        const th = th0 + (k * i * 2 * Math.PI) / 48;
        const x =
          from.x + sign * (-radius / k) * (Math.cos(th) - Math.cos(th0));
        const z = from.z + sign * (radius / k) * (Math.sin(th) - Math.sin(th0));
        if (Math.abs(x) > ROOM.x || z < ROOM.back || z > ROOM.front)
          return false;
      }
      return true;
    });
    if (fits.length === 0) continue;
    const toCentre =
      Math.cos(th0) * -from.x - Math.sin(th0) * -from.z >= 0 ? 1 : -1;
    return {
      radius,
      turn: fits.includes(toCentre) ? toCentre : fits[0],
    };
  }
  return null;
}

/** A motion's frames, laid out in time and space from a placement. */
export function planMotion(
  motion: Motion,
  from: MotionPlacement,
  opts: MotionOptions = {},
): MotionPlan {
  const once = motion.frames[motion.frames.length - 1].at;
  const unit = motion.cycle ?? once; // seconds per repeat at speed 1
  const canRepeat = repeatable(motion) && unit > 0;
  let slow = Math.max(0.25, Math.min(4, opts.slow ?? 1));
  let repeat = canRepeat
    ? Math.max(1, Math.round(opts.repeat ?? motion.repeat ?? 1))
    : 1;
  if (opts.seconds && unit > 0) {
    if (canRepeat) {
      // Whole repeats at about the asked speed, then the speed nudged so
      // the move lasts exactly as long as asked.
      repeat = Math.max(1, Math.round(opts.seconds / (unit * slow)));
      slow = opts.seconds / (repeat * unit);
    } else slow = opts.seconds / unit;
    slow = Math.max(0.25, Math.min(4, slow));
  }
  const perRepeat = motion.cycle
    ? motion.frames.length
    : motion.frames.length - 1;
  const most = Math.max(1, Math.floor((MAX_STEPS - 1) / perRepeat));
  const capped = repeat > most;
  repeat = Math.min(repeat, most);

  // The frames of every repeat, end to end.
  type Raw = MotionFrame & { at: number; progress: number; spin: number };
  const raw: Raw[] = [];
  const endTurn = motion.frames[motion.frames.length - 1].turn ?? 0;
  for (let r = 0; r < repeat; r++)
    motion.frames.forEach((fr, i) => {
      // A repeated one-off move skips its first frame: the last frame of
      // the repeat before is the same pose.
      if (!motion.cycle && r > 0 && i === 0) return;
      raw.push({
        ...fr,
        at: r * unit + fr.at,
        progress: motion.cycle ? r + fr.at / unit : 0,
        spin: motion.cycle ? 0 : r * endTurn,
        // Climbing keeps rising: each cycle starts where the last ended.
        air: (fr.air ?? 0) + r * (motion.rise ?? 0),
      });
    });
  if (motion.cycle) {
    const first = motion.frames[0];
    raw.push({
      ...first,
      at: repeat * unit,
      progress: repeat,
      spin: 0,
      air: (first.air ?? 0) + repeat * (motion.rise ?? 0),
    });
  }

  // Travel along the way the figure faces, in whole strides (never
  // stretched: the feet would slide). A walk longer than the room ahead
  // goes round a circle instead; with no room for that, on the spot.
  const sign = opts.backwards ? -1 : 1;
  const th0 = (from.rotation * Math.PI) / 180;
  const per = opts.inPlace ? 0 : (motion.travel ?? 0);
  const distance = per * repeat;
  let path: MotionPlan["path"] = "straight";
  let circle: { radius: number; turn: 1 | -1 } | null = null;
  if (distance > 0) {
    const room = roomAhead(from, Math.sin(th0) * sign, Math.cos(th0) * sign);
    if (distance > room + 1e-6) {
      circle = fitCircle(from, sign);
      path = circle ? "circle" : "spot";
    }
  }
  const place = (s: number) => {
    if (path === "spot" || s === 0)
      return { x: from.x, z: from.z, heading: th0 };
    if (!circle)
      return {
        x: from.x + sign * Math.sin(th0) * s,
        z: from.z + sign * Math.cos(th0) * s,
        heading: th0,
      };
    const { radius: R, turn: k } = circle;
    const th = th0 + (k * s) / R;
    return {
      x: from.x + sign * (-R / k) * (Math.cos(th) - Math.cos(th0)),
      z: from.z + sign * (R / k) * (Math.sin(th) - Math.sin(th0)),
      heading: th,
    };
  };

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const steps = raw.map((fr) => {
    let joints = build(fr.pose, { ...motion.hands, ...fr.hands });
    if (opts.mirror) joints = mirrorJoints(joints);
    joints = roundJoints(joints);
    const turn = ((fr.turn ?? 0) + fr.spin) * (opts.mirror ? -1 : 1);
    const at = place(per * fr.progress);
    const heading = (at.heading * 180) / Math.PI;
    const y = Math.max(-1, Math.min(1.5, floorOffset(joints) + (fr.air ?? 0)));
    return {
      at: Math.round(fr.at * slow * 100) / 100,
      x: r2(at.x),
      y: r2(y),
      z: r2(at.z),
      rotation: r1(((((heading + turn + 180) % 360) + 360) % 360) - 180),
      joints,
    };
  });
  return {
    steps,
    repeat,
    length: steps[steps.length - 1].at,
    path: distance > 0 ? path : "straight",
    capped,
  };
}

export const motionSteps = (
  motion: Motion,
  from: MotionPlacement,
  opts: MotionOptions = {},
): MotionStep[] => planMotion(motion, from, opts).steps;

/** Whole tenths of a degree, inside every joint's limits. */
function roundJoints(joints: PoseJoints): PoseJoints {
  const src = joints as Record<string, Record<string, number>>;
  return Object.fromEntries(
    Object.entries(src).map(([id, v]) => [
      id,
      Object.fromEntries(
        Object.entries(v).map(([k, x]) => {
          const d = (
            JOINTS[id as JointId].dofs as Record<
              string,
              { min: number; max: number }
            >
          )[k];
          return [k, Math.min(d.max, Math.max(d.min, Math.round(x * 10) / 10))];
        }),
      ),
    ]),
  ) as PoseJoints;
}

/** How long a move lasts (seconds), with options. */
export function motionLength(motion: Motion, opts: MotionOptions = {}) {
  return planMotion(motion, { x: 0, z: 0, rotation: 0 }, opts).length;
}
