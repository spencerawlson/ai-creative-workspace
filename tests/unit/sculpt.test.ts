import { describe, expect, it } from "vitest";
import {
  Stroke,
  applyDab,
  applyRecord,
  moveGrab,
  startGrab,
  type BrushSettings,
  type Dab,
} from "@/lib/sculpt/brushes";
import { MAX_STEPS, SculptHistory } from "@/lib/sculpt/history";
import {
  buildMesh,
  faceCount,
  triangles,
  vertexCount,
  weld,
  type SculptMesh,
} from "@/lib/sculpt/mesh";
import { makeShape } from "@/lib/sculpt/shapes";

const settings = (o: Partial<BrushSettings> = {}): BrushSettings => ({
  radius: 0.15,
  strength: 0.5,
  invert: false,
  symmetry: false,
  ...o,
});

const at = (m: SculptMesh, v: number) =>
  [0, 1, 2].map((k) => m.positions[v * 3 + k]);

/** The vertex nearest to a point. */
function nearest(m: SculptMesh, x: number, y: number, z: number): number {
  let best = 0;
  let d = Infinity;
  for (let v = 0; v < vertexCount(m); v++) {
    const [a, b, c] = at(m, v);
    const e = (a - x) ** 2 + (b - y) ** 2 + (c - z) ** 2;
    if (e < d) {
      d = e;
      best = v;
    }
  }
  return best;
}

/** A dab on the sphere (centre (0, 0.5, 0), radius 0.5) facing `dir`. */
function sphereDab(dir: [number, number, number]): Dab {
  const len = Math.hypot(...dir);
  const n = dir.map((d) => d / len) as [number, number, number];
  return { point: [n[0] * 0.5, 0.5 + n[1] * 0.5, n[2] * 0.5], normal: n };
}

const distFromCentre = (m: SculptMesh, v: number) => {
  const [x, y, z] = at(m, v);
  return Math.hypot(x, y - 0.5, z);
};

describe("the clay", () => {
  it("welds corners into one surface, dropping collapsed slivers", () => {
    // Two triangles of a square, each with its own corners, plus a
    // sliver whose corners weld into one.
    const w = weld([
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1,
      0, 0,
    ]);
    expect(w.positions.length / 3).toBe(4);
    expect(w.index.length / 3).toBe(2);
  });

  it("starts as closed shapes with outward normals, on the floor", () => {
    for (const id of ["sphere", "block"] as const) {
      const m = makeShape(id);
      const V = vertexCount(m);
      const F = faceCount(m);
      const E = m.neighbors.length / 2;
      // A closed surface without holes: V − E + F = 2.
      expect(V - E + F).toBe(2);
      expect(F).toBeGreaterThan(30_000);
      expect(F).toBeLessThan(120_000);
      let minY = Infinity;
      let maxY = -Infinity;
      for (let v = 0; v < V; v++) {
        minY = Math.min(minY, m.positions[v * 3 + 1]);
        maxY = Math.max(maxY, m.positions[v * 3 + 1]);
      }
      expect(minY).toBeCloseTo(0, 4);
      expect(maxY).toBeGreaterThan(0.75);
      // Normals point away from the middle of the shape.
      const mid = (minY + maxY) / 2;
      for (let v = 0; v < V; v += 97) {
        const [x, y, z] = at(m, v);
        const out =
          x * m.normals[v * 3] +
          (y - mid) * m.normals[v * 3 + 1] +
          z * m.normals[v * 3 + 2];
        expect(out).toBeGreaterThan(0);
      }
    }
    expect(triangles(makeShape("sphere")).length).toBe(
      faceCount(makeShape("sphere")) * 9,
    );
  });
});

describe("brushes", () => {
  it("draw raises the surface under the brush, and only there; subtract digs", () => {
    const m = makeShape("sphere");
    const top = nearest(m, 0, 1, 0);
    const side = nearest(m, 0.5, 0.5, 0);
    const stroke = new Stroke();
    for (let i = 0; i < 5; i++)
      applyDab(m, "draw", sphereDab([0, 1, 0]), settings(), stroke);
    expect(at(m, top)[1]).toBeGreaterThan(1.005);
    expect(distFromCentre(m, side)).toBeCloseTo(0.5, 4);

    const dig = makeShape("sphere");
    applyDab(
      dig,
      "draw",
      sphereDab([0, 1, 0]),
      settings({ invert: true }),
      new Stroke(),
    );
    expect(at(dig, nearest(dig, 0, 1, 0))[1]).toBeLessThan(1);
  });

  it("inflate swells, smooth evens out bumps, flatten makes a flat patch", () => {
    const m = makeShape("sphere");
    const top = nearest(m, 0, 1, 0);
    applyDab(m, "inflate", sphereDab([0, 1, 0]), settings(), new Stroke());
    expect(distFromCentre(m, top)).toBeGreaterThan(0.5);

    // Roughen, then smooth: neighbours end up closer to their average.
    const rough = makeShape("sphere");
    let seed = 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
    for (let i = 0; i < rough.positions.length; i++)
      rough.positions[i] += rand() * 0.01;
    const bumpiness = (mesh: SculptMesh, v: number) => {
      let sum = 0;
      for (let j = mesh.neighborStart[v]; j < mesh.neighborStart[v + 1]; j++) {
        const w = mesh.neighbors[j];
        sum += Math.hypot(
          ...[0, 1, 2].map(
            (k) => mesh.positions[v * 3 + k] - mesh.positions[w * 3 + k],
          ),
        );
      }
      return sum;
    };
    const v = nearest(rough, 0, 1, 0);
    const before = bumpiness(rough, v);
    for (let i = 0; i < 4; i++)
      applyDab(
        rough,
        "smooth",
        sphereDab([0, 1, 0]),
        settings({ strength: 1 }),
        new Stroke(),
      );
    expect(bumpiness(rough, v)).toBeLessThan(before * 0.8);

    // Flatten the top: its points come closer to one height.
    const flat = makeShape("sphere");
    const spread = (mesh: SculptMesh) => {
      const ys: number[] = [];
      for (let i = 0; i < vertexCount(mesh); i++) {
        const [x, y, z] = at(mesh, i);
        if (Math.hypot(x, z) < 0.06 && y > 0.9) ys.push(y);
      }
      return Math.max(...ys) - Math.min(...ys);
    };
    const was = spread(flat);
    for (let i = 0; i < 8; i++)
      applyDab(
        flat,
        "flatten",
        sphereDab([0, 1, 0]),
        settings({ strength: 1 }),
        new Stroke(),
      );
    expect(spread(flat)).toBeLessThan(was * 0.6);
  });

  it("clay builds up towards a level, pinch pulls in towards the stroke", () => {
    const m = makeShape("sphere");
    const top = nearest(m, 0, 1, 0);
    // One dab lifts the surface at most to its plane, a little above it.
    applyDab(
      m,
      "clay",
      sphereDab([0, 1, 0]),
      settings({ strength: 1 }),
      new Stroke(),
    );
    const y = at(m, top)[1];
    expect(y).toBeGreaterThan(1);
    expect(y).toBeLessThan(1 + 0.15 * 0.08);
    // Subtracting digs instead.
    const dug = makeShape("sphere");
    applyDab(
      dug,
      "clay",
      sphereDab([0, 1, 0]),
      settings({ strength: 1, invert: true }),
      new Stroke(),
    );
    expect(at(dug, nearest(dug, 0, 1, 0))[1]).toBeLessThan(1);

    const p = makeShape("sphere");
    const off = nearest(p, 0.08, Math.sqrt(0.25 - 0.0064) + 0.5, 0);
    const before = Math.abs(at(p, off)[0]);
    applyDab(
      p,
      "pinch",
      sphereDab([0, 1, 0]),
      settings({ strength: 1 }),
      new Stroke(),
    );
    expect(Math.abs(at(p, off)[0])).toBeLessThan(before);
  });

  it("symmetry mirrors a dab across the middle, exactly", () => {
    const m = makeShape("sphere");
    applyDab(
      m,
      "draw",
      sphereDab([0.4, 0.3, 0.2]),
      settings({ symmetry: true, strength: 1 }),
      new Stroke(),
    );
    const right = nearest(
      m,
      (0.4 * 0.5) / Math.hypot(0.4, 0.3, 0.2),
      0.5 + (0.3 * 0.5) / Math.hypot(0.4, 0.3, 0.2),
      (0.2 * 0.5) / Math.hypot(0.4, 0.3, 0.2),
    );
    const [x, y, z] = at(m, right);
    const left = nearest(m, -x, y, z);
    const [lx, ly, lz] = at(m, left);
    expect(distFromCentre(m, right)).toBeGreaterThan(0.5);
    expect(lx).toBeCloseTo(-x, 3);
    expect(ly).toBeCloseTo(y, 3);
    expect(lz).toBeCloseTo(z, 3);
  });

  it("grab drags a region by its weights, mirrored with symmetry", () => {
    const m = makeShape("sphere");
    const top = nearest(m, 0.2, 0.5 + Math.sqrt(0.25 - 0.04), 0);
    const mirror = nearest(m, -0.2, 0.5 + Math.sqrt(0.25 - 0.04), 0);
    const far = nearest(m, 0, 0, 0);
    const [x0, y0] = at(m, top);
    const [mx0] = at(m, mirror);
    const stroke = new Stroke();
    const g = startGrab(
      m,
      sphereDab([0.2, Math.sqrt(0.25 - 0.04), 0]),
      settings({ symmetry: true, strength: 1 }),
      stroke,
    );
    moveGrab(m, g, [0.1, 0.2, 0]);
    const [x1, y1] = at(m, top);
    expect(y1 - y0).toBeGreaterThan(0.1);
    expect(x1 - x0).toBeGreaterThan(0.05);
    // The mirrored side moves the mirrored way.
    expect(at(m, mirror)[0] - mx0).toBeLessThan(-0.05);
    expect(at(m, far)[1]).toBeCloseTo(0, 5);
    // Moving again is from the start, not cumulative.
    moveGrab(m, g, [0, 0, 0]);
    expect(at(m, top)[1]).toBeCloseTo(y0, 6);
  });
});

describe("undo", () => {
  it("a stroke undoes and redoes exactly, normals included", () => {
    const m = makeShape("sphere");
    const before = m.positions.slice();
    const normals = m.normals.slice();
    const stroke = new Stroke();
    for (let i = 0; i < 6; i++)
      applyDab(
        m,
        "draw",
        sphereDab([0.1, 1, 0.1 * i]),
        settings({ symmetry: true }),
        stroke,
      );
    const rec = stroke.finish(m)!;
    expect(rec.indices.length).toBeGreaterThan(50);
    const after = m.positions.slice();

    const h = new SculptHistory();
    h.push(rec);
    expect(h.undo(m)).not.toBeNull();
    expect(m.positions).toEqual(before);
    for (let i = 0; i < normals.length; i++)
      expect(m.normals[i]).toBeCloseTo(normals[i], 5);
    expect(h.canRedo).toBe(true);
    h.redo(m);
    expect(m.positions).toEqual(after);
    expect(h.undo(m)).not.toBeNull();
    expect(h.undo(m)).toBeNull();
    expect(new Stroke().finish(m)).toBeNull();
    applyRecord(m, rec, "after");
    expect(m.positions).toEqual(after);
  });

  it("keeps a bounded number of steps; a new stroke clears redo", () => {
    const m = makeShape("block");
    const h = new SculptHistory();
    for (let i = 0; i < MAX_STEPS + 5; i++) {
      const s = new Stroke();
      applyDab(
        m,
        "draw",
        { point: [0, 0.8, 0], normal: [0, 1, 0] },
        settings({ radius: 0.05 }),
        s,
      );
      h.push(s.finish(m)!);
    }
    expect(h.steps).toBe(MAX_STEPS);
    h.undo(m);
    const s = new Stroke();
    applyDab(
      m,
      "draw",
      { point: [0, 0.8, 0], normal: [0, 1, 0] },
      settings(),
      s,
    );
    h.push(s.finish(m)!);
    expect(h.canRedo).toBe(false);
  });

  it("builds from any welded triangles", () => {
    const m = buildMesh(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint32Array([0, 1, 2]),
    );
    expect([...m.normals.slice(0, 3)]).toEqual([0, 0, 1]);
    expect(m.neighborStart[3]).toBe(6);
  });
});

describe("symmetry near the middle", () => {
  it("strokes across the middle stay exact mirror images, without a seam", () => {
    const m = makeShape("sphere");
    // Each vertex's mirror image across x = 0, found before sculpting.
    const mirrorOf = new Int32Array(vertexCount(m)).fill(-1);
    const byPlace = new Map<string, number>();
    const key = (x: number, y: number, z: number) =>
      `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    for (let v = 0; v < vertexCount(m); v++) {
      const [x, y, z] = at(m, v);
      byPlace.set(key(x, y, z), v);
    }
    for (let v = 0; v < vertexCount(m); v++) {
      const [x, y, z] = at(m, v);
      mirrorOf[v] = byPlace.get(key(-x, y, z)) ?? -1;
    }
    const stroke = new Stroke();
    // Dabs just right of the middle: the brush and its mirror overlap.
    for (const [x, brush] of [
      [0.02, "draw"],
      [0.04, "clay"],
      [0.01, "inflate"],
      [0.03, "smooth"],
    ] as const)
      applyDab(
        m,
        brush,
        sphereDab([x, 0.3, 1]),
        settings({ symmetry: true, strength: 1 }),
        stroke,
      );
    const g = startGrab(
      m,
      sphereDab([0.02, 0.5, 1]),
      settings({ symmetry: true }),
      stroke,
    );
    moveGrab(m, g, [0.03, 0.05, 0.04]);
    let checked = 0;
    for (let v = 0; v < vertexCount(m); v++) {
      const w = mirrorOf[v];
      if (w < 0) continue;
      const [x, y, z] = at(m, v);
      const [mx, my, mz] = at(m, w);
      expect(Math.abs(x + mx)).toBeLessThan(1e-5);
      expect(Math.abs(y - my)).toBeLessThan(1e-5);
      expect(Math.abs(z - mz)).toBeLessThan(1e-5);
      checked++;
    }
    expect(checked).toBeGreaterThan(vertexCount(m) * 0.9);
  });
});

describe("the clay in the 3D view", () => {
  it("building the hit-test tree leaves the clay's own triangles alone", async () => {
    const { clayGeometry } = await import("@/lib/sculpt/SculptEngine");
    const m = makeShape("sphere");
    const before = m.index.slice();
    const { geometry, bvh } = clayGeometry(m);
    expect(m.index).toEqual(before);
    // The drawn arrays are the clay's, so brushes show up directly.
    expect(geometry.attributes.position.array).toBe(m.positions);
    expect(geometry.attributes.normal.array).toBe(m.normals);
    // And the tree finds the surface.
    const THREE = await import("three");
    const hit = bvh.raycastFirst(
      new THREE.Ray(new THREE.Vector3(0, 0.5, 3), new THREE.Vector3(0, 0, -1)),
      THREE.FrontSide,
    );
    expect(hit?.point.z).toBeCloseTo(0.5, 2);
    geometry.dispose();
  });
});

describe("speed-ups that must not change results", () => {
  it("the vertex grid finds exactly the vertices a full scan finds, after moves within its margin", async () => {
    const { VertexGrid } = await import("@/lib/sculpt/grid");
    const m = makeShape("sphere");
    const r = 0.07;
    const grid = new VertexGrid(m.positions, r);
    // Move every vertex a little (under half the radius) after building.
    let seed = 7;
    const rand = () =>
      ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.06;
    for (let i = 0; i < m.positions.length; i++) m.positions[i] += rand();
    for (const c of [
      [0, 1, 0],
      [0.3, 0.6, 0.3],
      [-0.49, 0.5, 0],
      [0.01, 0.02, 0.05],
    ]) {
      const brute = new Set<number>();
      for (let v = 0; v < vertexCount(m); v++) {
        const d = Math.hypot(
          ...[0, 1, 2].map((k) => m.positions[v * 3 + k] - c[k]),
        );
        if (d < r) brute.add(v);
      }
      const found = new Set<number>();
      grid.near(c, r * 1.5, (v) => {
        const d = Math.hypot(
          ...[0, 1, 2].map((k) => m.positions[v * 3 + k] - c[k]),
        );
        if (d < r) {
          expect(found.has(v)).toBe(false); // each once
          found.add(v);
        }
      });
      expect(found).toEqual(brute);
    }
  });

  it("welding by hash merges exactly the corners at the same place", () => {
    // Corners of a strip of triangles, each with its own copies, plus a
    // corner just apart (not merged) and one within the precision.
    const corners = [
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      0,
      1,
      0,
      0,
      1,
      1,
      0,
      0,
      1,
      0,
      1,
      0,
      0,
      2,
      0,
      0,
      1,
      1,
      0,
      2,
      0,
      0,
      2,
      1,
      0,
      1.00002,
      1,
      0, // 2e-5 apart: a separate corner
      2,
      1,
      0,
      3,
      1,
      0,
      2.000004,
      0,
      0, // 4e-6 apart: the same corner
    ];
    const w = weld(corners);
    expect(w.positions.length / 3).toBe(8);
    expect(w.index.length / 3).toBe(5);
    // The same welds as one by one, by exact rounded coordinates.
    const keys = new Set<string>();
    for (let i = 0; i < corners.length; i += 3)
      keys.add(
        corners
          .slice(i, i + 3)
          .map((v) => Math.round(v / 1e-5))
          .join(),
      );
    expect(w.positions.length / 3).toBe(keys.size);
  });
});

describe("paint and mask", () => {
  const top = (m: SculptMesh) => nearest(m, 0, 1, 0);
  const red: [number, number, number] = [1, 0, 0];

  it("paints where the brush is, mirrored, erases, and undoes exactly without moving the shape", async () => {
    const { applyPaint } = await import("@/lib/sculpt/brushes");
    const m = makeShape("sphere");
    const positions = m.positions.slice();
    const stroke = new Stroke("paint");
    const dab = sphereDab([0.3, 0.5, 0.8]);
    for (let i = 0; i < 3; i++)
      applyPaint(
        m,
        dab,
        settings({ symmetry: true, strength: 1 }),
        red,
        stroke,
      );
    const v = nearest(m, ...(dab.point as [number, number, number]));
    expect(m.paint[v * 4 + 3]).toBeGreaterThan(0.9);
    expect(m.paint[v * 4]).toBeCloseTo(1, 4);
    expect(m.paint[v * 4 + 1]).toBeCloseTo(0, 4);
    // Mirrored, and not painted far away.
    const [x, y, z] = at(m, v);
    expect(m.paint[nearest(m, -x, y, z) * 4 + 3]).toBeGreaterThan(0.9);
    expect(m.paint[top(m) * 4 + 3]).toBe(0);
    expect(m.positions).toEqual(positions);

    const rec = stroke.finish(m)!;
    expect(rec.channel).toBe("paint");
    const h = new SculptHistory();
    h.push(rec);
    const painted = m.paint.slice();
    h.undo(m);
    expect(m.paint.every((c) => c === 0)).toBe(true);
    h.redo(m);
    expect(m.paint).toEqual(painted);

    // Subtract erases.
    applyPaint(
      m,
      dab,
      settings({ strength: 1, invert: true }),
      red,
      new Stroke("paint"),
    );
    expect(m.paint[v * 4 + 3]).toBeLessThan(0.5);
  });

  it("paint over paint blends towards the new colour", async () => {
    const { applyPaint } = await import("@/lib/sculpt/brushes");
    const m = makeShape("sphere");
    const dab = sphereDab([0, 1, 0]);
    const v = top(m);
    applyPaint(m, dab, settings({ strength: 1 }), red, new Stroke("paint"));
    applyPaint(
      m,
      dab,
      settings({ strength: 0.5 }),
      [0, 0, 1],
      new Stroke("paint"),
    );
    expect(m.paint[v * 4 + 2]).toBeGreaterThan(0.3);
    expect(m.paint[v * 4]).toBeGreaterThan(0.3);
    expect(m.paint[v * 4 + 3]).toBeCloseTo(1, 4);
  });

  it("masked areas don't move under any sculpting brush, grab included", async () => {
    const { applyMask } = await import("@/lib/sculpt/brushes");
    const m = makeShape("sphere");
    const dab = sphereDab([0, 1, 0]);
    const s = settings({ strength: 1 });
    for (let i = 0; i < 6; i++) applyMask(m, dab, s, new Stroke("mask"));
    const v = top(m);
    expect(m.mask[v]).toBeGreaterThan(0.99);
    const before = at(m, v);
    for (const brush of [
      "draw",
      "clay",
      "inflate",
      "smooth",
      "flatten",
      "pinch",
    ] as const)
      applyDab(m, brush, dab, s, new Stroke());
    const g = startGrab(m, dab, s, new Stroke());
    moveGrab(m, g, [0.1, 0.2, 0]);
    const after = at(m, v);
    for (let k = 0; k < 3; k++) expect(after[k]).toBeCloseTo(before[k], 3);

    // Unmasked clay still moves.
    const free = makeShape("sphere");
    applyDab(free, "draw", dab, s, new Stroke());
    expect(at(free, top(free))[1]).toBeGreaterThan(1);
  });

  it("clears and inverts whole layers as undo steps", async () => {
    const { applyLayerOp, applyMask, applyPaint } =
      await import("@/lib/sculpt/brushes");
    const m = makeShape("block");
    expect(applyLayerOp(m, "clearMask")).toBeNull(); // nothing to clear
    const inv = applyLayerOp(m, "invertMask")!;
    expect(m.mask.every((x) => x === 1)).toBe(true);
    const h = new SculptHistory();
    h.push(inv);
    h.undo(m);
    expect(m.mask.every((x) => x === 0)).toBe(true);
    applyMask(
      m,
      { point: [0, 0.8, 0], normal: [0, 1, 0] },
      settings(),
      new Stroke("mask"),
    );
    applyLayerOp(m, "clearMask");
    expect(m.mask.every((x) => x === 0)).toBe(true);
    applyPaint(
      m,
      { point: [0, 0.8, 0], normal: [0, 1, 0] },
      settings(),
      red,
      new Stroke("paint"),
    );
    const clear = applyLayerOp(m, "clearPaint")!;
    expect(clear.channel).toBe("paint");
    expect(m.paint.filter((_, i) => i % 4 === 3).every((a) => a === 0)).toBe(
      true,
    );
  });

  it("bakes paint over the material for export, and saves layers as bytes", async () => {
    const { bakeColors, hexToSrgb, packLayer, srgbToLinear, unpackLayer } =
      await import("@/lib/sculpt/paint");
    expect(hexToSrgb("#ff8000")).toEqual([1, 128 / 255, 0]);
    expect(hexToSrgb("nope")).toEqual([0.5, 0.5, 0.5]);
    const m = makeShape("block");
    m.paint.set([1, 0.5, 0, 1], 0); // vertex 0 fully painted orange
    m.paint.set([0, 0, 1, 0.5], 4); // vertex 1 half blue
    const base: [number, number, number] = [0.2, 0.4, 0.6];
    const c = bakeColors(m, base);
    expect(c[0]).toBeCloseTo(1, 6);
    expect(c[1]).toBeCloseTo(srgbToLinear(0.5), 6);
    expect(c[3]).toBeCloseTo(0.1, 6); // half the base red
    expect(c[5]).toBeCloseTo(0.3 + 0.5, 6);
    expect([...c.slice(6, 9)].map((x) => +x.toFixed(6))).toEqual(base);

    expect(packLayer(new Float32Array(8), 4, 3)).toBeNull();
    const bytes = packLayer(m.paint, 4, 3)!;
    const back = unpackLayer(bytes)!;
    for (let i = 0; i < 8; i++)
      expect(Math.abs(back[i] - m.paint[i])).toBeLessThanOrEqual(1 / 255);
    expect(unpackLayer(undefined)).toBeUndefined();
  });
});
