import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { blenderContext, resolveModel } from "@/mcp/blender";
import { StudioSession } from "@/mcp/session";
import { callTool, listTools } from "@/mcp/tools";
import { findBlender } from "@/scripts/blender/run.mjs";

const root = resolve(".");
const out = mkdtempSync(join(tmpdir(), "iko-mcp-out-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));
const ctx = blenderContext(root, { IKO_OUTPUT_DIR: out });

describe("Blender tools: which model", () => {
  it("takes built-in ids and .glb paths", () => {
    expect(resolveModel("cast-real-man", ctx)).toEqual({
      file: join(root, "public/cast/real-man.glb"),
    });
    expect(resolveModel("creature-lion", ctx)).toEqual({
      file: join(root, "public/creatures/lion.glb"),
    });
    expect(resolveModel("mannequin-female", ctx)).toEqual({
      file: join(root, "public/models/mannequin-female.glb"),
    });
    expect(resolveModel("public/creatures/rat.glb", ctx)).toEqual({
      file: join(root, "public/creatures/rat.glb"),
    });
  });

  it("refuses what isn't a GLB model", () => {
    expect(resolveModel("cast-nobody", ctx)).toHaveProperty("error");
    expect(resolveModel("package.json", ctx)).toHaveProperty("error");
    expect(resolveModel("nowhere/model.glb", ctx)).toHaveProperty("error");
    const fake = join(out, "fake.glb");
    writeFileSync(fake, "not a glb");
    expect(resolveModel(fake, ctx)).toEqual({ error: "fake.glb isn't a GLB." });
  });

  it("puts results in the output folder (IKO_OUTPUT_DIR)", () => {
    expect(ctx.outDir).toBe(out);
    expect(blenderContext(root, {}).outDir).toBe(join(root, "out"));
  });

  it("lists the three Blender tools with the studio's", () => {
    const names = listTools().map((t) => t.name);
    for (const n of ["blender_retopo", "blender_export", "blender_render"])
      expect(names).toContain(n);
    expect(names).toContain("scene");
  });
});

describe.skipIf(!findBlender())("Blender tools, run", () => {
  it("exports a built-in creature to FBX into the output folder", async () => {
    const r = await callTool(
      new StudioSession(),
      "blender_export",
      { model: "creature-lion", format: "fbx" },
      { studioUrl: "http://localhost:3000", cast: [], blender: ctx },
    );
    expect(r.isError).toBeFalsy();
    expect(r.text).toMatch(/19 bones/);
    expect(r.text).toMatch(/walk/);
    expect(readdirSync(out).some((f) => /^lion-fbx-.*\.fbx$/.test(f))).toBe(
      true,
    );
  }, 300_000);

  it("checks arguments before running", async () => {
    const r = await callTool(
      new StudioSession(),
      "blender_retopo",
      { model: "creature-lion", faces: 5 },
      { studioUrl: "http://localhost:3000", cast: [], blender: ctx },
    );
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Bad input/);
  });
});
