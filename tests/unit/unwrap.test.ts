import { describe, expect, it } from "vitest";
import { makeShape } from "@/lib/sculpt/shapes";
import {
  PIECE_VERTICES,
  splitForAtlas,
  unwrap,
  type XAtlas,
} from "@/lib/sculpt/unwrap";

/** The real xatlas, its Node build. */
async function nodeXAtlas(): Promise<XAtlas> {
  const { Api } = await import("xatlasjs/dist/node/api.mjs");
  const { default: createModule } =
    await import("xatlasjs/dist/node/xatlas.js");
  const XatlasApi = Api(createModule);
  return await new Promise<XAtlas>((done) => {
    const api: XAtlas = new XatlasApi(() => done(api));
  });
}

describe("UV unwrapping", () => {
  it("splits big clay into pieces xatlas can take, every triangle once", () => {
    const index = new Uint32Array(30 * 3);
    for (let t = 0; t < 30; t++) index.set([t, t + 1, t + 2], t * 3);
    const pieces = splitForAtlas(index, 10);
    let triangles = 0;
    for (const p of pieces) {
      expect(p.original.length).toBeLessThanOrEqual(10);
      triangles += p.indexes.length / 3;
      // Each piece corner maps back to the triangle it came from.
      for (let i = 0; i < p.indexes.length; i++)
        expect(p.indexes[i]).toBeLessThan(p.original.length);
    }
    expect(triangles).toBe(30);
    const back = pieces.flatMap((p) =>
      Array.from(p.indexes, (i) => p.original[i]),
    );
    expect(back).toEqual(Array.from(index));
    expect(PIECE_VERTICES).toBeLessThan(65_536);
  });

  it("lays a sculpture out flat: one atlas, UVs inside it, the same surface", async () => {
    const m = makeShape("sphere");
    const xatlas = await nodeXAtlas();
    const r = await unwrap(xatlas, m.positions, m.index, { resolution: 1024 });
    // The same triangles, over (a few more) vertices.
    expect(r.index.length).toBe(m.index.length);
    expect(r.original.length).toBeGreaterThanOrEqual(m.positions.length / 3);
    for (let i = 0; i < r.uvs.length; i++) {
      expect(r.uvs[i]).toBeGreaterThanOrEqual(0);
      expect(r.uvs[i]).toBeLessThanOrEqual(1);
    }
    // Each new triangle is one of the clay's, corner for corner.
    const key = (a: number, b: number, c: number) =>
      [a, b, c].sort((x, y) => x - y).join();
    const clay = new Set<string>();
    for (let t = 0; t < m.index.length; t += 3)
      clay.add(key(m.index[t], m.index[t + 1], m.index[t + 2]));
    for (let t = 0; t < r.index.length; t += 3 * 97)
      expect(
        clay.has(
          key(
            r.original[r.index[t]],
            r.original[r.index[t + 1]],
            r.original[r.index[t + 2]],
          ),
        ),
      ).toBe(true);
    expect(r.width).toBeGreaterThan(256);
  }, 120_000);
});
