// Rigs an unrigged four-legged animal GLB: recognises it, fits a
// skeleton to its shape, weights it, and gives it a walk.
//   node scripts/rig-animal.mjs in.glb out.glb
//
// 1. Recognise (lib/rig/classify.ts): a quadruped stands on four
//    separate feet and is longer than it is tall. Anything else is
//    refused here (humans and apes: scripts/rig-character.mjs).
// 2. The animal's own frame: forward along its length towards the head
//    (the bulkier end; a tail is thin), left, and up.
// 3. Fit the skeleton the built-in animals use (docs/creatures-rig-
//    spec.md): root, spine, chest, neck, head, four legs of three bones
//    (upper, lower, foot), and a two-bone tail. The body runs between
//    the hips and the shoulders at the middle of the torso (between the
//    belly, found under the body between the legs, and the back); each
//    leg follows its own centre line up from its foot.
// 4. Weights along those exact bones: Blender's automatic weights when
//    Blender is installed, else bone heat.
// 5. A walk: one second, 24 frames, diagonal pairs (front-left with
//    back-right), each knee folding on the forward swing, the spine
//    bobbing and the tail swaying; named "walk", as the app plays.
// Big meshes are first simplified to about 120k triangles.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup,
  dequantize,
  meshopt,
  prune,
  quantize,
  simplify,
  weld,
} from "@gltf-transform/functions";
import {
  MeshoptDecoder,
  MeshoptEncoder,
  MeshoptSimplifier,
} from "meshoptimizer";
import { findBlender } from "./blender/run.mjs";
import { blenderWeights } from "./blender-weights.mjs";
import { reskinDocument } from "./reskin-cast.mjs";

const MAX_TRIANGLES = 120_000;

/** The parts of the classifier this script needs (lib/rig/classify.ts
 * is TypeScript; the rule is small enough to keep in step here and is
 * tested on the same models). */
function floorPatches(P, lo, H) {
  const n = P.length / 3;
  const cell = H / 60;
  const floor = lo + 0.04 * H;
  const cells = new Map();
  for (let i = 0; i < n; i++)
    if (P[i * 3 + 1] < floor) {
      const k = `${Math.floor(P[i * 3] / cell)},${Math.floor(P[i * 3 + 2] / cell)}`;
      const c = cells.get(k) ?? { n: 0, x: 0, z: 0 };
      c.n++;
      c.x += P[i * 3];
      c.z += P[i * 3 + 2];
      cells.set(k, c);
    }
  const seen = new Set();
  const patches = [];
  for (const start of cells.keys()) {
    if (seen.has(start)) continue;
    seen.add(start);
    const queue = [start];
    const p = { n: 0, x: 0, z: 0 };
    while (queue.length) {
      const k = queue.pop();
      const c = cells.get(k);
      p.n += c.n;
      p.x += c.x;
      p.z += c.z;
      const [x, z] = k.split(",").map(Number);
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          const nk = `${x + dx},${z + dz}`;
          if (cells.has(nk) && !seen.has(nk)) {
            seen.add(nk);
            queue.push(nk);
          }
        }
    }
    patches.push({ n: p.n, x: p.x / p.n, z: p.z / p.n });
  }
  const total = patches.reduce((s, p) => s + p.n, 0);
  return patches.filter((p) => p.n >= 0.1 * total).sort((a, b) => b.n - a.n);
}

/** Fit the quadruped skeleton to rest positions `P` (+Y up). Returns
 * bones (name, parent, head, tail in the model's space) and the
 * animal's forward and left directions on the floor. */
export function fitQuadruped(P) {
  const n = P.length / 3;
  let lo = Infinity;
  let hi = -Infinity;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    lo = Math.min(lo, P[i * 3 + 1]);
    hi = Math.max(hi, P[i * 3 + 1]);
    cx += P[i * 3];
    cz += P[i * 3 + 2];
  }
  cx /= n;
  cz /= n;
  const H = hi - lo;
  const feet = floorPatches(P, lo, H);
  if (feet.length < 4)
    throw new Error(
      `not a four-legged animal: ${feet.length} feet on the floor`,
    );
  const four = feet.slice(0, 4);

  // Forward: the long horizontal axis (PCA), pointing at the head.
  let xx = 0;
  let zz = 0;
  let xz = 0;
  for (let i = 0; i < n; i++) {
    const dx = P[i * 3] - cx;
    const dz = P[i * 3 + 2] - cz;
    xx += dx * dx;
    zz += dz * dz;
    xz += dx * dz;
  }
  const ang = 0.5 * Math.atan2(2 * xz, xx - zz);
  let f = [Math.cos(ang), Math.sin(ang)];
  const U = (i) => (P[i * 3] - cx) * f[0] + (P[i * 3 + 2] - cz) * f[1];
  let umin = Infinity;
  let umax = -Infinity;
  for (let i = 0; i < n; i++) {
    umin = Math.min(umin, U(i));
    umax = Math.max(umax, U(i));
  }
  const L = umax - umin;
  // The head end is the bulkier end (a tail is thin).
  let atMax = 0;
  let atMin = 0;
  for (let i = 0; i < n; i++) {
    const u = U(i);
    if (u > umax - 0.15 * L) atMax++;
    if (u < umin + 0.15 * L) atMin++;
  }
  if (atMin > atMax) {
    f = [-f[0], -f[1]];
    [umin, umax] = [-umax, -umin];
  }
  const left = [f[1], -f[0]]; // up × forward, on the floor
  const toLocal = (x, z) => [
    (x - cx) * f[0] + (z - cz) * f[1],
    (x - cx) * left[0] + (z - cz) * left[1],
  ];
  const toWorld = (u, w, y) => [
    cx + u * f[0] + w * left[0],
    y,
    cz + u * f[1] + w * left[1],
  ];
  const local = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) local.set(toLocal(P[i * 3], P[i * 3 + 2]), i * 2);

  // Feet: front pair (further forward), back pair; left/right by side.
  const fl = four.map((p) => {
    const [u, w] = toLocal(p.x, p.z);
    return { u, w };
  });
  fl.sort((a, b) => b.u - a.u);
  const front = fl.slice(0, 2).sort((a, b) => b.w - a.w); // [left, right]
  const back = fl.slice(2, 4).sort((a, b) => b.w - a.w);
  const uFront = (front[0].u + front[1].u) / 2;
  const uBack = (back[0].u + back[1].u) / 2;

  // Belly (underside between the legs, on the middle line) and back.
  const span = uFront - uBack;
  const halfWidth = Math.max(...fl.map((p) => Math.abs(p.w)));
  let belly = Infinity;
  let top = -Infinity;
  for (let i = 0; i < n; i++) {
    const u = local[i * 2];
    const w = local[i * 2 + 1];
    if (u < uBack + 0.2 * span || u > uFront - 0.2 * span) continue;
    const y = P[i * 3 + 1];
    if (Math.abs(w) < 0.35 * halfWidth) belly = Math.min(belly, y);
    top = Math.max(top, y);
  }
  if (!Number.isFinite(belly)) belly = lo + 0.45 * H;
  const torso = (belly + top) / 2;

  // A leg's centre at height y: the middle of its own vertices there.
  const footGap = (p) =>
    Math.min(
      ...fl.filter((q) => q !== p).map((q) => Math.hypot(q.u - p.u, q.w - p.w)),
    );
  const legAt = (p, y) => {
    const r = Math.min(0.5 * footGap(p), 0.25 * L);
    const band = 0.04 * H;
    let su = 0;
    let sw = 0;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const yy = P[i * 3 + 1];
      if (Math.abs(yy - y) > band) continue;
      const u = local[i * 2];
      const w = local[i * 2 + 1];
      if (Math.hypot(u - p.u, w - p.w) > r) continue;
      su += u;
      sw += w;
      k++;
    }
    return k ? [su / k, sw / k] : [p.u, p.w];
  };

  const bones = [];
  const add = (name, parent, head, tail) =>
    bones.push({ name, parent, head, tail });
  const mid = (uBack + uFront) / 2;
  const hipPoint = toWorld(uBack, 0, torso);
  const midPoint = toWorld(mid, 0, torso);
  const shoulderPoint = toWorld(uFront, 0, torso);
  add("root", null, toWorld(mid, 0, lo), toWorld(mid + 0.05 * L, 0, lo));
  add("spine", "root", hipPoint, midPoint);
  add("chest", "spine", midPoint, shoulderPoint);

  // Neck and head: from the shoulders up and forward to the head's end.
  let hu = 0;
  let hy = 0;
  let hk = 0;
  let tipU = -Infinity;
  for (let i = 0; i < n; i++) {
    const u = local[i * 2];
    if (u < umax - 0.12 * L) continue;
    hu += u;
    hy += P[i * 3 + 1];
    hk++;
    tipU = Math.max(tipU, u);
  }
  hu /= hk;
  hy /= hk;
  // The neck sits on the middle line, above the shoulders.
  const neckStart = toWorld(uFront + 0.08 * L, 0, (torso + top) / 2);
  const headJoint = toWorld(hu - 0.06 * L, 0, hy);
  const headTip = toWorld(tipU, 0, hy);
  add("neck", "chest", neckStart, headJoint);
  add("head", "neck", headJoint, headTip);

  // Legs: hip / shoulder joint inside the body, knee, ankle, toe.
  const leg = (side, p, parent) => {
    const upper = belly + 0.35 * (torso - belly);
    const [ku, kw] = legAt(p, lo + 0.5 * (belly - lo));
    const [au, aw] = legAt(p, lo + 0.14 * (belly - lo));
    const [tu, tw] = legAt(p, upper - 0.05 * H);
    const top3 = toWorld(tu, tw * 0.85, upper);
    const knee = toWorld(ku, kw, lo + 0.5 * (belly - lo));
    const ankle = toWorld(au, aw, lo + 0.14 * (belly - lo));
    const toe = toWorld(p.u + 0.06 * L, p.w, lo + 0.01 * H);
    add(`leg${side}`, parent, top3, knee);
    add(`leg${side}Lower`, `leg${side}`, knee, ankle);
    add(`foot${side}`, `leg${side}Lower`, ankle, toe);
  };
  leg("FL", front[0], "chest");
  leg("FR", front[1], "chest");
  leg("BL", back[0], "spine");
  leg("BR", back[1], "spine");

  // Tail: from the rump back to the far end, if there is anything there.
  let ry = 0;
  let rk = 0;
  let endU = Infinity;
  for (let i = 0; i < n; i++) {
    const u = local[i * 2];
    if (u > uBack - 0.04 * L) continue;
    ry += P[i * 3 + 1];
    rk++;
    endU = Math.min(endU, u);
  }
  const rump = toWorld(uBack - 0.04 * L, 0, torso + 0.15 * (top - torso));
  const tailMid = rk
    ? toWorld((uBack - 0.04 * L + endU) / 2, 0, ry / rk)
    : toWorld(uBack - 0.12 * L, 0, torso);
  const tailEnd = rk
    ? toWorld(endU, 0, ry / rk)
    : toWorld(uBack - 0.2 * L, 0, torso);
  add("tail1", "spine", rump, tailMid);
  add("tail2", "tail1", tailMid, tailEnd);

  return { bones, forward: f, left, height: H, length: L, belly, lo };
}

/** Build the skin (world-aligned bones: identity rest rotations) for
 * `bones` on the doc's mesh; every vertex starts on `spine`. */
function buildSkin(doc, bones) {
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0] ?? doc.createBuffer();
  const node = root.listNodes().find((x) => x.getMesh());
  const prim = node.getMesh().listPrimitives()[0];
  const n = prim.getAttribute("POSITION").getCount();
  const byName = new Map();
  const world = new Map(bones.map((b) => [b.name, b.head]));
  for (const b of bones) {
    const p = b.parent ? world.get(b.parent) : [0, 0, 0];
    const j = doc
      .createNode(b.name)
      .setTranslation([b.head[0] - p[0], b.head[1] - p[1], b.head[2] - p[2]]);
    byName.set(b.name, j);
    if (b.parent) byName.get(b.parent).addChild(j);
  }
  const ibm = new Float32Array(bones.length * 16);
  bones.forEach((b, i) =>
    ibm.set(
      [
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        -b.head[0],
        -b.head[1],
        -b.head[2],
        1,
      ],
      i * 16,
    ),
  );
  const skin = doc
    .createSkin("animal")
    .setSkeleton(byName.get("root"))
    .setInverseBindMatrices(
      doc.createAccessor().setType("MAT4").setArray(ibm).setBuffer(buffer),
    );
  for (const b of bones) skin.addJoint(byName.get(b.name));
  node.setSkin(skin);
  root.listScenes()[0].addChild(byName.get("root"));
  const spine = bones.findIndex((b) => b.name === "spine");
  const J = new Uint16Array(n * 4);
  const W = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    J[i * 4] = spine;
    W[i * 4] = 1;
  }
  prim.setAttribute(
    "JOINTS_0",
    doc.createAccessor().setType("VEC4").setArray(J).setBuffer(buffer),
  );
  prim.setAttribute(
    "WEIGHTS_0",
    doc.createAccessor().setType("VEC4").setArray(W).setBuffer(buffer),
  );
  return { skin, byName };
}

/** A one-second walk (24 frames, the 25th = the first): diagonal pairs,
 * the knee folding on the forward swing, the foot kept level, the
 * spine bobbing twice per stride, the tail swaying. Rotations about the
 * animal's left axis (a leg swinging forward and back). */
function addWalk(doc, byName, left) {
  const frames = 25;
  const times = Float32Array.from({ length: frames }, (_, i) => i / 24);
  const about = (axis, deg) => {
    const h = (deg * Math.PI) / 360;
    return [
      axis[0] * Math.sin(h),
      axis[1] * Math.sin(h),
      axis[2] * Math.sin(h),
      Math.cos(h),
    ];
  };
  const L = [left[0], 0, left[1]];
  const UP = [0, 1, 0];
  const buffer = doc.getRoot().listBuffers()[0];
  const anim = doc.createAnimation("walk");
  const input = doc
    .createAccessor()
    .setType("SCALAR")
    .setArray(times)
    .setBuffer(buffer);
  const channel = (bone, quats) => {
    const out = doc
      .createAccessor()
      .setType("VEC4")
      .setArray(Float32Array.from(quats.flat()))
      .setBuffer(buffer);
    const sampler = doc
      .createAnimationSampler()
      .setInput(input)
      .setOutput(out)
      .setInterpolation("LINEAR");
    anim
      .addSampler(sampler)
      .addChannel(
        doc
          .createAnimationChannel()
          .setTargetNode(byName.get(bone))
          .setTargetPath("rotation")
          .setSampler(sampler),
      );
  };
  const phase = { FL: 0, BR: 0, FR: 0.5, BL: 0.5 };
  for (const [side, ph] of Object.entries(phase)) {
    const frontLeg = side[0] === "F";
    const swing = frontLeg ? 22 : 20;
    const fold = frontLeg ? 26 : 30;
    const upper = [];
    const lower = [];
    const foot = [];
    for (let k = 0; k < frames; k++) {
      const a = 2 * Math.PI * ((k % 24) / 24 + ph);
      // Positive about `left` swings the foot back; forward swing while
      // the angle falls (cos < 0): then the knee folds.
      const th = swing * Math.sin(a);
      const lift = fold * Math.max(0, -Math.cos(a));
      const bend = frontLeg ? lift : -lift;
      upper.push(about(L, th));
      lower.push(about(L, bend));
      foot.push(about(L, -(th + bend)));
    }
    channel(`leg${side}`, upper);
    channel(`leg${side}Lower`, lower);
    channel(`foot${side}`, foot);
  }
  const spine = [];
  const tail = [];
  for (let k = 0; k < frames; k++) {
    const a = 2 * Math.PI * ((k % 24) / 24);
    spine.push(about(L, 2 * Math.sin(2 * a)));
    tail.push(about(UP, 10 * Math.sin(a)));
  }
  channel("spine", spine);
  channel("tail1", tail);
}

/** Fit a two-legged animal (an ape, a bird, a rodent up on its hind
 * legs): pelvis where the legs meet, spine and chest up the body, neck
 * and head at the top, arms (or wings) only where they stand clear of
 * the body, and a tail if something reaches out behind. Bones named as
 * the built-in bipeds' (docs/creatures-rig-spec.md). */
export function fitBiped(P) {
  const n = P.length / 3;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    lo = Math.min(lo, P[i * 3 + 1]);
    hi = Math.max(hi, P[i * 3 + 1]);
  }
  const H = hi - lo;
  const feet = floorPatches(P, lo, H);
  if (feet.length < 2)
    throw new Error(
      `not a two-legged animal: ${feet.length} feet on the floor`,
    );
  const [f1, f2] = feet.slice(0, 2);
  const cx = (f1.x + f2.x) / 2;
  const cz = (f1.z + f2.z) / 2;
  // Left/right runs between the feet; forward is square to it, towards
  // where the head (the top tenth) is.
  let side = [f1.x - f2.x, f1.z - f2.z];
  const sl = Math.hypot(...side) || 1;
  side = [side[0] / sl, side[1] / sl];
  let f = [-side[1], side[0]];
  let hx = 0;
  let hz = 0;
  let hk = 0;
  for (let i = 0; i < n; i++)
    if (P[i * 3 + 1] > hi - 0.1 * H) {
      hx += P[i * 3];
      hz += P[i * 3 + 2];
      hk++;
    }
  hx = hx / hk - cx;
  hz = hz / hk - cz;
  // A bird's or rat's head is well ahead of its feet; an ape's barely:
  // then the bulk of the body decides (a tail reaches back).
  let ahead = hx * f[0] + hz * f[1];
  if (Math.abs(ahead) < 0.03 * H) {
    let mu = 0;
    for (let i = 0; i < n; i++)
      mu += (P[i * 3] - cx) * f[0] + (P[i * 3 + 2] - cz) * f[1];
    ahead = mu;
  }
  if (ahead < 0) f = [-f[0], -f[1]];
  const left = [f[1], -f[0]];
  const loc = (i) => [
    (P[i * 3] - cx) * f[0] + (P[i * 3 + 2] - cz) * f[1],
    (P[i * 3] - cx) * left[0] + (P[i * 3 + 2] - cz) * left[1],
  ];
  const toWorld = (u, w, y) => [
    cx + u * f[0] + w * left[0],
    y,
    cz + u * f[1] + w * left[1],
  ];
  const local = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) local.set(loc(i), i * 2);
  const footLocal = [f1, f2].map((p) => {
    const u = (p.x - cx) * f[0] + (p.z - cz) * f[1];
    const w = (p.x - cx) * left[0] + (p.z - cz) * left[1];
    return { u, w };
  });
  footLocal.sort((a, b) => b.w - a.w); // [left, right]
  const gap = Math.abs(footLocal[0].w - footLocal[1].w);

  // Where the legs meet: the lowest height at which the middle line
  // between the feet has body on it (the crotch).
  let crotch = hi;
  for (let i = 0; i < n; i++) {
    const w = local[i * 2 + 1];
    const u = local[i * 2];
    if (Math.abs(w) < 0.15 * gap && Math.abs(u) < 0.25 * H)
      crotch = Math.min(crotch, P[i * 3 + 1]);
  }
  if (crotch > lo + 0.8 * H) crotch = lo + 0.45 * H;

  // A leg's centre at height y.
  const legAt = (p, y) => {
    const r = 0.45 * gap;
    let su = 0;
    let sw = 0;
    let k = 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(P[i * 3 + 1] - y) > 0.03 * H) continue;
      const u = local[i * 2];
      const w = local[i * 2 + 1];
      if (Math.hypot(u - p.u, w - p.w) > r) continue;
      su += u;
      sw += w;
      k++;
    }
    return k ? [su / k, sw / k] : [p.u, p.w];
  };
  // The body's middle at height y (the part over the pelvis).
  const bodyAt = (y, halfW) => {
    let su = 0;
    let k = 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(P[i * 3 + 1] - y) > 0.03 * H) continue;
      if (Math.abs(local[i * 2 + 1]) > halfW) continue;
      su += local[i * 2];
      k++;
    }
    return k ? su / k : 0;
  };

  const bones = [];
  const add = (name, parent, head, tail) =>
    bones.push({ name, parent, head, tail });
  const hipY = crotch + 0.06 * H;
  const chestY = hipY + 0.6 * (hi - hipY) * 0.7;
  const neckY = hipY + 0.82 * (hi - hipY);
  const pelvis = toWorld(bodyAt(hipY, gap), 0, hipY);
  const chest = toWorld(bodyAt(chestY, gap), 0, chestY);
  const neck = toWorld(bodyAt(neckY, 0.6 * gap), 0, neckY);
  // The head: the top tenth's middle, and its far end.
  let hu = 0;
  let hy = 0;
  let k2 = 0;
  for (let i = 0; i < n; i++)
    if (P[i * 3 + 1] > hi - 0.12 * H && Math.abs(local[i * 2 + 1]) < gap) {
      hu += local[i * 2];
      hy += P[i * 3 + 1];
      k2++;
    }
  const head = toWorld(k2 ? hu / k2 : 0, 0, k2 ? hy / k2 : hi);
  add("root", null, toWorld(0, 0, lo), toWorld(0.05 * H, 0, lo));
  add("pelvis", "root", pelvis, chest);
  add("spine", "pelvis", chest, neck);
  add("neck", "spine", neck, head);
  add("head", "neck", head, toWorld(k2 ? hu / k2 : 0, 0, hi));

  for (const [s, p] of [
    ["L", footLocal[0]],
    ["R", footLocal[1]],
  ]) {
    const kneeY = lo + 0.5 * (hipY - lo);
    const ankleY = lo + 0.1 * (hipY - lo);
    const [ku, kw] = legAt(p, kneeY);
    const [au, aw] = legAt(p, ankleY);
    const hip = toWorld((bodyAt(hipY, gap) + p.u) / 2, p.w * 0.7, hipY);
    add(`leg${s}`, "pelvis", hip, toWorld(ku, kw, kneeY));
    add(
      `leg${s}Lower`,
      `leg${s}`,
      toWorld(ku, kw, kneeY),
      toWorld(au, aw, ankleY),
    );
    add(
      `foot${s}`,
      `leg${s}Lower`,
      toWorld(au, aw, ankleY),
      toWorld(p.u + 0.08 * H, p.w, lo),
    );
  }

  // Arms: parts with a gap between them and the body. In slices across
  // the animal (side to side) above the hips, an ape's arm is its own
  // run of body, apart from the torso's; folded wings or paws held to
  // the chest touch it, and stay with the body. (Wider than the chest is
  // no test: a sitting rat's hips are wider still.)
  const BAND = 0.02 * H;
  const CELL = 0.01 * H;
  const bands = new Map();
  for (let i = 0; i < n; i++) {
    const y = P[i * 3 + 1];
    if (y <= crotch) continue;
    const b = Math.floor((y - crotch) / BAND);
    let list = bands.get(b);
    if (!list) bands.set(b, (list = []));
    list.push(i);
  }
  const armOf = { L: [], R: [] };
  let torsoHalf = 0;
  for (const list of bands.values()) {
    const cells = new Map();
    for (const i of list) {
      const c = Math.floor(local[i * 2 + 1] / CELL);
      let at = cells.get(c);
      if (!at) cells.set(c, (at = []));
      at.push(i);
    }
    const keys = [...cells.keys()].sort((a, b) => a - b);
    // Runs of occupied cells; the torso's run holds the middle line.
    const runs = [];
    for (const c of keys) {
      const last = runs[runs.length - 1];
      if (last && c - last.to <= 1) last.to = c;
      else runs.push({ from: c, to: c });
    }
    const mid = runs.find((r) => r.from <= 0 && r.to >= 0);
    if (!mid) continue;
    torsoHalf = Math.max(torsoHalf, Math.max(-mid.from, mid.to + 1) * CELL);
    const bandY = P[list[0] * 3 + 1];
    for (const r of runs) {
      if (r === mid) continue;
      const side = r.from > mid.to ? "L" : "R";
      // Below the chest, legs are separate runs too: an arm hangs
      // further out than the feet (an ape's), a leg doesn't (a bird's).
      const inner = Math.min(Math.abs(r.from), Math.abs(r.to + 1)) * CELL;
      const footOut = Math.max(...footLocal.map((p) => Math.abs(p.w)));
      if (bandY < chestY && inner < footOut + 0.15 * gap) continue;
      for (let c = r.from; c <= r.to; c++)
        for (const i of cells.get(c) ?? []) armOf[side].push(i);
    }
  }
  for (const [s, sign] of [
    ["L", 1],
    ["R", -1],
  ]) {
    const arm = armOf[s];
    // Folded wings, paws held to the chest: no arm bones.
    if (arm.length < 0.01 * n) continue;
    // Shoulder at the top of the arm, by the torso; hand at its far end
    // (lowest or furthest out).
    let top = arm[0];
    let far = arm[0];
    const reach = (i) => Math.abs(local[i * 2 + 1]) + (hi - P[i * 3 + 1]) * 0.5;
    for (const i of arm) {
      if (P[i * 3 + 1] > P[top * 3 + 1]) top = i;
      if (reach(i) > reach(far)) far = i;
    }
    const shoulder = toWorld(
      local[top * 2],
      sign * torsoHalf,
      P[top * 3 + 1] - 0.04 * H,
    );
    const hand = toWorld(local[far * 2], local[far * 2 + 1], P[far * 3 + 1]);
    const elbow = shoulder.map((v, k) => (v + hand[k]) / 2);
    const wrist = shoulder.map((v, k) => v + (hand[k] - v) * 0.85);
    add(`arm${s}`, "spine", shoulder, elbow);
    add(`arm${s}Lower`, `arm${s}`, elbow, wrist);
    add(`hand${s}`, `arm${s}Lower`, wrist, hand);
  }

  // Tail: anything reaching back past the body, below the chest.
  let tu = Infinity;
  let ti = -1;
  for (let i = 0; i < n; i++)
    if (P[i * 3 + 1] < chestY && local[i * 2] < tu) {
      tu = local[i * 2];
      ti = i;
    }
  const back = bodyAt(hipY, gap);
  if (ti >= 0 && tu < back - 0.25 * H) {
    const rump = toWorld(back - 0.08 * H, 0, hipY);
    const end = toWorld(tu, local[ti * 2 + 1], P[ti * 3 + 1]);
    const midT = rump.map((v, k) => (v + end[k]) / 2);
    add("tail1", "pelvis", rump, midT);
    add("tail2", "tail1", midT, end);
  }
  // How long the legs are, as a share of the height: short legs (a bird,
  // a rat sitting up) take smaller steps.
  return {
    bones,
    forward: f,
    left,
    height: H,
    length: H,
    legShare: (hipY - lo) / H,
  };
}

/** A two-legged walk: legs alternate, knees fold on the forward swing,
 * the arms (or wings) swing opposite their leg, the tail sways. */
function addBipedWalk(doc, byName, left, legShare = 0.5) {
  // Full steps from legs a third of the height up; shorter legs, in
  // proportion (never under 30%).
  const scale = Math.max(0.3, Math.min(1, legShare / 0.33));
  const frames = 25;
  const times = Float32Array.from({ length: frames }, (_, i) => i / 24);
  const about = (axis, deg) => {
    const h = (deg * Math.PI) / 360;
    return [
      axis[0] * Math.sin(h),
      axis[1] * Math.sin(h),
      axis[2] * Math.sin(h),
      Math.cos(h),
    ];
  };
  const L = [left[0], 0, left[1]];
  const UP = [0, 1, 0];
  const buffer = doc.getRoot().listBuffers()[0];
  const anim = doc.createAnimation("walk");
  const input = doc
    .createAccessor()
    .setType("SCALAR")
    .setArray(times)
    .setBuffer(buffer);
  const channel = (bone, quats) => {
    if (!byName.has(bone)) return;
    const out = doc
      .createAccessor()
      .setType("VEC4")
      .setArray(Float32Array.from(quats.flat()))
      .setBuffer(buffer);
    const sampler = doc
      .createAnimationSampler()
      .setInput(input)
      .setOutput(out)
      .setInterpolation("LINEAR");
    anim
      .addSampler(sampler)
      .addChannel(
        doc
          .createAnimationChannel()
          .setTargetNode(byName.get(bone))
          .setTargetPath("rotation")
          .setSampler(sampler),
      );
  };
  for (const [s, ph] of [
    ["L", 0],
    ["R", 0.5],
  ]) {
    const upper = [];
    const lower = [];
    const foot = [];
    const arm = [];
    for (let k = 0; k < frames; k++) {
      const a = 2 * Math.PI * ((k % 24) / 24 + ph);
      const th = 24 * scale * Math.sin(a);
      const fold = -30 * scale * Math.max(0, -Math.cos(a));
      upper.push(about(L, th));
      lower.push(about(L, fold));
      foot.push(about(L, -(th + fold)));
      arm.push(about(L, -14 * Math.sin(a)));
    }
    channel(`leg${s}`, upper);
    channel(`leg${s}Lower`, lower);
    channel(`foot${s}`, foot);
    channel(`arm${s}`, arm);
  }
  const tail = [];
  for (let k = 0; k < frames; k++)
    tail.push(about(UP, 8 * Math.sin(2 * Math.PI * ((k % 24) / 24))));
  channel("tail1", tail);
}

/** Rig an unrigged quadruped in `doc` (one mesh): skeleton, weights,
 * walk. */
export async function rigAnimal(doc, glb, log = console.log) {
  await doc.transform(dequantize(), dedup(), weld());
  const root = doc.getRoot();
  const node = root.listNodes().find((x) => x.getMesh());
  if (node.getSkin()) throw new Error("this model already has a skeleton");
  // Into the model's own space: apply the node's transform to the mesh.
  const m = node.getWorldMatrix();
  const prim = node.getMesh().listPrimitives()[0];
  let tris = (prim.getIndices()?.getCount() ?? 0) / 3;
  if (tris > MAX_TRIANGLES) {
    await MeshoptSimplifier.ready;
    await doc.transform(
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: MAX_TRIANGLES / tris,
        error: 0.002,
      }),
    );
    tris = (prim.getIndices()?.getCount() ?? 0) / 3;
    log(`  simplified to ${tris} triangles`);
  }
  const pos = prim.getAttribute("POSITION");
  const n = pos.getCount();
  const P = new Float64Array(n * 3);
  const a = [];
  for (let i = 0; i < n; i++) {
    pos.getElement(i, a);
    for (let k = 0; k < 3; k++)
      P[i * 3 + k] =
        m[k] * a[0] + m[4 + k] * a[1] + m[8 + k] * a[2] + m[12 + k];
  }
  // Bake the node transform into the vertices so the skin's space is
  // the model's (glTF ignores a skinned mesh's own node transform).
  pos.setArray(Float32Array.from(P));
  const nor = prim.getAttribute("NORMAL");
  if (nor) {
    const N = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      nor.getElement(i, a);
      const v = [0, 1, 2].map(
        (k) => m[k] * a[0] + m[4 + k] * a[1] + m[8 + k] * a[2],
      );
      const l = Math.hypot(...v) || 1;
      N.set(
        v.map((x) => x / l),
        i * 3,
      );
    }
    nor.setArray(N);
  }
  node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  // Four feet: a quadruped; two (a tail tip on the floor doesn't count):
  // a two-legged animal.
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    lo = Math.min(lo, P[i * 3 + 1]);
    hi = Math.max(hi, P[i * 3 + 1]);
  }
  const feetCount = floorPatches(P, lo, hi - lo).length;
  const kind = feetCount >= 4 ? "quadruped" : "biped";
  const fit = kind === "quadruped" ? fitQuadruped(P) : fitBiped(P);
  log(
    `  ${kind}: ${fit.bones.length} bones (${fit.bones.map((b) => b.name).join(", ")})`,
  );
  const { byName } = buildSkin(doc, fit.bones);
  const segmentsFor = Object.fromEntries(
    fit.bones.map((b) => [b.name, [b.head, b.tail]]),
  );
  if (findBlender()) {
    log("  weights: Blender automatic weights");
    await blenderWeights(doc, glb, {
      everyBone: true,
      segmentsFor,
      exclude: ["root"],
      log,
    });
  } else {
    log("  weights: bone heat (Blender not installed)");
    await reskinDocument(doc, { everyBone: true, label: "animal", log });
  }
  if (kind === "quadruped") addWalk(doc, byName, fit.left);
  else addBipedWalk(doc, byName, fit.left, fit.legShare);
  node.setExtras({ creature: { kind, bones: fit.bones.length } });
  await doc.transform(prune());
  return fit;
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error("usage: node scripts/rig-animal.mjs in.glb out.glb");
    process.exit(1);
  }
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const glb = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "meshopt.decoder": MeshoptDecoder,
      "meshopt.encoder": MeshoptEncoder,
    });
  const doc = await glb.readBinary(new Uint8Array(readFileSync(input)));
  await rigAnimal(doc, glb);
  await doc.transform(
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  writeFileSync(output, await glb.writeBinary(doc));
  console.log(`wrote ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
