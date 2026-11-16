// Re-skins a rigged character GLB with bone-heat weights, keeping its
// skeleton: `node scripts/reskin-cast.mjs in.glb out.glb`.
//
// Why: scripts/rig-mannequin.mjs gives each bone a hard region of the
// mesh and softens the edges over a few rings of neighbours. On the clean
// scanned mannequins that is enough; on Meshy's irregular meshes the
// region edges are jagged, so armpits, crotches and wrists tear when a
// joint turns. Bone heat (Baran & PopoviÄ‡, "Automatic Rigging and
// Animation of 3D Characters", 2007; Blender's "automatic weights")
// spreads each bone's influence over the surface instead:
//
//   (−Δ + H) w_j = H p_j
//
// Δ is the mesh's cotangent Laplacian; H_v = 1 / d(v)² for d(v) the
// distance from vertex v to the nearest bone it can see (a straight line
// to the bone not leaving the body); p_j(v) = 1 where bone j is that
// bone. Weight then flows along the skin, never across a gap (an arm
// resting on the hip, thighs that touch), and every joint gets a smooth
// blend as wide as the limb. Each vertex keeps its four largest weights.
//
// The skeleton, bind pose, materials and everything else are kept; the
// file is slimmed as the cast is (quantised, meshopt).

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize, meshopt, quantize } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";

/** How wide each bone's zone reaches past its own skin, in limb radii. */
const BAND = Number(process.env.RESKIN_BAND ?? 3);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.sqrt(dot(a, a));
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Closest point on segment a–b to p, and its distance. */
function closestOnSegment(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2)) : 0;
  const q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  return { q, d: len(sub(p, q)) };
}

/** Each joint's bone as a segment (world space): from the joint to its
 * child joints' middle, or for an end joint out to where the body ends
 * (crown, toes, fingertips). */
export function boneSegments(joints, world, positions, minY, maxY) {
  const at = joints.map((j) => world.get(j));
  const index = new Map(joints.map((j, i) => [j, i]));
  const H = maxY - minY;
  return joints.map((j, i) => {
    const name = j.getName();
    const kids = j
      .listChildren()
      .filter((c) => index.has(c))
      .map((c) => at[index.get(c)]);
    const a = at[i];
    // A joint with several child limbs (pelvis, spine, wrist): its bone
    // runs to the child on its own axis (spine → neck, pelvis → spine,
    // wrist → middle knuckle), not to the average of all of them.
    const pick = (re) => {
      const c = j
        .listChildren()
        .find((k) => index.has(k) && re.test(k.getName()));
      return c ? at[index.get(c)] : null;
    };
    let b = null;
    if (/^pelvis$/.test(name)) b = pick(/^spine$/);
    else if (/^spine$/.test(name)) b = pick(/^neck$/);
    else if (/^wrist[LR]$/.test(name)) b = pick(/^middle1/);
    else if (kids.length === 1) b = kids[0];
    // Any other rig (an animal's): the main chain, the child with the
    // most bones below it (spine → chest, not → a leg or the tail).
    if (!b && kids.length > 1) {
      const below = (k) =>
        1 +
        k
          .listChildren()
          .filter((c) => index.has(c))
          .reduce((s, c) => s + below(c), 0);
      const main = j
        .listChildren()
        .filter((k) => index.has(k))
        .sort((x, y) => below(y) - below(x))[0];
      b = at[index.get(main)];
    }
    if (!b && /^neck$/.test(name)) b = [a[0], maxY, a[2]];
    if (!b && /^ankle[LR]$/.test(name))
      b = [a[0], minY + 0.01 * H, a[2] + 0.07 * H];
    if (!b) {
      // A fingertip: carry on along the finger by the last bone's length.
      const parent = joints.find((p) => p.listChildren().includes(j));
      const pa = parent ? at[index.get(parent)] : a;
      const d = sub(a, pa);
      b = [a[0] + d[0] * 0.8, a[1] + d[1] * 0.8, a[2] + d[2] * 0.8];
    }
    const parent = joints.findIndex((p) => p.listChildren().includes(j));
    return { name, a, b, parent };
  });
}

/** Vertices within `band` (along the surface, by Dijkstra over mesh
 * edges) of the `seeds`. `dist` is scratch space, one per vertex. */
function surfaceBand(L, P, seeds, band, dist) {
  const n = dist.length;
  dist.fill(Infinity);
  const inside = new Uint8Array(n);
  // A binary heap of [distance, vertex].
  const heap = [];
  const push = (d, v) => {
    heap.push([d, v]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  for (const s of seeds) {
    dist[s] = 0;
    push(0, s);
  }
  const { start, col } = L;
  while (heap.length) {
    const [d, v] = pop();
    if (d > dist[v]) continue;
    inside[v] = 1;
    for (let k = start[v]; k < start[v + 1]; k++) {
      const u = col[k];
      const e = Math.hypot(
        P[u * 3] - P[v * 3],
        P[u * 3 + 1] - P[v * 3 + 1],
        P[u * 3 + 2] - P[v * 3 + 2],
      );
      const nd = d + e;
      if (nd < dist[u] && nd <= band) {
        dist[u] = nd;
        push(nd, u);
      }
    }
  }
  return inside;
}

/** Cotangent stiffness (clamped non-negative, so the matrix stays an
 * M-matrix and weights stay in 0..1) and barycentric vertex areas. */
function laplacian(P, idx, n) {
  const rows = Array.from({ length: n }, () => new Map());
  const area = new Float64Array(n);
  const p = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]];
    const x = v.map(p);
    const A = len(cross(sub(x[1], x[0]), sub(x[2], x[0]))) / 2;
    for (const i of v) area[i] += A / 3;
    if (A < 1e-14) continue;
    for (let k = 0; k < 3; k++) {
      // The angle at corner k faces edge (k+1, k+2).
      const o = x[k];
      const e1 = sub(x[(k + 1) % 3], o);
      const e2 = sub(x[(k + 2) % 3], o);
      const cot = dot(e1, e2) / (len(cross(e1, e2)) || 1e-12);
      const w = Math.max(cot, 0.05) / 2;
      const i = v[(k + 1) % 3];
      const j = v[(k + 2) % 3];
      rows[i].set(j, (rows[i].get(j) ?? 0) + w);
      rows[j].set(i, (rows[j].get(i) ?? 0) + w);
    }
  }
  // CSR.
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + rows[i].size;
  const col = new Int32Array(start[n]);
  const val = new Float64Array(start[n]);
  const diag = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let k = start[i];
    for (const [j, w] of rows[i]) {
      col[k] = j;
      val[k++] = w;
      diag[i] += w;
    }
  }
  return { start, col, val, diag, area };
}

/** Solve (L + D) x = rhs by Jacobi-preconditioned conjugate gradients,
 * where L is the Laplacian (diag − offdiag) and D a diagonal. */
function solve(L, D, rhs, x0, inside, tol = 1e-6, maxIter = 4000) {
  const n = rhs.length;
  const { start, col, val, diag } = L;
  // Outside the zone x is held at 0 (a Dirichlet border): those rows are
  // the identity and inside rows ignore outside columns, so the system
  // stays symmetric positive definite.
  const Ax = (x, out) => {
    for (let i = 0; i < n; i++) {
      if (!inside[i]) {
        out[i] = x[i];
        continue;
      }
      let s = (diag[i] + D[i]) * x[i];
      for (let k = start[i]; k < start[i + 1]; k++)
        if (inside[col[k]]) s -= val[k] * x[col[k]];
      out[i] = s;
    }
  };
  const x = Float64Array.from(x0);
  const r = new Float64Array(n);
  const z = new Float64Array(n);
  const q = new Float64Array(n);
  Ax(x, r);
  let bn = 0;
  for (let i = 0; i < n; i++) {
    r[i] = rhs[i] - r[i];
    bn += rhs[i] * rhs[i];
  }
  bn = Math.sqrt(bn) || 1;
  const M = new Float64Array(n);
  for (let i = 0; i < n; i++) M[i] = 1 / (diag[i] + D[i] || 1);
  for (let i = 0; i < n; i++) z[i] = r[i] * M[i];
  const pv = Float64Array.from(z);
  let rz = 0;
  for (let i = 0; i < n; i++) rz += r[i] * z[i];
  let it = 0;
  for (; it < maxIter; it++) {
    Ax(pv, q);
    let pq = 0;
    for (let i = 0; i < n; i++) pq += pv[i] * q[i];
    const alpha = rz / pq;
    let rn = 0;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * pv[i];
      r[i] -= alpha * q[i];
      rn += r[i] * r[i];
    }
    if (Math.sqrt(rn) / bn < tol) break;
    for (let i = 0; i < n; i++) z[i] = r[i] * M[i];
    let rz2 = 0;
    for (let i = 0; i < n; i++) rz2 += r[i] * z[i];
    const beta = rz2 / rz;
    rz = rz2;
    for (let i = 0; i < n; i++) pv[i] = z[i] + beta * pv[i];
  }
  return { x, iterations: it };
}

/** Bone-heat weights for one skinned primitive. Returns per vertex the
 * four (joint, weight) pairs. */
export function boneHeat(P, N, idx, segments, log = () => {}) {
  const n = P.length / 3;
  const B = segments.length;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minY = Math.min(minY, P[i * 3 + 1]);
    maxY = Math.max(maxY, P[i * 3 + 1]);
  }
  const H = maxY - minY;

  // Visibility: a straight line from just inside the skin to the bone
  // that crosses no other skin.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.BufferAttribute(Float32Array.from(P), 3),
  );
  geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(idx), 1));
  const bvh = new MeshBVH(geo);
  const ray = new THREE.Ray();
  const visible = (p, nrm, q) => {
    const eps = 0.002 * H;
    const o = [p[0] - nrm[0] * eps, p[1] - nrm[1] * eps, p[2] - nrm[2] * eps];
    const d = sub(q, o);
    const dl = len(d);
    if (dl < eps) return true;
    ray.origin.set(o[0], o[1], o[2]);
    ray.direction.set(d[0] / dl, d[1] / dl, d[2] / dl);
    const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
    return !hit || hit.distance > dl * 0.98;
  };

  const heat = new Float64Array(n);
  const owner = new Int32Array(n).fill(-1);
  let hidden = 0;
  for (let v = 0; v < n; v++) {
    const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    const nrm = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
    const near = segments
      .map((s, j) => ({ j, ...closestOnSegment(p, s.a, s.b) }))
      .filter((c) => segments[c.j].deforms !== false)
      .sort((x, y) => x.d - y.d);
    // The nearest bone this vertex can see (among the closest few).
    let pick = null;
    for (const c of near.slice(0, 6))
      if (visible(p, nrm, c.q)) {
        pick = c;
        break;
      }
    if (!pick) {
      hidden++;
      pick = near[0];
    }
    owner[v] = pick.j;
    heat[v] = 1 / Math.max(pick.d, 0.005 * H) ** 2;
  }
  log(`  heat: ${hidden} vertices see no bone (nearest used)`);
  if (process.env.RESKIN_DEBUG) {
    const by = {};
    for (let v = 0; v < n; v++) {
      const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
      const nrm = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
      const near = segments
        .map((s, j) => ({ j, ...closestOnSegment(p, s.a, s.b) }))
        .sort((x, y) => x.d - y.d);
      if (!near.slice(0, 6).some((c) => visible(p, nrm, c.q))) {
        const k = segments[near[0].j].name;
        by[k] = (by[k] ?? 0) + 1;
      }
    }
    log(`  blind by nearest bone: ${JSON.stringify(by)}`);
    // Do normals point out? Fraction whose normal points away from the
    // nearest bone.
    let out = 0;
    for (let v = 0; v < n; v++) {
      const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
      const c = segments
        .map((s) => closestOnSegment(p, s.a, s.b))
        .sort((x, y) => x.d - y.d)[0];
      if (dot(sub(p, c.q), [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]]) > 0) out++;
    }
    log(
      `  normals pointing away from the nearest bone: ${((out / n) * 100).toFixed(1)}%`,
    );
  }

  const L = laplacian(P, idx, n);
  // Area-weighted: (L + A·H) w = A·H·p.
  const D = new Float64Array(n);
  for (let v = 0; v < n; v++) D[v] = L.area[v] * heat[v];
  // Each bone's heat is confined to its zone: the skin of its own bone
  // and of the bones joined to it, falling to exactly zero at the
  // zone's border. Without it heat reaches the whole body faintly: the
  // flank keeps a few percent of the upper arm, and raising the arm
  // 120° drags it into a tear. Confined, every weight still fades
  // smoothly (no cut-off edge to tear along instead).
  // The zone: the bone's own skin and a band around it, measured along
  // the surface, as wide as the limb is thick there (twice the bone's
  // median skin distance), so every border has room to fade.
  const top = Array.from({ length: n }, () => []);
  const dist = new Float64Array(n);
  for (let j = 0; j < B; j++) {
    const rhs = new Float64Array(n);
    const x0 = new Float64Array(n);
    const own = [];
    for (let v = 0; v < n; v++)
      if (owner[v] === j) {
        rhs[v] = D[v];
        x0[v] = 1;
        own.push(v);
      }
    if (!own.length) continue;
    const radii = own.map((v) => 1 / Math.sqrt(heat[v])).sort((a, b) => a - b);
    const band = BAND * radii[radii.length >> 1];
    const inside = surfaceBand(L, P, own, band, dist);
    const { x, iterations } = solve(L, D, rhs, x0, inside);
    let kept = 0;
    for (let v = 0; v < n; v++)
      if (x[v] > 0.01) {
        top[v].push([j, x[v]]);
        kept++;
      }
    log(
      `  ${segments[j].name.padEnd(9)} ${String(iterations).padStart(4)} iterations, ${kept} vertices`,
    );
  }
  // Four largest per vertex, summing to one; numerical dust (under 1%)
  // is taken off every weight first, so it fades rather than steps.
  const FLOOR = 0.01;
  return top.map((list, v) => {
    list = list.map(([j, w]) => [j, w - FLOOR]).filter(([, w]) => w > 0);
    list.sort((a, b) => b[1] - a[1]);
    const four = list.slice(0, 4);
    if (!four.length) four.push([owner[v], 1]);
    const sum = four.reduce((s, [, w]) => s + w, 0);
    return four.map(([j, w]) => [j, w / sum]);
  });
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error("usage: node scripts/reskin-cast.mjs in.glb out.glb");
    process.exit(1);
  }
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "meshopt.decoder": MeshoptDecoder,
      "meshopt.encoder": MeshoptEncoder,
    });
  const doc = await io.readBinary(new Uint8Array(readFileSync(input)));
  await reskinDocument(doc, { label: input });
  await doc.transform(
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  writeFileSync(output, await io.writeBinary(doc));
  console.log(`wrote ${output}`);
}

/** Where a skinned mesh's vertices are at rest, as a matrix (column-
 * major): a joint's world matrix times its inverse bind matrix, the same
 * for every joint at rest. Not the mesh node's own transform: glTF
 * ignores that for skinned meshes, and quantising a skinned mesh folds
 * its scale and offset into the inverse bind matrices instead. */
export function bindMatrix(skin) {
  const joint = skin.listJoints()[0];
  const ibm = skin.getInverseBindMatrices();
  const b = ibm
    ? Array.from(ibm.getArray().slice(0, 16))
    : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return new THREE.Matrix4()
    .fromArray(joint.getWorldMatrix())
    .multiply(new THREE.Matrix4().fromArray(b))
    .toArray();
}

/** Replace the skin weights of `doc` (a gltf-transform Document with one
 * skinned mesh) with bone heat, in place. `everyBone`: every joint takes
 * part (a freshly fitted skeleton); otherwise only joints the current
 * weights already use (keeps an animal rig's helper bones out). */
export async function reskinDocument(
  doc,
  { everyBone = false, skinFrom = {}, label = "mesh", log = console.log } = {},
) {
  await doc.transform(dequantize());
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const world = new Map(joints.map((j) => [j, j.getWorldTranslation()]));
  const node = root
    .listNodes()
    .find((n) => n.getMesh() && n.getSkin() === skin);
  const m = bindMatrix(skin);
  const prims = node.getMesh().listPrimitives();
  for (const prim of prims) {
    const pos = prim.getAttribute("POSITION");
    const nor = prim.getAttribute("NORMAL");
    const n = pos.getCount();
    const P = new Float64Array(n * 3);
    const N = new Float64Array(n * 3);
    const a = [];
    const v3 = new THREE.Vector3();
    const M = new THREE.Matrix4().fromArray(m);
    const Mn = new THREE.Matrix3().getNormalMatrix(M);
    for (let i = 0; i < n; i++) {
      pos.getElement(i, a);
      v3.set(a[0], a[1], a[2]).applyMatrix4(M);
      P.set([v3.x, v3.y, v3.z], i * 3);
      nor.getElement(i, a);
      v3.set(a[0], a[1], a[2]).applyMatrix3(Mn).normalize();
      N.set([v3.x, v3.y, v3.z], i * 3);
    }
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      minY = Math.min(minY, P[i * 3 + 1]);
      maxY = Math.max(maxY, P[i * 3 + 1]);
    }
    const segments = boneSegments(joints, world, P, minY, maxY);
    for (const seg of segments)
      if (skinFrom[seg.name]) seg.a = skinFrom[seg.name];
    // Only bones the rig already skins to take part: a helper bone (an
    // animal rig's root, on the floor) mustn't claim the belly.
    const used = new Float64Array(joints.length);
    const J0 = prim.getAttribute("JOINTS_0");
    const W0 = prim.getAttribute("WEIGHTS_0");
    const jj = [];
    const ww = [];
    for (let i = 0; i < n; i++) {
      J0.getElement(i, jj);
      W0.getElement(i, ww);
      for (let k = 0; k < 4; k++) used[jj[k]] += ww[k];
    }
    segments.forEach((s, j) => {
      s.deforms = everyBone || used[j] > 1e-3;
    });
    const idx = prim.getIndices().getArray();
    log(
      `${label}: ${n} vertices, ${idx.length / 3} triangles, ${joints.length} bones`,
    );
    const t0 = Date.now();
    const weights = boneHeat(P, N, idx, segments, log);
    const J = new Uint16Array(n * 4);
    const W = new Float32Array(n * 4);
    weights.forEach((four, v) =>
      four.forEach(([j, w], k) => {
        J[v * 4 + k] = j;
        W[v * 4 + k] = w;
      }),
    );
    prim.getAttribute("JOINTS_0").setArray(J).setNormalized(false);
    prim.getAttribute("WEIGHTS_0").setArray(W).setNormalized(false);
    log(`  done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
