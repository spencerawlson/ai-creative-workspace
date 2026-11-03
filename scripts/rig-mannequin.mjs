// Auto-rigs a scanned A-pose mannequin: fits a 45-bone skeleton (body,
// feet, thumbs and fingers) to the mesh and bakes skin weights, so the
// figure can be posed at runtime.
//
// The scans ship as one static, welded mesh (positions + normals only).
// Rigging is done offline because it needs the whole mesh at once:
//
// 1. Landmarks: horizontal slices of the figure are split into runs of
//    occupied cells. In the scan's A-pose the arms are separate runs
//    below the armpits and the legs are separate below the crotch, which
//    locates the shoulders, hips and limb centrelines on each figure.
//    Joint heights along the limbs use standard anthropometric ratios.
// 2. Regions: each bone owns the vertices on the far side of a plane
//    through its joint, inside a capsule around the limb (for the upper
//    arm below the armpit: exactly the slice's arm run), and connected
//    (through the mesh) to the limb's tip. Connectivity is what keeps a
//    hand resting near a thigh out of the leg, and the chest out of the
//    arm. Patches cut off from their own label (a thumb poking out of
//    the hand's capsule) take their neighbours' label.
// 3. Weights: each vertex is blended between its bone and that bone's
//    parent with a smoothstep across the joint plane, then the weights
//    are averaged over mesh neighbours a few times, so no edge has a hard
//    0 -> 1 step that would tear when the joint turns far.
//
// Checked visually on both scans with every pose preset, plus a CPU
// skinning test (arm raised 140°): no triangle stretches more than 4x.
//
// Bones are world-aligned in the bind pose (identity rotation), so a bone
// rotation at runtime is expressed directly in the figure's own axes.
// Axes: +Y up, the figure faces +Z, the figure's left is +X.

/** Bone hierarchy: [name, parent]. Order matters (parents first). */
export const BONES = [
  ["pelvis", null],
  ["spine", "pelvis"],
  ["neck", "spine"],
  ["shoulderL", "spine"],
  ["elbowL", "shoulderL"],
  ["wristL", "elbowL"],
  ["shoulderR", "spine"],
  ["elbowR", "shoulderR"],
  ["wristR", "elbowR"],
  ["hipL", "pelvis"],
  ["kneeL", "hipL"],
  ["hipR", "pelvis"],
  ["kneeR", "hipR"],
  // Version 2: feet, thumbs and fingers (three bones each).
  ...["L", "R"].flatMap((s) => [
    [`ankle${s}`, `knee${s}`],
    [`thumb1${s}`, `wrist${s}`],
    [`thumb2${s}`, `thumb1${s}`],
    [`thumb3${s}`, `thumb2${s}`],
    ...["index", "middle", "ring", "pinky"].flatMap((f) => [
      [`${f}1${s}`, `wrist${s}`],
      [`${f}2${s}`, `${f}1${s}`],
      [`${f}3${s}`, `${f}2${s}`],
    ]),
  ]),
];

const FINGER_NAMES = ["index", "middle", "ring", "pinky"];
/** Bones found in the hand pass rather than by plane + capsule. */
const HAND_BONE = /^(thumb|index|middle|ring|pinky)/;
/** Where the knuckles are, as a fraction of wrist -> fingertip. */
const KNUCKLE_AT = 0.52;

/** Rounds of neighbour averaging applied to the skin weights. */
const SMOOTH_ITERATIONS = Number(process.env.RIG_SMOOTH ?? 12);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.sqrt(dot(a, a));
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a) => mul(a, 1 / (len(a) || 1));
const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Distance from p to segment ab. */
function segDist(p, a, b) {
  const ab = sub(b, a);
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / dot(ab, ab)));
  return len(sub(p, add(a, mul(ab, t))));
}

/**
 * Fit the skeleton and compute weights.
 * @param {Float32Array} pos  xyz positions
 * @param {Uint32Array} index triangle indices
 * @returns {{ joints: Record<string, number[]>, tips: Record<string, number[]>,
 *   jointIdx: Uint8Array, weights: Float32Array, stats: object }}
 */
export function rigMesh(pos, index) {
  const n = pos.length / 3;
  const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos[i * 3 + k]);
      max[k] = Math.max(max[k], pos[i * 3 + k]);
    }
  const H = max[1] - min[1];
  const floor = min[1];
  const atH = (f) => floor + f * H;

  // ---- 1. slices -> runs of occupied x cells -----------------------------
  const SLICES = 200;
  const CELL = H / 300;
  const cellsX = Math.ceil((max[0] - min[0]) / CELL) + 1;
  const sliceOf = (y) =>
    Math.min(SLICES - 1, Math.floor(((y - floor) / H) * SLICES));
  const occ = Array.from({ length: SLICES }, () => new Uint8Array(cellsX));
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3];
    occ[sliceOf(pos[i * 3 + 1])][Math.floor((x - min[0]) / CELL)] = 1;
  }
  const runsOf = (s) => {
    const runs = [];
    let start = -1;
    for (let c = 0; c <= cellsX; c++) {
      const on = c < cellsX && occ[s][c];
      if (on && start < 0) start = c;
      if (!on && start >= 0) {
        runs.push([min[0] + start * CELL, min[0] + c * CELL]);
        start = -1;
      }
    }
    // The scan's vertex spacing leaves pinholes in a thin slice; a real
    // gap (between an arm and the torso, or the legs) is wider than this.
    const merged = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      if (last && r[0] - last[1] < 0.008 * H) last[1] = r[1];
      else merged.push([...r]);
    }
    return merged;
  };
  const sliceY = (s) => floor + ((s + 0.5) / SLICES) * H;

  // A slice crosses both arms when, outside the run covering the midline
  // (the torso), each side's outermost run is arm-thin.
  const hasArms = (r) => {
    const torso = r.findIndex(([a, b]) => a <= 0 && b >= 0);
    if (torso <= 0 || torso >= r.length - 1) return false;
    const thin = ([a, b]) => b - a < 0.09 * H;
    return thin(r[0]) && thin(r[r.length - 1]);
  };
  // Armpit: the highest slice (scanning down from the shoulders) where
  // both arms are separate runs from the torso.
  let armpitS = -1;
  for (let s = Math.floor(SLICES * 0.8); s > SLICES * 0.4; s--) {
    if (hasArms(runsOf(s))) {
      armpitS = s;
      break;
    }
  }
  if (armpitS < 0) throw new Error("Could not find the armpits (not A-pose?)");
  // Crotch: the highest slice (below the waist) where nothing covers the
  // midline, i.e. the legs have separated.
  let crotchS = -1;
  for (let s = Math.floor(SLICES * 0.55); s > SLICES * 0.2; s--) {
    if (!runsOf(s).some(([a, b]) => a <= 0 && b >= 0)) {
      crotchS = s;
      break;
    }
  }
  if (crotchS < 0) throw new Error("Could not find the crotch");
  const armpitY = sliceY(armpitS);
  const crotchY = sliceY(crotchS);

  // ---- 2. limb centrelines ----------------------------------------------
  // Arm vertices: in an arm slice, outside the innermost edge of the
  // outermost run. Collect per side for the upper-arm line fit.
  const sideOf = (side) => (side === "L" ? 1 : -1); // +X is the figure's left
  // Follow each arm down from the armpit while it stays a separate
  // outermost run; below the fingertips the outermost run would be a leg,
  // which shows up as a sudden jump towards the centre.
  const armRunEdge = new Map(); // slice -> {L: innerEdgeX, R: innerEdgeX}
  let prev = null;
  for (let s = armpitS; s >= 0; s--) {
    const r = runsOf(s);
    if (r.length < 3) continue; // arm touching the torso near the armpit
    const [lo, hi] = [r[0], r[r.length - 1]];
    const c = { L: (hi[0] + hi[1]) / 2, R: (lo[0] + lo[1]) / 2 };
    if (
      prev &&
      (Math.abs(c.L - prev.L) > 0.03 * H || Math.abs(c.R - prev.R) > 0.03 * H)
    )
      break;
    prev = c;
    armRunEdge.set(s, { L: hi[0], R: lo[1] });
  }
  const isArmVertex = (i, side) => {
    const e = armRunEdge.get(sliceOf(pos[i * 3 + 1]));
    if (!e) return false;
    return side === "L" ? pos[i * 3] >= e.L : pos[i * 3] <= e.R;
  };

  const joints = {};
  const tips = {};
  const armRadius = {};
  for (const side of ["L", "R"]) {
    const armBand = (y0, y1) => {
      const acc = [0, 0, 0];
      let k = 0;
      for (let i = 0; i < n; i++) {
        const y = pos[i * 3 + 1];
        if (y < y0 || y > y1 || !isArmVertex(i, side)) continue;
        acc[0] += pos[i * 3];
        acc[1] += y;
        acc[2] += pos[i * 3 + 2];
        k++;
      }
      return mul(acc, 1 / k);
    };
    // Upper-arm centreline through two cross-sections below the armpit.
    const a = armBand(armpitY - 0.04 * H, armpitY - 0.02 * H);
    const b = armBand(armpitY - 0.12 * H, armpitY - 0.1 * H);
    const u = norm(sub(b, a));
    const shoulderY = armpitY + 0.05 * H;
    const shoulder = add(a, mul(u, (shoulderY - a[1]) / u[1]));
    // Upper-arm thickness (95th percentile distance from the centreline),
    // so the arm's region can hug it below the armpit, where the chest is
    // close (closer on the female scan).
    const radii = [];
    for (let i = 0; i < n; i++) {
      const y = pos[i * 3 + 1];
      if (y < armpitY - 0.12 * H || y > armpitY - 0.02 * H) continue;
      if (!isArmVertex(i, side)) continue;
      const d = sub(P(i), a);
      radii.push(len(sub(d, mul(u, dot(d, u)))));
    }
    radii.sort((x, y) => x - y);
    armRadius[side] = radii[Math.floor(radii.length * 0.95)];
    let tip = null;
    // Fingertip = furthest arm vertex along the arm from the shoulder.
    let best = -Infinity;
    for (let i = 0; i < n; i++) {
      if (!isArmVertex(i, side)) continue;
      const d = len(sub(P(i), shoulder));
      if (d > best) {
        best = d;
        tip = P(i);
      }
    }
    const L = best;
    // Elbow and wrist: centroids of thin cross-sections at anthropometric
    // fractions of shoulder->fingertip (upper arm .186H, forearm .146H,
    // hand .108H), so they sit on the limb's centre even if it bends.
    const axis = norm(sub(tip, shoulder));
    const section = (f) => {
      const acc = [0, 0, 0];
      let k = 0;
      for (let i = 0; i < n; i++) {
        if (!isArmVertex(i, side)) continue;
        const t = dot(sub(P(i), shoulder), axis) / L;
        if (Math.abs(t - f) < 0.015) {
          const p = P(i);
          acc[0] += p[0];
          acc[1] += p[1];
          acc[2] += p[2];
          k++;
        }
      }
      return mul(acc, 1 / k);
    };
    joints[`shoulder${side}`] = shoulder;
    joints[`elbow${side}`] = section(0.186 / 0.44);
    joints[`wrist${side}`] = section(0.332 / 0.44);
    tips[`wrist${side}`] = tip;
    void sideOf;
  }

  // Legs: the two central runs below the crotch.
  for (const side of ["L", "R"]) {
    const legPts = (y0, y1) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const y = pos[i * 3 + 1];
        if (y < y0 || y > y1) continue;
        const x = pos[i * 3];
        if (side === "L" ? x <= 0 : x >= 0) continue;
        if (Math.abs(x) > 0.15 * H) continue; // hands hang out here
        out.push(P(i));
      }
      return out;
    };
    const centroid = (pts) => mul(pts.reduce(add, [0, 0, 0]), 1 / pts.length);
    // Thigh centreline through two cross-sections below the crotch.
    const a = centroid(legPts(crotchY - 0.04 * H, crotchY - 0.03 * H));
    const b = centroid(legPts(crotchY - 0.14 * H, crotchY - 0.13 * H));
    const u = norm(sub(b, a));
    const hipY = crotchY + 0.04 * H;
    joints[`hip${side}`] = add(a, mul(u, (hipY - a[1]) / u[1]));
    const knee = centroid(legPts(atH(0.28), atH(0.29)));
    joints[`knee${side}`] = knee;
    const ankle = centroid(legPts(atH(0.06), atH(0.07)));
    // Foot tip: the most forward vertex near the floor on this side.
    let toe = null;
    for (const p of legPts(floor, atH(0.05)))
      if (!toe || p[2] > toe[2]) toe = p;
    joints[`ankle${side}`] = ankle;
    tips[`knee${side}`] = toe; // version 1 rigs end the leg here
    tips[`ankle${side}`] = toe;
  }

  // Trunk: waist (spine pivot) and neck from horizontal sections.
  const trunkSection = (y) => {
    const acc = [0, 0, 0];
    let k = 0;
    for (let i = 0; i < n; i++) {
      const p = P(i);
      if (Math.abs(p[1] - y) > 0.004 * H || Math.abs(p[0]) > 0.12 * H) continue;
      acc[0] += p[0];
      acc[1] += p[1];
      acc[2] += p[2];
      k++;
    }
    const c = mul(acc, 1 / k);
    return [0, y, c[2]];
  };
  let top = null;
  for (let i = 0; i < n; i++) if (!top || pos[i * 3 + 1] > top[1]) top = P(i);
  const hipMidY = (joints.hipL[1] + joints.hipR[1]) / 2;
  joints.pelvis = trunkSection(hipMidY);
  joints.spine = trunkSection(atH(0.6));
  joints.neck = trunkSection(atH(0.855));
  tips.neck = top;
  tips.spine = top;

  if (process.env.RIG_DEBUG) console.log({ H, armpitY, crotchY, joints, tips });
  // ---- 3. regions -------------------------------------------------------
  // Adjacency (CSR) for connectivity.
  const deg = new Uint32Array(n + 1);
  for (let t = 0; t < index.length; t += 3)
    for (let e = 0; e < 3; e++) deg[index[t + e] + 1] += 2;
  for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
  const adj = new Uint32Array(deg[n]);
  const fill = deg.slice(0, n);
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
    adj[fill[a]++] = b;
    adj[fill[a]++] = c;
    adj[fill[b]++] = a;
    adj[fill[b]++] = c;
    adj[fill[c]++] = a;
    adj[fill[c]++] = b;
  }
  const nearest = (p) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = len(sub(P(i), p));
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };

  // Per bone: joint plane (point + distal normal), capsule chain for
  // eligibility, blend half-width, and the seed vertex for connectivity.
  const parentOf = Object.fromEntries(BONES);
  const capsules = {};
  const dirs = {};
  const blend = {};
  const seeds = {};
  for (const s of ["L", "R"]) {
    const [sh, el, wr, tip] = [
      joints[`shoulder${s}`],
      joints[`elbow${s}`],
      joints[`wrist${s}`],
      tips[`wrist${s}`],
    ];
    const armCaps = [
      // Generous above the armpit (the deltoid must follow the arm),
      // tight below it (the chest must not).
      [sh, el, 0.055 * H, { belowY: armpitY, r: armRadius[s] * 1.25 }],
      [el, wr, 0.045 * H],
      [wr, tip, 0.045 * H],
    ];
    capsules[`shoulder${s}`] = armCaps;
    capsules[`elbow${s}`] = armCaps.slice(1);
    capsules[`wrist${s}`] = armCaps.slice(2);
    dirs[`shoulder${s}`] = norm(sub(el, sh));
    dirs[`elbow${s}`] = norm(sub(wr, el));
    dirs[`wrist${s}`] = norm(sub(tip, wr));
    blend[`shoulder${s}`] = 0.025 * H;
    blend[`elbow${s}`] = 0.025 * H;
    blend[`wrist${s}`] = 0.015 * H;
    for (const b of ["shoulder", "elbow", "wrist"])
      seeds[`${b}${s}`] = nearest(tip);

    const [hp, kn, an, toe] = [
      joints[`hip${s}`],
      joints[`knee${s}`],
      joints[`ankle${s}`],
      tips[`knee${s}`],
    ];
    const legCaps = [
      [hp, kn, 0.075 * H],
      [kn, an, 0.05 * H],
      [an, toe, 0.05 * H],
    ];
    capsules[`hip${s}`] = legCaps;
    capsules[`knee${s}`] = legCaps.slice(1);
    capsules[`ankle${s}`] = legCaps.slice(2);
    dirs[`hip${s}`] = norm(sub(kn, hp));
    dirs[`knee${s}`] = norm(sub(an, kn));
    // The foot: everything below the ankle, heel included.
    dirs[`ankle${s}`] = norm(sub(an, kn));
    blend[`hip${s}`] = 0.04 * H;
    blend[`knee${s}`] = 0.025 * H;
    blend[`ankle${s}`] = 0.012 * H;
    seeds[`hip${s}`] = seeds[`knee${s}`] = seeds[`ankle${s}`] = nearest(toe);
  }
  dirs.spine = [0, 1, 0];
  dirs.neck = [0, 1, 0];
  blend.spine = 0.05 * H;
  blend.neck = 0.025 * H;
  capsules.spine = null; // everything above the waist connected to the head
  capsules.neck = [[joints.neck, top, 0.1 * H]];
  seeds.spine = seeds.neck = nearest(top);

  // Signed distance past a bone's cut plane (positive = the bone's side).
  const signed = (b, p) => dot(sub(p, joints[b]), dirs[b]);
  const inCapsule = ([a, c, r, below], p) =>
    segDist(p, a, c) < (below && p[1] < below.belowY ? below.r : r);
  const inCapsules = (b, p) =>
    capsules[b] === null || capsules[b].some((cap) => inCapsule(cap, p));

  // Below the armpit, the slices already say exactly which vertices are
  // arm (a run separate from the torso): use that for the upper arm
  // instead of a capsule, which on a slim figure either misses the inner
  // arm or grabs the side of the chest. Null = no slice information
  // (above the armpit, or where the arm touches the torso).
  const armClass = (b, i) => {
    if (!b.startsWith("shoulder")) return null;
    if (pos[i * 3 + 1] >= armpitY) return null;
    if (!armRunEdge.has(sliceOf(pos[i * 3 + 1]))) return null;
    return isArmVertex(i, b.endsWith("L") ? "L" : "R");
  };

  const regions = {};
  for (const [b, parent] of BONES) {
    if (parent === null || HAND_BONE.test(b)) continue;
    // Limbs stay on their own side of the midline, so close-together
    // thighs don't claim each other's inner surface at the crotch.
    const side = b.endsWith("L") ? 1 : b.endsWith("R") ? -1 : 0;
    const ok = (i) => {
      const p = P(i);
      if (side * p[0] < 0) return false;
      if (signed(b, p) <= 0) return false;
      const arm = armClass(b, i);
      return arm === null ? inCapsules(b, p) : arm;
    };
    const inRegion = new Uint8Array(n);
    const seed = seeds[b];
    if (!ok(seed)) throw new Error(`Seed for ${b} is outside its region`);
    const stack = [seed];
    inRegion[seed] = 1;
    while (stack.length) {
      const v = stack.pop();
      for (let k = deg[v]; k < deg[v + 1]; k++) {
        const w = adj[k];
        if (!inRegion[w] && ok(w)) {
          inRegion[w] = 1;
          stack.push(w);
        }
      }
    }
    regions[b] = inRegion;
  }

  // Label each vertex with its deepest bone (BONES lists parents first).
  const boneIdx = Object.fromEntries(BONES.map(([b], i) => [b, i]));
  const label = new Uint8Array(n); // 0 = pelvis
  const depth = (b) => (parentOf[b] ? 1 + depth(parentOf[b]) : 0);
  const byDepth = BONES.map(([b]) => b)
    .filter((b) => parentOf[b])
    .sort((a, b) => depth(a) - depth(b));
  for (const b of byDepth) {
    const r = regions[b];
    if (!r) continue; // hand bones: see the hand pass
    for (let i = 0; i < n; i++) if (r[i]) label[i] = boneIdx[b];
  }

  // Orphans: a patch of vertices cut off from the main body of its own
  // label (a thumb sticking out past the hand's capsule keeps the root
  // label, but is surrounded by hand). Each label keeps its largest
  // connected patch; smaller patches take their neighbours' label.
  const orphan = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const patches = new Map(); // label -> [vertex lists]
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    const patch = [i];
    seen[i] = 1;
    for (let q = 0; q < patch.length; q++) {
      const v = patch[q];
      for (let k = deg[v]; k < deg[v + 1]; k++) {
        const w = adj[k];
        if (!seen[w] && label[w] === label[i]) {
          seen[w] = 1;
          patch.push(w);
        }
      }
    }
    (patches.get(label[i]) ?? patches.set(label[i], []).get(label[i])).push(
      patch,
    );
  }
  let orphans = 0;
  for (const list of patches.values()) {
    list.sort((a, b) => b.length - a.length);
    for (const patch of list.slice(1))
      for (const v of patch) {
        orphan[v] = 1;
        orphans++;
      }
  }
  const frontier = [];
  for (let i = 0; i < n; i++) {
    if (orphan[i]) continue;
    for (let k = deg[i]; k < deg[i + 1]; k++)
      if (orphan[adj[k]]) {
        frontier.push(i);
        break;
      }
  }
  for (let q = 0; q < frontier.length; q++) {
    const v = frontier[q];
    for (let k = deg[v]; k < deg[v + 1]; k++) {
      const w = adj[k];
      if (orphan[w]) {
        orphan[w] = 0;
        label[w] = label[v];
        frontier.push(w);
      }
    }
  }

  // ---- 3b. hands: thumb and four fingers ------------------------------
  // Some of the scan's fingers touch (the mesh fuses them), so a finger
  // can't be found by connectivity alone. The thumb is the piece that
  // splits away from the rest of the hand first; past the knuckles every
  // other vertex goes to a finger by where it lies *across* the hand,
  // where the four fingers form four bands. Where two fingers are fused,
  // the skin between them stretches a little when they move apart.
  const palm = {};
  const handStats = {};
  for (const s of ["L", "R"]) {
    const w = joints[`wrist${s}`];
    const handTip = tips[`wrist${s}`];
    const L = len(sub(handTip, w));
    const u = norm(sub(handTip, w));
    const wristLabel = boneIdx[`wrist${s}`];
    const hand = [];
    for (let i = 0; i < n; i++) if (label[i] === wristLabel) hand.push(i);
    const along = (i) => dot(sub(P(i), w), u);
    const tipV = nearest(handTip);

    // Connected pieces of the hand past `frac` of its length.
    const pieces = (frac) => {
      const mark = new Int32Array(n).fill(-1);
      const lists = [];
      for (const start of hand) {
        if (mark[start] >= 0 || along(start) <= frac * L) continue;
        const id = lists.length;
        const list = [start];
        mark[start] = id;
        for (let q = 0; q < list.length; q++) {
          const v = list[q];
          for (let k = deg[v]; k < deg[v + 1]; k++) {
            const x = adj[k];
            if (mark[x] < 0 && label[x] === wristLabel && along(x) > frac * L) {
              mark[x] = id;
              list.push(x);
            }
          }
        }
        lists.push(list);
      }
      return { lists, mark };
    };
    let thumb = null;
    for (let f = 0.3; f <= 0.62 && !thumb; f += 0.02) {
      const { lists, mark } = pieces(f);
      const main = mark[tipV] >= 0 ? lists[mark[tipV]] : null;
      if (!main) continue;
      const others = lists
        .filter((l) => l !== main && l.length > 0.01 * hand.length)
        .sort((a, b) => b.length - a.length);
      if (others.length) thumb = others[0];
    }
    if (!thumb) throw new Error(`No thumb found on the ${s} hand`);
    const isThumb = new Uint8Array(n);
    for (const i of thumb) isThumb[i] = 1;

    // Across the fingers: the main spread of the finger zone, square to
    // the hand's axis, pointing towards the thumb.
    const perp = (i) => {
      const d = sub(P(i), w);
      return sub(d, mul(u, dot(d, u)));
    };
    const zone = hand.filter(
      (i) => !isThumb[i] && along(i) > 0.6 * L && along(i) < 0.85 * L,
    );
    const m = mul(zone.map(perp).reduce(add, [0, 0, 0]), 1 / zone.length);
    const C = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (const i of zone) {
      const q = sub(perp(i), m);
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) C[r][c] += q[r] * q[c];
    }
    let across = norm([1, 0.4, 0.3]);
    for (let it = 0; it < 60; it++)
      across = norm([dot(C[0], across), dot(C[1], across), dot(C[2], across)]);
    const cOf = (i) => dot(perp(i), across);
    const mean = (list, fn) =>
      list.reduce((acc, i) => acc + fn(i), 0) / list.length;
    if (mean(thumb, cOf) < mean(zone, cOf)) across = mul(across, -1);
    // The palm faces the body's midline in the scan's A-pose.
    let normal = norm(cross(u, across));
    const sideSign = s === "L" ? 1 : -1;
    if (normal[0] * sideSign > 0) normal = mul(normal, -1);

    // Four bands across the hand, cut at the webs between the fingers.
    // Seen flat in the palm's plane, the hand's outline reaches out to a
    // fingertip and dips back at each web, even where two fingers are
    // fused, so the three deepest dips between the four longest reaches
    // are the cuts. (K-means on the vertices, tried first, drifted off
    // the fingers on the slimmer female hand.)
    const reach = hand.filter((i) => !isThumb[i] && along(i) > 0.5 * L);
    const cs = reach.map(cOf);
    const cLo = Math.min(...cs);
    const cHi = Math.max(...cs);
    const NB = 64;
    const profile = new Array(NB).fill(0);
    reach.forEach((i, k) => {
      const b = Math.min(
        NB - 1,
        Math.floor(((cs[k] - cLo) / (cHi - cLo)) * NB),
      );
      profile[b] = Math.max(profile[b], along(i) / L);
    });
    const smooth = profile.map((_, b) => {
      let acc = 0;
      let n0 = 0;
      for (let d = -1; d <= 1; d++)
        if (profile[b + d] !== undefined) {
          acc += profile[b + d];
          n0++;
        }
      return acc / n0;
    });
    const minGap = Math.ceil((0.08 * L) / ((cHi - cLo) / NB));
    const peaks = [];
    // Only real tops count: a bin on the side of a long finger can be
    // higher than the short little finger's tip.
    const isTop = (b) =>
      [-2, -1, 1, 2].every(
        (d) => smooth[b + d] === undefined || smooth[b] >= smooth[b + d],
      );
    for (const b of [...smooth.keys()].sort((x, y) => smooth[y] - smooth[x])) {
      if (peaks.length === 4) break;
      if (isTop(b) && peaks.every((p) => Math.abs(p - b) >= minGap))
        peaks.push(b);
    }
    if (peaks.length < 4)
      throw new Error(`Found ${peaks.length} fingertips on the ${s} hand`);
    peaks.sort((x, y) => x - y);
    const cutBins = [0, 1, 2].map((k) => {
      let best = peaks[k] + 1;
      for (let b = peaks[k] + 1; b < peaks[k + 1]; b++)
        if (smooth[b] < smooth[best]) best = b;
      return best;
    });
    const cuts = cutBins.map((b) => cLo + ((b + 0.5) / NB) * (cHi - cLo));
    const centers = peaks.map((b) => cLo + ((b + 0.5) / NB) * (cHi - cLo));
    // 0 = index (highest, towards the thumb) .. 3 = little finger.
    const fingerOf = (i) => {
      const c = cOf(i);
      return c > cuts[2] ? 0 : c > cuts[1] ? 1 : c > cuts[0] ? 2 : 3;
    };

    const centroid = (list) =>
      mul(list.map(P).reduce(add, [0, 0, 0]), 1 / Math.max(1, list.length));
    const fingerJoints = [];
    FINGER_NAMES.forEach((name, f) => {
      const verts = hand.filter(
        (i) => !isThumb[i] && along(i) > 0.45 * L && fingerOf(i) === f,
      );
      let tipI = verts[0];
      for (const i of verts) if (along(i) > along(tipI)) tipI = i;
      const tip = P(tipI);
      // Knuckle: a cross-section where the finger leaves the palm.
      const mcp = centroid(
        verts.filter((i) => Math.abs(along(i) / L - KNUCKLE_AT) < 0.02),
      );
      const df = norm(sub(tip, mcp));
      const Lf = len(sub(tip, mcp));
      const at = (t) =>
        centroid(
          verts.filter(
            (i) => Math.abs(dot(sub(P(i), mcp), df) / Lf - t) < 0.04,
          ),
        );
      // Phalanx lengths roughly 1 : 0.6 : 0.45 of the finger.
      const pip = at(0.49);
      const dip = at(0.78);
      joints[`${name}1${s}`] = mcp;
      joints[`${name}2${s}`] = pip;
      joints[`${name}3${s}`] = dip;
      tips[`${name}3${s}`] = tip;
      fingerJoints.push([mcp, pip, dip, tip]);
    });

    // Thumb: from where its piece leaves the hand to its far end.
    let tTip = thumb[0];
    for (const i of thumb)
      if (len(sub(P(i), w)) > len(sub(P(tTip), w))) tTip = i;
    const thumbTip = P(tTip);
    const byDist = [...thumb].sort(
      (a, b) => len(sub(P(a), w)) - len(sub(P(b), w)),
    );
    const base = centroid(
      byDist.slice(0, Math.max(10, Math.floor(0.15 * thumb.length))),
    );
    const dT = norm(sub(thumbTip, base));
    const LT = len(sub(thumbTip, base));
    const ip = centroid(
      thumb.filter(
        (i) => Math.abs(dot(sub(P(i), base), dT) / LT - 0.55) < 0.06,
      ),
    );
    // Its base joint sits inside the palm, a third of the way to the wrist.
    const cmc = add(w, mul(sub(base, w), 0.35));
    joints[`thumb1${s}`] = cmc;
    joints[`thumb2${s}`] = base;
    joints[`thumb3${s}`] = ip;
    tips[`thumb3${s}`] = thumbTip;

    // Labels within the hand.
    const idx = (b) => boneIdx[`${b}${s}`];
    const dCmc = norm(sub(base, cmc));
    for (const i of hand) {
      const p = P(i);
      if (isThumb[i]) {
        label[i] = dot(sub(p, ip), dT) > 0 ? idx("thumb3") : idx("thumb2");
        continue;
      }
      // The ball of the thumb belongs to the thumb's base joint.
      if (
        cOf(i) > cuts[2] &&
        dot(sub(p, cmc), dCmc) > 0 &&
        segDist(p, cmc, base) < 0.16 * L
      ) {
        label[i] = idx("thumb1");
        continue;
      }
      if (along(i) < 0.45 * L) continue; // palm
      const f = fingerOf(i);
      const [j1, j2, j3, tip] = fingerJoints[f];
      const name = FINGER_NAMES[f];
      label[i] =
        dot(sub(p, j3), norm(sub(tip, j3))) > 0
          ? idx(`${name}3`)
          : dot(sub(p, j2), norm(sub(j3, j2))) > 0
            ? idx(`${name}2`)
            : dot(sub(p, j1), norm(sub(j2, j1))) > 0
              ? idx(`${name}1`)
              : wristLabel;
    }

    // Joint planes, blends and capsules for the weights pass.
    const bone = (b, j, next, r, bl) => {
      dirs[`${b}${s}`] = norm(sub(next, j));
      blend[`${b}${s}`] = bl * H;
      capsules[`${b}${s}`] = [[j, next, r * H]];
    };
    FINGER_NAMES.forEach((name, f) => {
      const [j1, j2, j3, tip] = fingerJoints[f];
      bone(`${name}1`, j1, j2, 0.012, 0.005);
      bone(`${name}2`, j2, j3, 0.01, 0.004);
      bone(`${name}3`, j3, tip, 0.01, 0.003);
    });
    bone("thumb1", cmc, base, 0.03, 0.008);
    bone("thumb2", base, ip, 0.012, 0.005);
    bone("thumb3", ip, thumbTip, 0.011, 0.004);
    palm[s] = { normal, thumb: across };
    handStats[s] = {
      thumb: thumb.length,
      bands: centers.map((c) => +(c / L).toFixed(3)),
    };
  }

  // ---- 4. weights -------------------------------------------------------
  const childrenOf = {};
  for (const [b, parent] of BONES)
    if (parent) (childrenOf[parent] ??= []).push(b);
  const jointIdx = new Uint8Array(n * 4);
  const weights = new Float32Array(n * 4);
  const counts = new Uint32Array(BONES.length);
  const B = BONES.length;
  let dense = new Float32Array(n * B);
  for (let i = 0; i < n; i++) {
    const p = P(i);
    const b = BONES[label[i]][0];
    const w = new Map([[b, 1]]);
    const parent = parentOf[b];
    if (parent) {
      // Across this bone's own joint: blend towards the parent.
      const t = smoothstep(-blend[b], blend[b], signed(b, p));
      w.set(b, t);
      w.set(parent, (w.get(parent) ?? 0) + 1 - t);
    }
    for (const c of childrenOf[b] ?? []) {
      // Just before a child's joint, start handing over to the child.
      const s = signed(c, p);
      if (s <= -blend[c] || s > 0) continue;
      const arm = armClass(c, i);
      if (arm === false) continue;
      if (arm === null && capsules[c] !== null && !inCapsule(capsules[c][0], p))
        continue;
      const t = smoothstep(-blend[c], blend[c], s);
      for (const [k, v] of w) w.set(k, v * (1 - t));
      w.set(c, (w.get(c) ?? 0) + t);
    }
    for (const [k, v] of w) dense[i * B + boneIdx[k]] = v;
    counts[label[i]]++;
  }

  // Smooth the weights over the mesh. Region edges that run along a
  // capsule (rather than across a joint plane) are a hard 0 -> 1 step
  // from one vertex to the next, which tears into spikes when the joint
  // turns far; a few rounds of neighbour averaging turn every step into
  // a short ramp, so the surface stretches like skin instead.
  let next = new Float32Array(dense.length);
  for (let it = 0; it < SMOOTH_ITERATIONS; it++) {
    for (let v = 0; v < n; v++) {
      const k0 = deg[v];
      const k1 = deg[v + 1];
      const inv = 1 / (k1 - k0 || 1);
      for (let b = 0; b < B; b++) {
        let acc = 0;
        for (let k = k0; k < k1; k++) acc += dense[adj[k] * B + b];
        next[v * B + b] = 0.5 * dense[v * B + b] + 0.5 * acc * inv;
      }
    }
    [dense, next] = [next, dense];
  }

  for (let i = 0; i < n; i++) {
    const top4 = [];
    for (let b = 0; b < B; b++)
      if (dense[i * B + b] > 1e-3) top4.push([b, dense[i * B + b]]);
    top4.sort((x, y) => y[1] - x[1]);
    top4.length = Math.min(top4.length, 4);
    const sum = top4.reduce((a, [, v]) => a + v, 0);
    top4.forEach(([b, v], j) => {
      jointIdx[i * 4 + j] = b;
      weights[i * 4 + j] = v / sum;
    });
  }

  const stats = {
    H,
    orphans,
    armpitY,
    crotchY,
    armRadius,
    labelCounts: Object.fromEntries(BONES.map(([b], k) => [b, counts[k]])),
    hands: handStats,
  };
  if (process.env.RIG_LABELS) stats.label = label; // debug: per-vertex bone
  return { joints, tips, palm, jointIdx, weights, stats };
}
