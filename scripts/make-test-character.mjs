/** Builds tests/fixtures/test-character.glb: a small blocky character
 * for the character-import tests, made from code so it carries no
 * licence. It has the awkward parts of real exports on purpose:
 *
 * - Mixamo bone names ("mixamorig:LeftArm"), with extra bones the
 *   mannequin has no joint for (Spine1/2, shoulders, head, toes, ends);
 * - a T-pose, palms down, each bone's +Y running along it (as Blender
 *   and Mixamo do), so no bone is world-aligned;
 * - the skeleton under an armature scaled to centimetres;
 * - facing -Z (like VRM 0.x), so the studio must turn it round;
 * - its own skin and shirt colours;
 * - eye bones under the head and VRoid-named face shapes on a face
 *   panel (Fcl_ALL_Joy, Fcl_EYE_Close, Fcl_MTH_A), for the face tests.
 *
 * Run: node scripts/make-test-character.mjs */

import { Document, NodeIO } from "@gltf-transform/core";
import * as THREE from "three";

const OUT = "tests/fixtures/test-character.glb";

/** Joint positions in metres, facing +Z, its left = +X (mirrored for the
 * right side). [name, parent, position] */
const centre = [
  ["Hips", null, [0, 0.95, 0]],
  ["Spine", "Hips", [0, 1.05, 0]],
  ["Spine1", "Spine", [0, 1.18, 0]],
  ["Spine2", "Spine1", [0, 1.3, 0]],
  ["Neck", "Spine2", [0, 1.45, 0]],
  ["Head", "Neck", [0, 1.53, 0]],
  ["HeadTop_End", "Head", [0, 1.75, 0]],
  // After HeadTop_End: the head bone still points up, at it.
  ["LeftEye", "Head", [0.035, 1.64, 0.1]],
  ["RightEye", "Head", [-0.035, 1.64, 0.1]],
];
const left = [
  ["Shoulder", "Spine2", [0.05, 1.42, 0]],
  ["Arm", "Shoulder", [0.17, 1.42, 0]],
  ["ForeArm", "Arm", [0.44, 1.42, 0]],
  ["Hand", "ForeArm", [0.69, 1.42, 0]],
  ["HandThumb1", "Hand", [0.72, 1.41, 0.03]],
  ["HandThumb2", "HandThumb1", [0.75, 1.41, 0.055]],
  ["HandThumb3", "HandThumb2", [0.775, 1.41, 0.07]],
  ["HandThumb4", "HandThumb3", [0.795, 1.41, 0.08]],
  ...[
    ["Index", 0.025, 0.045],
    ["Middle", 0.008, 0.05],
    ["Ring", -0.01, 0.045],
    ["Pinky", -0.028, 0.035],
  ].flatMap(([f, z, len]) => [
    [`Hand${f}1`, "Hand", [0.78, 1.42, z]],
    [`Hand${f}2`, `Hand${f}1`, [0.78 + len, 1.42, z]],
    [`Hand${f}3`, `Hand${f}2`, [0.78 + len * 1.8, 1.42, z]],
    [`Hand${f}4`, `Hand${f}3`, [0.78 + len * 2.4, 1.42, z]],
  ]),
  ["UpLeg", "Hips", [0.1, 0.92, 0]],
  ["Leg", "UpLeg", [0.1, 0.5, 0.01]],
  ["Foot", "Leg", [0.1, 0.08, 0]],
  ["ToeBase", "Foot", [0.1, 0.02, 0.11]],
  ["Toe_End", "ToeBase", [0.1, 0.02, 0.18]],
];
const joints = [
  ...centre,
  ...["Left", "Right"].flatMap((side) =>
    left.map(([n, parent, [x, y, z]]) => [
      `${side}${n}`,
      parent.startsWith("Spine") || parent === "Hips"
        ? parent
        : `${side}${parent}`,
      [side === "Left" ? x : -x, y, z],
    ]),
  ),
];

// Facing -Z: turn every position half a turn about Y.
const facing = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  Math.PI,
);
const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(facing);
const pos = Object.fromEntries(
  joints.map(([n, , p]) => [
    n,
    new THREE.Vector3(...p).applyQuaternion(facing),
  ]),
);
const parentOf = Object.fromEntries(joints.map(([n, p]) => [n, p]));
const children = (n) => joints.filter(([, p]) => p === n).map(([c]) => c);

/** Each bone's world rotation: +Y along the bone (towards its first
 * child), with a twist so no two conventions line up by chance. */
const rot = {};
for (const [n] of joints) {
  const kids = children(n);
  const to = kids.length
    ? pos[kids[0]].clone().sub(pos[n])
    : pos[n].clone().sub(pos[parentOf[n]]);
  rot[n] = new THREE.Quaternion()
    .setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.normalize())
    .multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4),
    );
}

// three.js objects, to get local transforms under the scaled armature.
const armature = new THREE.Object3D();
armature.scale.setScalar(0.01);
const objs = {};
for (const [n, p] of joints) {
  const o = new THREE.Object3D();
  (p ? objs[p] : armature).add(o);
  o.parent.updateMatrixWorld(true);
  const world = new THREE.Matrix4().compose(
    pos[n],
    rot[n],
    new THREE.Vector3(1, 1, 1),
  );
  o.parent.updateMatrixWorld(true);
  new THREE.Matrix4()
    .copy(o.parent.matrixWorld)
    .invert()
    .multiply(world)
    .decompose(o.position, o.quaternion, o.scale);
  o.updateMatrixWorld(true);
  objs[n] = o;
}
armature.updateMatrixWorld(true);

// ------------------------------------------------------------- glTF
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene("Scene");
const armNode = doc.createNode("Armature").setScale([0.01, 0.01, 0.01]);
scene.addChild(armNode);
const nodes = {};
for (const [n, p] of joints) {
  const o = objs[n];
  const node = doc
    .createNode(`mixamorig:${n}`)
    .setTranslation(o.position.toArray())
    .setRotation(o.quaternion.toArray())
    .setScale(o.scale.toArray());
  (p ? nodes[p] : armNode).addChild(node);
  nodes[n] = node;
}

// A box from each joint to its first child (or a short stub), skinned
// whole to that bone. Head and hands get a bigger block.
const names = joints.map(([n]) => n);
const P = [];
const N = [];
const J = [];
const W = [];
const idxSkin = [];
const idxShirt = [];
const shirt = new Set([
  "Hips",
  "Spine",
  "Spine1",
  "Spine2",
  "LeftShoulder",
  "RightShoulder",
  "LeftArm",
  "RightArm",
]);
function box(bone, a, b, w) {
  const d = b.clone().sub(a);
  const len = d.length();
  if (len < 1e-6) return;
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    d.normalize(),
  );
  const g = new THREE.BoxGeometry(w, len, w).toNonIndexed();
  g.translate(0, len / 2, 0);
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  const base = P.length / 3;
  const p = g.attributes.position.array;
  const nn = g.attributes.normal.array;
  for (let i = 0; i < p.length; i++) {
    P.push(p[i]);
    N.push(nn[i]);
  }
  const target = shirt.has(bone) ? idxShirt : idxSkin;
  for (let i = 0; i < p.length / 3; i++) {
    J.push(names.indexOf(bone), 0, 0, 0);
    W.push(1, 0, 0, 0);
    target.push(base + i);
  }
}
for (const [n] of joints) {
  const kids = children(n);
  if (/_End$|4$/.test(n)) continue;
  const end = kids.length ? pos[kids[0]] : pos[n];
  const w =
    n === "Head"
      ? 0.2
      : /Hand\w+\d/.test(n)
        ? 0.016
        : /Hand$/.test(n)
          ? 0.08
          : /Spine|Hips/.test(n)
            ? 0.3
            : /Foot|Toe/.test(n)
              ? 0.09
              : 0.1;
  if (n === "Hips") box(n, pos[n].clone().setY(0.85), pos.Spine, w);
  else if (/Eye$/.test(n))
    // A small block looking forward, so a turned eye shows.
    box(
      n,
      pos[n],
      pos[n].clone().add(forward.clone().multiplyScalar(0.03)),
      0.03,
    );
  else box(n, pos[n], end, w);
}

const acc = (type, arr, ctor) =>
  doc.createAccessor().setType(type).setArray(new ctor(arr)).setBuffer(buffer);
const position = acc("VEC3", P, Float32Array);
const normal = acc("VEC3", N, Float32Array);
const jointsAcc = acc("VEC4", J, Uint16Array);
const weights = acc("VEC4", W, Float32Array);
const mesh = doc.createMesh("Body");
for (const [indices, color, name] of [
  [idxSkin, [0.86, 0.64, 0.5, 1], "Skin"],
  [idxShirt, [0.15, 0.35, 0.75, 1], "Shirt"],
]) {
  const material = doc
    .createMaterial(name)
    .setBaseColorFactor(color)
    .setRoughnessFactor(0.8);
  mesh.addPrimitive(
    doc
      .createPrimitive()
      .setAttribute("POSITION", position)
      .setAttribute("NORMAL", normal)
      .setAttribute("JOINTS_0", jointsAcc)
      .setAttribute("WEIGHTS_0", weights)
      .setIndices(acc("SCALAR", indices, Uint32Array))
      .setMaterial(material),
  );
}
const ibm = [];
for (const n of names)
  ibm.push(...objs[n].matrixWorld.clone().invert().toArray());
const skin = doc
  .createSkin("Skin")
  .setSkeleton(nodes.Hips)
  .setInverseBindMatrices(acc("MAT4", ibm, Float32Array));
for (const n of names) skin.addJoint(nodes[n]);
scene.addChild(doc.createNode("Body").setMesh(mesh).setSkin(skin));

// The face: a panel in front of the head, skinned to it, with three
// face shapes that each move it a little.
const panel = new THREE.BoxGeometry(0.12, 0.1, 0.01).toNonIndexed();
panel.translate(0, 1.6, 0.095);
panel.applyQuaternion(facing);
const fp = Array.from(panel.attributes.position.array);
const count = fp.length / 3;
const shapes = {
  Fcl_ALL_Joy: [0, 0.01, 0],
  Fcl_EYE_Close: [0, 0, -0.005],
  Fcl_MTH_A: [0, -0.02, 0],
};
// Shape names are written from each target's name.
const faceMesh = doc.createMesh("Face");
const facePrim = doc
  .createPrimitive()
  .setAttribute("POSITION", acc("VEC3", fp, Float32Array))
  .setAttribute(
    "NORMAL",
    acc("VEC3", Array.from(panel.attributes.normal.array), Float32Array),
  )
  .setAttribute(
    "JOINTS_0",
    acc(
      "VEC4",
      Array.from({ length: count }, () => [
        names.indexOf("Head"),
        0,
        0,
        0,
      ]).flat(),
      Uint16Array,
    ),
  )
  .setAttribute(
    "WEIGHTS_0",
    acc(
      "VEC4",
      Array.from({ length: count }, () => [1, 0, 0, 0]).flat(),
      Float32Array,
    ),
  )
  .setMaterial(
    doc.createMaterial("FaceSkin").setBaseColorFactor([0.9, 0.7, 0.58, 1]),
  );
for (const [name, d] of Object.entries(shapes))
  facePrim.addTarget(
    doc
      .createPrimitiveTarget(name)
      .setAttribute(
        "POSITION",
        acc(
          "VEC3",
          Array.from({ length: count }, () =>
            new THREE.Vector3(...d).applyQuaternion(facing).toArray(),
          ).flat(),
          Float32Array,
        ),
      ),
  );
faceMesh.addPrimitive(facePrim).setWeights(Object.keys(shapes).map(() => 0));
scene.addChild(doc.createNode("Face").setMesh(faceMesh).setSkin(skin));

await new NodeIO().write(OUT, doc);
console.log(`wrote ${OUT}: ${names.length} bones, ${P.length / 3} vertices`);
