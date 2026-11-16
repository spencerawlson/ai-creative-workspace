import { describe, expect, it } from "vitest";
import { boneHeat } from "@/scripts/reskin-cast.mjs";

/** A closed tube along +y (an "arm"): `rings` rings of `sides` vertices,
 * capped at both ends, with outward normals. */
function tube(rings: number, sides: number, length: number, radius: number) {
  const P: number[] = [];
  const N: number[] = [];
  for (let r = 0; r < rings; r++)
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      P.push(
        radius * Math.cos(a),
        (r / (rings - 1)) * length,
        radius * Math.sin(a),
      );
      N.push(Math.cos(a), 0, Math.sin(a));
    }
  const idx: number[] = [];
  for (let r = 0; r < rings - 1; r++)
    for (let s = 0; s < sides; s++) {
      const a = r * sides + s;
      const b = r * sides + ((s + 1) % sides);
      const c = a + sides;
      const d = b + sides;
      idx.push(a, c, b, b, c, d);
    }
  // Caps: a centre vertex at each end.
  for (const [ring, y, ny] of [
    [0, 0, -1],
    [rings - 1, length, 1],
  ] as const) {
    const centre = P.length / 3;
    P.push(0, y, 0);
    N.push(0, ny, 0);
    for (let s = 0; s < sides; s++) {
      const a = ring * sides + s;
      const b = ring * sides + ((s + 1) % sides);
      if (ny < 0) idx.push(centre, a, b);
      else idx.push(centre, b, a);
    }
  }
  return {
    P: Float64Array.from(P),
    N: Float64Array.from(N),
    idx: Uint32Array.from(idx),
  };
}

describe("bone-heat re-skinning", () => {
  // Two bones end to end: upper (y 0..1) and lower (y 1..2).
  const { P, N, idx } = tube(61, 24, 2, 0.12);
  const segments = [
    { name: "upper", a: [0, 0, 0], b: [0, 1, 0], parent: -1 },
    { name: "lower", a: [0, 1, 0], b: [0, 2, 0], parent: 0 },
  ];
  /** Per vertex: [bone, weight] pairs. */
  const weights = boneHeat(P, N, idx, segments) as [number, number][][];
  const n = P.length / 3;
  const of = (v: number, j: number) =>
    weights[v].find(([k]) => k === j)?.[1] ?? 0;

  it("gives every vertex weights that sum to one, at most four", () => {
    for (let v = 0; v < n; v++) {
      expect(weights[v].length).toBeGreaterThan(0);
      expect(weights[v].length).toBeLessThanOrEqual(4);
      const sum = weights[v].reduce((s, [, w]) => s + w, 0);
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it("leaves each end to its own bone and blends across the joint", () => {
    for (let v = 0; v < n; v++) {
      const y = P[v * 3 + 1];
      if (y < 0.5) expect(of(v, 0)).toBeGreaterThan(0.95);
      if (y > 1.5) expect(of(v, 1)).toBeGreaterThan(0.95);
    }
    // At the joint itself, both bones have a real share.
    const atJoint = Array.from({ length: n }, (_, v) => v).filter(
      (v) => Math.abs(P[v * 3 + 1] - 1) < 0.02,
    );
    for (const v of atJoint) {
      expect(of(v, 0)).toBeGreaterThan(0.2);
      expect(of(v, 1)).toBeGreaterThan(0.2);
    }
  });

  it("changes weight gradually: no step between neighbours to tear along", () => {
    let worst = 0;
    for (let t = 0; t < idx.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = idx[t + k];
        const b = idx[t + ((k + 1) % 3)];
        worst = Math.max(worst, Math.abs(of(a, 1) - of(b, 1)));
      }
    // Rings are 2/60 of a unit apart; a hard cut would jump by ~1.
    expect(worst).toBeLessThan(0.15);
  });
});
