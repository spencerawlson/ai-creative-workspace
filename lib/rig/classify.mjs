/** What kind of body a model is, from its shape alone, so the platform
 * can rig it the right way: upright on two feet (a human, or an ape:
 * scripts/auto-rig.mjs tells them apart by arm reach), a quadruped, a
 * small two-legged animal (birds, rodents up on their hind legs), or
 * something without clear feet (a fish, a snake: no walking rig).
 *
 * The model stands on +Y (glTF's up) and may face any way along the
 * floor. Two measures decide, both checked on the app's 18 built-in
 * models (tests/unit/rig-classify.test.ts):
 * - feet: separate patches of the model on the floor (the lowest 4% of
 *   its height), each holding a fair share of the floor contact; a tail
 *   tip resting on the floor is a small patch and doesn't count;
 * - stance: height over the longest horizontal extent (found by PCA,
 *   whichever way the model faces). Upright figures are taller than
 *   long (humans 1.2–1.8 counting an A-pose's arm span, apes 1.3–1.7);
 *   animals on legs are longer than tall (0.5–0.8). */

/** @typedef {"upright" | "quadruped" | "biped-animal" | "other"} BodyKind */

/**
 * @typedef {object} BodyShape
 * @property {BodyKind} kind
 * @property {number} feet Separate patches on the floor (big enough to be a foot).
 * @property {number} stance Height / longest horizontal extent.
 * @property {[number, number]} axis The longest horizontal direction (x, z).
 * @property {number} height
 * @property {number} length
 */

/** `positions`: x, y, z per vertex, in the model's rest space (+Y up).
 * @param {ArrayLike<number>} positions
 * @returns {BodyShape} */
export function classifyBody(positions) {
  const n = positions.length / 3;
  let lo = Infinity;
  let hi = -Infinity;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    const y = positions[i * 3 + 1];
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
    cx += positions[i * 3];
    cz += positions[i * 3 + 2];
  }
  cx /= n;
  cz /= n;
  const height = hi - lo;

  // The longest horizontal direction (principal axis on the floor).
  let xx = 0;
  let zz = 0;
  let xz = 0;
  for (let i = 0; i < n; i++) {
    const dx = positions[i * 3] - cx;
    const dz = positions[i * 3 + 2] - cz;
    xx += dx * dx;
    zz += dz * dz;
    xz += dx * dz;
  }
  const angle = 0.5 * Math.atan2(2 * xz, xx - zz);
  /** @type {[number, number]} */
  const axis = [Math.cos(angle), Math.sin(angle)];
  let amin = Infinity;
  let amax = -Infinity;
  for (let i = 0; i < n; i++) {
    const a =
      (positions[i * 3] - cx) * axis[0] + (positions[i * 3 + 2] - cz) * axis[1];
    amin = Math.min(amin, a);
    amax = Math.max(amax, a);
  }
  const length = amax - amin;
  const stance = length > 0 ? height / length : Infinity;

  // Feet: connected patches on a floor grid of the lowest vertices.
  const cell = height / 60;
  const floor = lo + 0.04 * height;
  /** @type {Map<string, number>} */
  const occupied = new Map();
  for (let i = 0; i < n; i++)
    if (positions[i * 3 + 1] < floor) {
      const k = `${Math.floor(positions[i * 3] / cell)},${Math.floor(positions[i * 3 + 2] / cell)}`;
      occupied.set(k, (occupied.get(k) ?? 0) + 1);
    }
  const seen = new Set();
  /** @type {number[]} */
  const patches = [];
  for (const start of occupied.keys()) {
    if (seen.has(start)) continue;
    seen.add(start);
    const queue = [start];
    let count = 0;
    while (queue.length) {
      const c = /** @type {string} */ (queue.pop());
      count += /** @type {number} */ (occupied.get(c));
      const [x, z] = c.split(",").map(Number);
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          const k = `${x + dx},${z + dz}`;
          if (occupied.has(k) && !seen.has(k)) {
            seen.add(k);
            queue.push(k);
          }
        }
    }
    patches.push(count);
  }
  const total = patches.reduce((s, c) => s + c, 0);
  // A foot holds at least a tenth of the floor contact (four feet ~25%
  // each, two ~50%; a tail tip on the floor ~6%).
  const feet = patches.filter((c) => c >= 0.1 * total).length;

  /** @type {BodyKind} */
  let kind;
  if (feet >= 4) kind = "quadruped";
  else if (feet === 2 || feet === 3)
    kind = stance >= 1 ? "upright" : "biped-animal";
  else kind = "other";
  return { kind, feet, stance, axis, height, length };
}
