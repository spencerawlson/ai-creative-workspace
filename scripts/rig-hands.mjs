// Finds a hand's thumb and fingers on a welded mesh, whichever way the
// hand faces (palm to the thigh, palm down, fingers spread or together).
//
// scripts/rig-mannequin.mjs finds fingers by where they lie across the
// hand, which assumes the scanned mannequin's pose (palm towards the
// body, fingers hanging). Meshy's characters hold their hands every
// which way, so there it finds no thumb, or too few fingers, and leaves
// the hand rigid. This works on the surface instead:
//
// 1. The hand: the skin past the wrist, connected to the hand's tip.
// 2. Distance along the skin from the wrist (Dijkstra over mesh edges).
// 3. Sweep from the farthest skin back towards the wrist, joining each
//    vertex to its already-swept neighbours (union-find). Every finger
//    starts as its own piece at its tip and stays apart until it meets
//    the palm at its knuckle, where it joins a longer piece. A finger
//    is a piece that lasted (tip distance − knuckle distance) at least
//    a fifth of the hand's length; bumps and nails don't.
// 4. Each finger's centre line: the middle of each band of its skin at
//    equal distance from the wrist (each band is a ring around it).
// 5. The thumb meets the palm nearest the wrist; the others are ordered
//    across the hand from the thumb: index, middle, ring, little.
//
// Joints go along each centre line at the phalanges' proportions.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.sqrt(dot(a, a));

/** Neighbours of every vertex (CSR) from a triangle index. */
export function adjacency(n, index) {
  const sets = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < index.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = index[t + k];
      const b = index[t + ((k + 1) % 3)];
      sets[a].add(b);
      sets[b].add(a);
    }
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + sets[i].size;
  const col = new Int32Array(start[n]);
  for (let i = 0; i < n; i++) {
    let k = start[i];
    for (const j of sets[i]) col[k++] = j;
  }
  return { start, col };
}

// Proportions measured on the app's hand-checked mannequin rig
// (public/models), as fractions of the wrist-to-middle-fingertip length;
// left and right agree to 0.01.
/** Knuckles' distance from the wrist: index, middle, ring, little. */
const KNUCKLE_FROM = [0.55, 0.54, 0.57, 0.6];
/** The thumb's first joint (its base, near the wrist). */
const THUMB_FROM = 0.16;
/** Joints along a finger, knuckle to tip: its bones are 48%, 30% and
 * 22% of it. */
const FINGER_AT = [0, 0.48, 0.78];
/** The thumb's three bones: 52%, 26%, 22%. */
const THUMB_AT = [0, 0.52, 0.78];

/**
 * @param {ArrayLike<number>} pos  x, y, z per vertex (welded mesh)
 * @param {{start: Int32Array, col: Int32Array}} adj
 * @param {number[]} wrist  the wrist joint
 * @param {number[]} tip    a point at the hand's far end (past the
 *   fingers), from the body pass
 * @returns {{ thumb, fingers: [index, middle, ring, little], extra }}
 *   each a { joints: [j1, j2, j3], tip } in mesh space, or null when
 *   the hand doesn't show a thumb and four fingers. `extra` counts
 *   finger-like pieces beyond five (left to the nearest bones).
 */
export function findFingers(pos, adj, wrist, tip, elbow) {
  const n = pos.length / 3;
  const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const L = len(sub(tip, wrist));
  // The wrist cut is square to the forearm, not to the hand: a thumb
  // swept back past the hand's own direction stays on the hand.
  const fore = sub(wrist, elbow);
  const u = fore.map((v) => v / len(fore));
  const along = (i) => dot(sub(P(i), wrist), u);
  const { start, col } = adj;

  // 1. The hand: past the wrist plane, connected to the vertex nearest
  //    the tip.
  let seed = -1;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const d = len(sub(P(i), tip));
    if (d < best) {
      best = d;
      seed = i;
    }
  }
  const inHand = new Uint8Array(n);
  const hand = [seed];
  inHand[seed] = 1;
  for (let q = 0; q < hand.length; q++) {
    const v = hand[q];
    for (let k = start[v]; k < start[v + 1]; k++) {
      const w = col[k];
      if (!inHand[w] && along(w) > 0 && len(sub(P(w), wrist)) < 1.6 * L) {
        inHand[w] = 1;
        hand.push(w);
      }
    }
  }

  // 2. Distance along the skin from the wrist cut.
  const dist = new Float64Array(n).fill(Infinity);
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
      for (let i = 0; ;) {
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
  for (const v of hand)
    for (let k = start[v]; k < start[v + 1]; k++)
      if (!inHand[col[k]]) {
        dist[v] = 0;
        push(0, v);
        break;
      }
  while (heap.length) {
    const [d, v] = pop();
    if (d > dist[v]) continue;
    for (let k = start[v]; k < start[v + 1]; k++) {
      const w = col[k];
      if (!inHand[w]) continue;
      const nd = d + len(sub(P(w), P(v)));
      if (nd < dist[w]) {
        dist[w] = nd;
        push(nd, w);
      }
    }
  }
  const reach = hand.filter((v) => Number.isFinite(dist[v]));
  const far = Math.max(...reach.map((v) => dist[v]));

  // 3. Sweep from far to near; pieces that last are fingers.
  const parent = new Int32Array(n).fill(-1);
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const birth = new Map(); // root -> its tip's distance
  const tipOf = new Map(); // root -> its tip vertex
  const members = new Map(); // root -> vertices
  const pieces = []; // { tip, birth, death, verts }
  const order = [...reach].sort((a, b) => dist[b] - dist[a]);
  for (const v of order) {
    parent[v] = v;
    birth.set(v, dist[v]);
    tipOf.set(v, v);
    members.set(v, [v]);
    for (let k = start[v]; k < start[v + 1]; k++) {
      const w = col[k];
      if (parent[w] < 0) continue;
      const a = find(v);
      const b = find(w);
      if (a === b) continue;
      // The piece born nearer the wrist (the shorter) ends here.
      const [keep, end] = birth.get(a) >= birth.get(b) ? [a, b] : [b, a];
      pieces.push({
        tip: tipOf.get(end),
        birth: birth.get(end),
        death: dist[v],
        verts: members.get(end),
      });
      parent[end] = keep;
      const into = members.get(keep);
      for (const x of members.get(end)) into.push(x);
      members.delete(end);
    }
  }
  const roots = [...members.keys()];
  const main = roots.sort((a, b) => birth.get(b) - birth.get(a))[0];
  // A finger pressed against its neighbour only comes apart near its
  // tip, so it lasts as little as 7% of the hand; bumps and nails last
  // under 3%.
  const minLife = 0.05 * L;
  if (process.env.RIG_HANDS_DEBUG)
    console.log(
      `  hand L=${L.toFixed(3)} far=${far.toFixed(3)} verts=${reach.length} pieces (life/L, knuckle/L):`,
      pieces
        .map((p) => [(p.birth - p.death) / L, p.death / L, p.verts.length])
        .sort((a, b) => b[0] - a[0])
        .slice(0, 9)
        .map(([l, d, c]) => `${l.toFixed(2)}@${d.toFixed(2)}(${c})`)
        .join(" "),
      `main tip ${(birth.get(main) / L).toFixed(2)}`,
    );
  const fingersOnly = pieces
    .filter((p) => p.birth - p.death >= minLife)
    .sort((a, b) => b.birth - b.death - (a.birth - a.death));
  const extra = Math.max(0, fingersOnly.length + 1 - 5);
  if (fingersOnly.length < 4)
    return { thumb: null, fingers: null, extra, found: fingersOnly.length + 1 };
  // The four that lasted longest besides the longest finger (which never
  // ends: it is the piece the others joined). Of the five, the thumb
  // meets the palm nearest the wrist.
  const four = fingersOnly.slice(0, 4).sort((a, b) => a.death - b.death);
  const thumbPiece = four[0];
  const others = four.slice(1);
  // The knuckles lie at about one distance from the wrist. A finger
  // pressed against its neighbour parts from it only near its tip, so
  // its own knuckle is taken at the others' (the middle one).
  const knuckleAt = [...others.map((p) => p.death)].sort((a, b) => a - b)[1];
  const claimed = new Uint8Array(n);
  for (const p of four) for (const v of p.verts) claimed[v] = 1;
  const mainPiece = {
    tip: tipOf.get(main),
    birth: birth.get(main),
    death: knuckleAt,
    verts: reach.filter((v) => !claimed[v] && dist[v] >= knuckleAt),
  };

  // 4. Centre lines: ring middles at equal distances.
  const line = (p) => {
    const bands = 12;
    const span = p.birth - p.death;
    const sums = Array.from({ length: bands }, () => [0, 0, 0, 0]);
    for (const v of p.verts) {
      const b = Math.min(
        bands - 1,
        Math.floor(((dist[v] - p.death) / span) * bands),
      );
      if (b < 0) continue;
      const q = P(v);
      sums[b][0] += q[0];
      sums[b][1] += q[1];
      sums[b][2] += q[2];
      sums[b][3]++;
    }
    const pts = sums
      .filter((s) => s[3] > 0)
      .map((s) => [s[0] / s[3], s[1] / s[3], s[2] / s[3]]);
    // Out to the tip itself.
    pts.push(P(p.tip));
    // A finger that parted late: carry its line straight back to the
    // knuckles' distance.
    const short = p === thumbPiece ? 0 : p.death - knuckleAt;
    if (short > 0.04 * L && pts.length >= 2) {
      const d = sub(pts[pts.length - 1], pts[0]);
      const dl = len(d) || 1;
      pts.unshift(pts[0].map((v, k) => v - (d[k] / dl) * short));
    }
    return pts;
  };
  const atFraction = (pts, f) => {
    const seg = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const l = len(sub(pts[i], pts[i - 1]));
      seg.push(l);
      total += l;
    }
    let want = f * total;
    for (let i = 0; i < seg.length; i++) {
      if (want <= seg[i] || i === seg.length - 1) {
        const t = seg[i] > 0 ? Math.min(1, want / seg[i]) : 0;
        return pts[i].map((v, k) => v + (pts[i + 1][k] - v) * t);
      }
      want -= seg[i];
    }
    return pts[pts.length - 1];
  };

  // 5. Index to little finger, across the hand from the thumb.
  const rest = [...others, mainPiece];
  const five = [thumbPiece, ...rest];
  const lines = new Map(five.map((p) => [p, line(p)]));
  const knuckle = (p) => lines.get(p)[0];
  const t0 = knuckle(thumbPiece);
  rest.sort((a, b) => len(sub(knuckle(a), t0)) - len(sub(knuckle(b), t0)));
  // Where a finger parts from its neighbours (the web) is past its
  // knuckle, which sits inside the palm. So each chain starts at the
  // knuckle's distance from the wrist, on the line from the wrist
  // through where the finger parts, then follows the finger's centre
  // line to its tip; the joints split that at the bones' proportions.
  const handLength = len(sub(P(rest[1].tip), wrist)); // to the middle fingertip
  const chain = (p, from, at) => {
    const pts = lines.get(p);
    const towards = sub(pts[0], wrist);
    const k = from * handLength;
    const start = wrist.map(
      (v, i) => v + (towards[i] / (len(towards) || 1)) * k,
    );
    // Skip centre-line points nearer the wrist than the knuckle.
    const beyond = pts.filter((q) => len(sub(q, wrist)) > k);
    const path = [start, ...(beyond.length ? beyond : [P(p.tip)])];
    return {
      joints: at.map((f) => atFraction(path, f)),
      tip: P(p.tip),
      // Where the finger shows (parts from the palm): its first bone's
      // skin starts here; the palm behind it belongs to the hand.
      shows: beyond.length ? beyond[0] : start,
    };
  };
  return {
    thumb: chain(thumbPiece, THUMB_FROM, THUMB_AT),
    fingers: rest.map((p, i) => chain(p, KNUCKLE_FROM[i], FINGER_AT)),
    extra,
    found: fingersOnly.length + 1,
  };
}
