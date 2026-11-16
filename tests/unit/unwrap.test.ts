import { describe, expect, it } from "vitest";
import { makeShape } from "@/lib/sculpt/shapes";
import { trianglesOverlap, unwrap, type Unwrapped } from "@/lib/sculpt/unwrap";

/** Texel centres of an n×n grid covered by more than one UV triangle. */
function overlappingTexels(r: Unwrapped, n: number) {
  const grid = new Uint8Array(n * n);
  let twice = 0;
  let covered = 0;
  const edge = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    x: number,
    y: number,
  ) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  for (let t = 0; t < r.index.length; t += 3) {
    const [a, b, c] = [r.index[t], r.index[t + 1], r.index[t + 2]];
    const xs = [r.uvs[a * 2], r.uvs[b * 2], r.uvs[c * 2]];
    const ys = [r.uvs[a * 2 + 1], r.uvs[b * 2 + 1], r.uvs[c * 2 + 1]];
    const x0 = Math.max(0, Math.floor(Math.min(...xs) * n));
    const x1 = Math.min(n - 1, Math.ceil(Math.max(...xs) * n));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) * n));
    const y1 = Math.min(n - 1, Math.ceil(Math.max(...ys) * n));
    for (let gy = y0; gy <= y1; gy++)
      for (let gx = x0; gx <= x1; gx++) {
        const px = (gx + 0.5) / n;
        const py = (gy + 0.5) / n;
        const e1 = edge(xs[0], ys[0], xs[1], ys[1], px, py);
        const e2 = edge(xs[1], ys[1], xs[2], ys[2], px, py);
        const e3 = edge(xs[2], ys[2], xs[0], ys[0], px, py);
        if ((e1 > 0 && e2 > 0 && e3 > 0) || (e1 < 0 && e2 < 0 && e3 < 0)) {
          const k = gy * n + gx;
          if (grid[k] === 1) twice++;
          if (grid[k] === 0) covered++;
          grid[k]++;
        }
      }
  }
  return { twice, covered: covered / (n * n) };
}

/** Every UV triangle is one of the clay's, corner for corner. */
function sameSurface(r: Unwrapped, index: ArrayLike<number>) {
  const key = (a: number, b: number, c: number) =>
    [a, b, c].sort((x, y) => x - y).join();
  const clay = new Set<string>();
  for (let t = 0; t < index.length; t += 3)
    clay.add(key(index[t], index[t + 1], index[t + 2]));
  for (let t = 0; t < r.index.length; t += 3)
    if (
      !clay.has(
        key(
          r.original[r.index[t]],
          r.original[r.index[t + 1]],
          r.original[r.index[t + 2]],
        ),
      )
    )
      return false;
  return r.index.length === index.length;
}

describe("UV unwrapping", () => {
  it("tells overlapping triangles from ones that only touch", () => {
    const a = [0, 0, 1, 0, 0, 1];
    expect(trianglesOverlap(a, [0.2, 0.2, 1, 0.2, 0.2, 1])).toBe(true);
    // Sharing an edge, on opposite sides of it.
    expect(trianglesOverlap(a, [1, 0, 0, 1, 1, 1])).toBe(false);
    expect(trianglesOverlap(a, [2, 2, 3, 2, 2, 3])).toBe(false);
    // Either winding.
    expect(
      trianglesOverlap([0, 0, 0, 1, 1, 0], [0.1, 0.1, 0.3, 0.1, 0.1, 0.3]),
    ).toBe(true);
  });

  it.each(["sphere", "block"] as const)(
    "lays the %s out flat: inside the texture, no overlap, the same surface",
    (shape) => {
      const m = makeShape(shape);
      const r = unwrap(m.positions, m.index, { resolution: 1024 });
      for (const c of r.uvs) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
      expect(sameSurface(r, m.index)).toBe(true);
      const { twice, covered } = overlappingTexels(r, 1024);
      expect(twice).toBe(0);
      // The charts fill much of the texture, not a corner of it.
      expect(covered).toBeGreaterThan(0.4);
      // Each new vertex sits where its clay vertex is (seams duplicate).
      expect(r.original.length).toBeGreaterThanOrEqual(m.positions.length / 3);
    },
    60_000,
  );

  it("splits a surface that lands on itself when flattened", () => {
    // A gentle spiral ramp, one and a half turns: every face looks up
    // (one direction, one connected piece), yet seen from above the
    // second turn lies over the first.
    const positions: number[] = [];
    const index: number[] = [];
    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 3;
      for (const r of [1, 2])
        positions.push(r * Math.cos(a), r * Math.sin(a), 0.02 * a);
    }
    for (let i = 0; i < steps; i++) {
      const [p, q, s, t] = [i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 3];
      index.push(p, q, t, p, t, s);
    }
    const r = unwrap(positions, index, { resolution: 512 });
    expect(r.charts).toBeGreaterThan(1);
    expect(overlappingTexels(r, 512).twice).toBe(0);
    expect(sameSurface(r, index)).toBe(true);
  });
});
