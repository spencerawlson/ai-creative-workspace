/** Faces on imported characters: expressions from the file's face
 * shapes (morph targets) and eye direction from its eye bones.
 *
 * The pose's face controls (lib/studio/pose.ts: eyes, expression,
 * eyelids, mouth) map onto named expressions. A VRM file says which
 * shapes make each one (VRM 1.0 `expressions`, VRM 0.x
 * `blendShapeMaster`); any other file is read by its shape names
 * (VRoid's Fcl_*, ARKit's 52 blendshapes, VRChat visemes, plain names).
 * The mannequin has none of this, so on it the face controls do nothing.
 *
 * Pure Three.js, no renderer: unit-tested in tests/unit/engine-face.test.ts. */

import * as THREE from "three";
import { JOINTS, type PoseJoints } from "@/lib/studio/pose";

export const EXPRESSIONS = [
  "happy",
  "angry",
  "sad",
  "relaxed",
  "surprised",
  "blink",
  "blinkLeft",
  "blinkRight",
  "aa",
  "ih",
  "ou",
  "ee",
  "oh",
  "lookUp",
  "lookDown",
  "lookLeft",
  "lookRight",
] as const;
export type ExpressionName = (typeof EXPRESSIONS)[number];

/** One face shape an expression moves: the mesh (by its place among
 * the model's meshes that have shapes, which clones keep), the shape's
 * index and how far it goes at 100%. */
export interface MorphBind {
  mesh: number;
  index: number;
  weight: number;
}

export interface FaceRig {
  expressions: Partial<Record<ExpressionName, MorphBind[]>>;
  /** Eye bones by name, with their rest: bone.quaternion = pre · look ·
   * post, `look` in the figure's frame (facing +Z), so the eyes look
   * relative to the head and follow it. */
  eyes: Array<{ name: string; pre: THREE.Quaternion; post: THREE.Quaternion }>;
}

/** Which face controls a character has (`joint.dof`, e.g.
 * "expression.happy"), for the inspector. */
export type FaceControls = string[];

/** Meshes with face shapes, in traversal order. */
export function shapeMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.morphTargetInfluences?.length) out.push(m);
  });
  return out;
}

// ------------------------------------------------------------- VRM maps

const VRM0_PRESET: Record<string, ExpressionName> = {
  joy: "happy",
  angry: "angry",
  sorrow: "sad",
  fun: "relaxed",
  surprised: "surprised",
  a: "aa",
  i: "ih",
  u: "ou",
  e: "ee",
  o: "oh",
  blink: "blink",
  blink_l: "blinkLeft",
  blink_r: "blinkRight",
  lookup: "lookUp",
  lookdown: "lookDown",
  lookleft: "lookLeft",
  lookright: "lookRight",
};

type Json = Record<string, unknown> | null | undefined;
const obj = (v: unknown): Json =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;

/** The expressions a VRM file defines, or null if it isn't VRM.
 * `nodeMeshes(i)` gives the shape meshes of glTF node i (a node with
 * several primitives is several meshes). */
export function vrmExpressions(
  json: unknown,
  nodeMeshes: (node: number) => number[],
): Partial<Record<ExpressionName, MorphBind[]>> | null {
  const ext = obj(obj(json)?.extensions);
  const out: Partial<Record<ExpressionName, MorphBind[]>> = {};
  const add = (
    name: ExpressionName,
    node: unknown,
    index: unknown,
    weight: number,
  ) => {
    if (typeof node !== "number" || typeof index !== "number") return;
    if (!Number.isFinite(weight) || weight <= 0) return;
    for (const mesh of nodeMeshes(node))
      (out[name] ??= []).push({ mesh, index, weight: Math.min(1, weight) });
  };
  const v1 = obj(obj(obj(ext?.VRMC_vrm)?.expressions)?.preset);
  if (v1) {
    for (const name of EXPRESSIONS) {
      const binds = obj(v1[name])?.morphTargetBinds;
      if (!Array.isArray(binds)) continue;
      for (const b of binds)
        add(name, obj(b)?.node, obj(b)?.index, Number(obj(b)?.weight ?? 1));
    }
    return out;
  }
  const groups = obj(obj(ext?.VRM)?.blendShapeMaster)?.blendShapeGroups;
  if (!Array.isArray(groups)) return null;
  // 0.x binds name a glTF mesh, not a node: find the nodes that use it.
  const nodes = obj(json)?.nodes;
  const usedBy = (mesh: unknown) =>
    Array.isArray(nodes)
      ? nodes.flatMap((n, i) => (obj(n)?.mesh === mesh ? [i] : []))
      : [];
  for (const g of groups) {
    const preset = String(obj(g)?.presetName ?? "").toLowerCase();
    const name =
      VRM0_PRESET[preset] ??
      VRM0_PRESET[String(obj(g)?.name ?? "").toLowerCase()];
    const binds = obj(g)?.binds;
    if (!name || !Array.isArray(binds)) continue;
    for (const b of binds)
      for (const node of usedBy(obj(b)?.mesh))
        // 0.x weights are 0..100.
        add(name, node, obj(b)?.index, Number(obj(b)?.weight ?? 100) / 100);
  }
  return out;
}

// ---------------------------------------------------------- shape names

/** Per expression, ways files name it, best first: each entry is a set
 * of shape names (lower case, letters and digits only) used together,
 * with an optional weight ("jawopen*0.4"). */
const SHAPE_NAMES: Record<ExpressionName, string[][]> = {
  happy: [
    ["fclalljoy"],
    ["happy"],
    ["joy"],
    ["smile"],
    [
      "mouthsmileleft",
      "mouthsmileright",
      "cheeksquintleft",
      "cheeksquintright",
    ],
    ["mouthsmilel", "mouthsmiler"],
    ["mouthsmile"],
  ],
  angry: [
    ["fclallangry"],
    ["angry"],
    ["anger"],
    ["browdownleft", "browdownright", "mouthpressleft", "mouthpressright"],
    ["browdownl", "browdownr"],
  ],
  sad: [
    ["fclallsorrow"],
    ["sad"],
    ["sorrow"],
    ["mouthfrownleft", "mouthfrownright", "browinnerup"],
    ["mouthfrownl", "mouthfrownr", "browinnerup"],
  ],
  relaxed: [["fclallfun"], ["relaxed"], ["fun"], ["calm"]],
  surprised: [
    ["fclallsurprised"],
    ["surprised"],
    ["surprise"],
    ["eyewideleft", "eyewideright", "browinnerup", "jawopen*0.4"],
    ["eyewidel", "eyewider", "browinnerup", "jawopen*0.4"],
  ],
  blink: [
    ["fcleyeclose"],
    ["blink"],
    ["eyesclosed"],
    ["eyeclose"],
    ["eyeblinkleft", "eyeblinkright"],
    ["eyeblinkl", "eyeblinkr"],
    ["blinkleft", "blinkright"],
    ["blinkl", "blinkr"],
  ],
  blinkLeft: [
    ["fcleyeclosel"],
    ["blinkleft"],
    ["blinkl"],
    ["eyeblinkleft"],
    ["eyeblinkl"],
    ["winkleft"],
  ],
  blinkRight: [
    ["fcleyecloser"],
    ["blinkright"],
    ["blinkr"],
    ["eyeblinkright"],
    ["eyeblinkr"],
    ["winkright"],
  ],
  aa: [["fclmtha"], ["aa"], ["a"], ["vrcvaa"], ["visemeaa"], ["jawopen"]],
  ih: [["fclmthi"], ["ih"], ["i"], ["vrcvih"], ["visemeih"], ["visemei"]],
  ou: [
    ["fclmthu"],
    ["ou"],
    ["u"],
    ["vrcvou"],
    ["visemeou"],
    ["visemeu"],
    ["mouthfunnel"],
  ],
  ee: [["fclmthe"], ["ee"], ["e"], ["vrcvee"], ["visemeee"], ["visemee"]],
  oh: [
    ["fclmtho"],
    ["oh"],
    ["o"],
    ["vrcvoh"],
    ["visemeoh"],
    ["visemeo"],
    ["mouthpucker"],
  ],
  lookUp: [["lookup"], ["eyelookupleft", "eyelookupright"]],
  lookDown: [["lookdown"], ["eyelookdownleft", "eyelookdownright"]],
  // Its left: its left eye looks out, its right eye in.
  lookLeft: [["lookleft"], ["eyelookoutleft", "eyelookinright"]],
  lookRight: [["lookright"], ["eyelookoutright", "eyelookinleft"]],
};

const tidy = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Expressions found by shape name across the meshes. */
export function namedExpressions(
  meshes: THREE.Mesh[],
): Partial<Record<ExpressionName, MorphBind[]>> {
  const shapes = new Map<string, Array<{ mesh: number; index: number }>>();
  const put = (name: string, at: { mesh: number; index: number }) => {
    const list = shapes.get(name) ?? [];
    if (!list.some((s) => s.mesh === at.mesh && s.index === at.index))
      list.push(at);
    shapes.set(name, list);
  };
  meshes.forEach((m, mesh) => {
    for (const [name, index] of Object.entries(m.morphTargetDictionary ?? {})) {
      put(tidy(name), { mesh, index });
      // Some exporters prefix shapes with the mesh: "Face.Fcl_EYE_Close".
      put(tidy(name.replace(/^.*[.|:]/, "")), { mesh, index });
    }
  });
  const out: Partial<Record<ExpressionName, MorphBind[]>> = {};
  for (const name of EXPRESSIONS)
    for (const set of SHAPE_NAMES[name]) {
      const binds = set.flatMap((entry) => {
        const [shape, w] = entry.split("*");
        const weight = w ? Number(w) : 1;
        return (shapes.get(shape) ?? []).map((s) => ({ ...s, weight }));
      });
      if (binds.length) {
        out[name] = binds;
        break;
      }
    }
  return out;
}

// ----------------------------------------------------------------- eyes

const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

/** Eye bones: the VRM's leftEye/rightEye if given, else bones under the
 * head whose name says "eye" (not brows, lids or lashes), one a side. */
export function findEyes(
  head: THREE.Object3D,
  vrmEyes: THREE.Object3D[] | null,
): THREE.Bone[] {
  if (vrmEyes?.length)
    return vrmEyes.filter((o): o is THREE.Bone => !!(o as THREE.Bone).isBone);
  const found: Partial<Record<"L" | "R", THREE.Bone>> = {};
  head.traverse((o) => {
    if (!(o as THREE.Bone).isBone || o === head) return;
    const n = o.name.toLowerCase().replace(/^.*[|:]/, "");
    if (!/eye/.test(n) || /brow|lid|lash|end|target|socket|high/.test(n))
      return;
    const side = /(^|[^a-z])(l|left)([^a-z]|$)|left/.test(n)
      ? "L"
      : /(^|[^a-z])(r|right)([^a-z]|$)|right/.test(n)
        ? "R"
        : null;
    if (side && !found[side]) found[side] = o as THREE.Bone;
  });
  return [found.L, found.R].filter((b): b is THREE.Bone => !!b);
}

/** The VRM's eye bones (humanoid leftEye / rightEye), if it names them. */
export function vrmEyeNodes(
  json: unknown,
  node: (index: number) => THREE.Object3D | undefined,
): THREE.Object3D[] | null {
  const ext = obj(obj(json)?.extensions);
  const v1 = obj(obj(obj(ext?.VRMC_vrm)?.humanoid)?.humanBones);
  const v0 = obj(obj(ext?.VRM)?.humanoid)?.humanBones;
  const index = (name: string): unknown =>
    v1
      ? obj(v1[name])?.node
      : Array.isArray(v0)
        ? obj(v0.find((h) => obj(h)?.bone === name))?.node
        : undefined;
  const eyes = ["leftEye", "rightEye"]
    .map(index)
    .map((i) => (typeof i === "number" ? node(i) : undefined))
    .filter((o): o is THREE.Object3D => !!o);
  return eyes.length ? eyes : null;
}

/** Build the face rig, at rest, in `root`'s frame (the figure facing
 * +Z). Null when the character has neither face shapes nor eyes. */
export function buildFace(
  root: THREE.Object3D,
  vrm: Partial<Record<ExpressionName, MorphBind[]>> | null,
  eyes: THREE.Bone[],
): FaceRig | null {
  root.updateMatrixWorld(true);
  const named = namedExpressions(shapeMeshes(root));
  // The VRM's own definitions first; names fill any it leaves out.
  const expressions = { ...named, ...(vrm ?? {}) };
  for (const k of EXPRESSIONS)
    if (!expressions[k]?.length) delete expressions[k];
  if (!expressions.blink && expressions.blinkLeft && expressions.blinkRight)
    expressions.blink = [...expressions.blinkLeft, ...expressions.blinkRight];
  const toRoot = new THREE.Quaternion();
  root.getWorldQuaternion(toRoot).invert();
  const rest = (o: THREE.Object3D) =>
    toRoot.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion()));
  const eyeRig = eyes
    .filter((e) => e.parent)
    .map((e) => ({
      name: e.name,
      pre: rest(e.parent!).invert(),
      post: rest(e),
    }));
  if (!Object.keys(expressions).length && !eyeRig.length) return null;
  return { expressions, eyes: eyeRig };
}

/** Which face controls work on this character. */
export function faceControls(face: FaceRig | null): FaceControls {
  if (!face) return [];
  const has = (e: ExpressionName) => !!face.expressions[e];
  const out: string[] = [];
  const looks = has("lookLeft") || has("lookRight");
  if (face.eyes.length || looks) out.push("eyes.turn");
  if (face.eyes.length || has("lookUp") || has("lookDown"))
    out.push("eyes.raise");
  for (const dof of Object.keys(JOINTS.expression.dofs))
    if (has(dof as ExpressionName)) out.push(`expression.${dof}`);
  if (has("blink")) out.push("eyelids.blink");
  if (has("blinkLeft")) out.push("eyelids.left");
  if (has("blinkRight")) out.push("eyelids.right");
  for (const dof of Object.keys(JOINTS.mouth.dofs))
    if (has(dof as ExpressionName)) out.push(`mouth.${dof}`);
  return out;
}

/** How far (0..1) each expression goes for a pose. */
export function expressionWeights(
  joints: PoseJoints,
  eyeBones: boolean,
): Record<ExpressionName, number> {
  const p = (v: number) => Math.min(1, Math.max(0, v / 100));
  const { eyes, expression: x, eyelids, mouth } = joints;
  const turn = JOINTS.eyes.dofs.turn.max;
  const raise = JOINTS.eyes.dofs.raise.max;
  // Without eye bones, eyes look with shapes (VRM "blend shape" look-at).
  const look = (v: number, max: number) =>
    eyeBones ? 0 : Math.min(1, Math.max(0, v / max));
  return {
    happy: p(x.happy),
    angry: p(x.angry),
    sad: p(x.sad),
    relaxed: p(x.relaxed),
    surprised: p(x.surprised),
    blink: p(eyelids.blink),
    blinkLeft: p(eyelids.left),
    blinkRight: p(eyelids.right),
    aa: p(mouth.aa),
    ih: p(mouth.ih),
    ou: p(mouth.ou),
    ee: p(mouth.ee),
    oh: p(mouth.oh),
    lookUp: look(eyes.raise, raise),
    lookDown: look(-eyes.raise, raise),
    lookLeft: look(eyes.turn, turn),
    lookRight: look(-eyes.turn, turn),
  };
}

/** Rotation of the eyes in the figure's frame: turn about the vertical
 * (to its left), then up. */
export function lookRotation(turnDeg: number, raiseDeg: number) {
  const d = THREE.MathUtils.degToRad;
  return new THREE.Quaternion()
    .setFromAxisAngle(Y, d(turnDeg))
    .multiply(new THREE.Quaternion().setFromAxisAngle(X, -d(raiseDeg)));
}

/** Set a figure's face: shape weights on its meshes and its eye bones.
 * `meshes` and `eyes` are the figure's own (a clone's), matching the
 * rig's mesh indices and eye names. */
export function applyFace(
  face: FaceRig,
  meshes: THREE.Mesh[],
  eyes: Map<string, THREE.Bone>,
  joints: PoseJoints,
): void {
  const weights = expressionWeights(joints, face.eyes.length > 0);
  for (const binds of Object.values(face.expressions))
    for (const b of binds!) {
      const inf = meshes[b.mesh]?.morphTargetInfluences;
      if (inf && b.index < inf.length) inf[b.index] = 0;
    }
  for (const [name, binds] of Object.entries(face.expressions)) {
    const w = weights[name as ExpressionName];
    if (!w) continue;
    for (const b of binds!) {
      const inf = meshes[b.mesh]?.morphTargetInfluences;
      if (inf && b.index < inf.length)
        inf[b.index] = Math.min(1, inf[b.index] + w * b.weight);
    }
  }
  if (!face.eyes.length) return;
  const look = lookRotation(joints.eyes.turn, joints.eyes.raise);
  for (const e of face.eyes) {
    const bone = eyes.get(e.name);
    if (bone) bone.quaternion.copy(e.pre).multiply(look).multiply(e.post);
  }
}
