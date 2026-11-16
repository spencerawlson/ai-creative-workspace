import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { afterAll, describe, expect, it } from "vitest";
import { convert, render, retopo } from "@/scripts/blender-job.mjs";
import { findBlender } from "@/scripts/blender/run.mjs";
import { makeShape } from "@/lib/sculpt/shapes";

// Blender runs these; where it isn't installed (CI) they're skipped.
const hasBlender = !!findBlender();
const dir = mkdtempSync(join(tmpdir(), "iko-blender-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The Sculpt page's sphere (dense, uneven triangles) as a GLB. */
async function sculptSphere() {
  const m = makeShape("sphere");
  const doc = new Document();
  const buffer = doc.createBuffer();
  const prim = doc
    .createPrimitive()
    .setAttribute(
      "POSITION",
      doc
        .createAccessor()
        .setType("VEC3")
        .setArray(Float32Array.from(m.positions))
        .setBuffer(buffer),
    )
    .setIndices(
      doc
        .createAccessor()
        .setType("SCALAR")
        .setArray(Uint32Array.from(m.index))
        .setBuffer(buffer),
    );
  const mesh = doc.createMesh("Clay").addPrimitive(prim);
  doc.createScene().addChild(doc.createNode("Clay").setMesh(mesh));
  const file = join(dir, "sphere.glb");
  writeFileSync(file, await new NodeIO().writeBinary(doc));
  return { file, triangles: m.index.length / 3 };
}

describe.skipIf(!hasBlender)("Blender jobs", () => {
  it("retopology: a dense sculpt becomes even quads near the target", async () => {
    const { file, triangles } = await sculptSphere();
    const out = join(dir, "sphere-retopo.glb");
    const r = await retopo(file, out, { faces: 1500 });
    expect(r.before).toBe(triangles);
    expect(r.faces).toBeGreaterThan(1500 * 0.5);
    expect(r.faces).toBeLessThan(1500 * 1.5);
    if (r.method === "quadriflow")
      expect(r.quads / r.faces).toBeGreaterThan(0.95);
    // The file is a readable GLB with that many faces (two triangles
    // per quad).
    const doc = await new NodeIO().read(out);
    const tris = doc
      .getRoot()
      .listMeshes()
      .flatMap((m) => m.listPrimitives())
      .reduce((s, p) => s + p.getIndices()!.getCount() / 3, 0);
    expect(tris).toBeGreaterThanOrEqual(r.faces);
  }, 300_000);

  it("FBX and USD keep the skeleton and the walk", async () => {
    for (const ext of ["fbx", "usdc"]) {
      const out = join(dir, `lion.${ext}`);
      const r = await convert("public/creatures/lion.glb", out);
      expect(r.armatures).toBe(1);
      expect(r.bones).toBe(19);
      expect(r.actions).toContain("walk");
      expect(statSync(out).size).toBeGreaterThan(50_000);
    }
  }, 300_000);

  it("renders a still at the size asked", async () => {
    const { file } = await sculptSphere();
    const out = join(dir, "sphere.png");
    const r = await render(file, out, { width: 96, height: 64 });
    expect(r.frames).toBe(1);
    const png = readFileSync(out);
    // PNG signature, then the IHDR's width and height.
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(96);
    expect(png.readUInt32BE(20)).toBe(64);
  }, 300_000);

  it("renders a video: an MP4 with an H.264 stream", async () => {
    const { file } = await sculptSphere();
    const out = join(dir, "sphere.mp4");
    const r = await render(file, out, {
      width: 64,
      height: 64,
      seconds: 2,
      fps: 1,
    });
    expect(r.frames).toBe(2);
    const text = readFileSync(out).toString("latin1");
    for (const box of ["ftyp", "moov", "mdat", "avc1"])
      expect(text).toContain(box);
  }, 300_000);
});

describe("Blender job arguments", () => {
  it("are checked before Blender starts", () => {
    expect(() => retopo("a.glb", "b.glb", { faces: 5 })).toThrow(/faces/);
    expect(() => convert("a.glb", "b.obj")).toThrow(/fbx/);
    expect(() => render("a.glb", "b.gif")).toThrow(/png or \.mp4/);
    expect(() => render("a.glb", "b.png", { engine: "unreal" })).toThrow(
      /engine/,
    );
    expect(() => render("a.glb", "b.png", { width: 100000 })).toThrow(/width/);
  });
});
