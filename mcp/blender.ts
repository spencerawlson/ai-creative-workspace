/** Blender jobs as MCP tools: retopology, FBX/USD export and renders of
 * a model (scripts/blender-job.mjs). Blender runs headless on this
 * machine; without it the tools say so.
 *
 * A model is a GLB file, or a built-in model by id (cast-…, creature-…,
 * mannequin-male / mannequin-female). Results are written only into
 * the output folder (IKO_OUTPUT_DIR, default <repo>/out), under a fresh
 * name: a tool never overwrites a file. */

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { convert, render, retopo } from "@/scripts/blender-job.mjs";
import { findBlender } from "@/scripts/blender/run.mjs";

export interface BlenderContext {
  /** The app's folder (for built-in models). */
  root: string;
  /** Where results go. */
  outDir: string;
}

export function blenderContext(
  root: string,
  env: Record<string, string | undefined> = process.env,
): BlenderContext {
  const out = env.IKO_OUTPUT_DIR?.trim();
  return { root, outDir: out ? resolve(out) : join(root, "out") };
}

const MODEL = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .describe(
    "A .glb file path, or a built-in model id: cast-… or creature-… (catalog lists them), mannequin-male, mannequin-female.",
  );

/** The GLB a model argument names, or why not. */
export function resolveModel(
  model: string,
  ctx: BlenderContext,
): { file: string } | { error: string } {
  const builtIn = (dir: string, list: string, key: string) => {
    try {
      const json = JSON.parse(
        readFileSync(join(ctx.root, "public", dir, list), "utf8"),
      );
      const e = (json[key] as Array<{ id: string; file: string }>).find(
        (x) => x.id === model,
      );
      return e ? join(ctx.root, "public", dir, e.file) : null;
    } catch {
      return null;
    }
  };
  let file: string | null = null;
  if (/^cast-[a-z0-9-]+$/.test(model))
    file = builtIn("cast", "cast.json", "cast");
  else if (/^creature-[a-z0-9-]+$/.test(model))
    file = builtIn("creatures", "creatures.json", "creatures");
  else if (/^mannequin-(male|female)$/.test(model))
    file = join(ctx.root, "public/models", `${model}.glb`);
  else if (extname(model).toLowerCase() === ".glb")
    file = isAbsolute(model) ? model : resolve(ctx.root, model);
  if (!file)
    return { error: `No model "${model}": give a .glb path or a built-in id.` };
  if (!existsSync(file) || !statSync(file).isFile())
    return { error: `There's no file at ${file}.` };
  const head = readFileSync(file).subarray(0, 4).toString("latin1");
  if (head !== "glTF") return { error: `${basename(file)} isn't a GLB.` };
  return { file };
}

/** A fresh output path in the output folder. */
function outPath(
  ctx: BlenderContext,
  input: string,
  label: string,
  ext: string,
) {
  mkdirSync(ctx.outDir, { recursive: true });
  const stem = basename(input, extname(input)).replace(/[^a-zA-Z0-9-]+/g, "-");
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..*$/, "");
  return join(ctx.outDir, `${stem}-${label}-${stamp}${ext}`);
}

export interface BlenderTool<S extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: S;
  run(
    args: z.infer<S>,
    ctx: BlenderContext,
  ): Promise<{ text: string; isError?: boolean }>;
}

const failed = (text: string) => ({ text, isError: true });
const noBlender = () =>
  failed(
    "Blender isn't installed on this machine (or set BLENDER to its path), so this tool can't run.",
  );

const t = <S extends z.ZodObject>(x: BlenderTool<S>) =>
  x as unknown as BlenderTool<z.ZodObject>;

export const BLENDER_TOOLS = [
  t({
    name: "blender_retopo",
    title: "Clean quad mesh (Blender)",
    description:
      "Rebuild a model's surface as even quads (retopology), about `faces` of them: a dense sculpt becomes a light, animatable mesh. Writes a new GLB to the output folder and says where.",
    input: z.object({
      model: MODEL,
      faces: z
        .number()
        .int()
        .min(100)
        .max(200000)
        .optional()
        .describe("Target face count (default 8000)."),
    }),
    async run({ model, faces }, ctx) {
      if (!findBlender()) return noBlender();
      const m = resolveModel(model, ctx);
      if ("error" in m) return failed(m.error);
      const out = outPath(ctx, m.file, "quads", ".glb");
      const r = await retopo(m.file, out, { faces: faces ?? 8000 });
      return {
        text: `Wrote ${out}\n${r.faces} faces (${r.quads} quads) from ${r.before}, by ${r.method}.`,
      };
    },
  }),
  t({
    name: "blender_export",
    title: "Export FBX or USD (Blender)",
    description:
      "Convert a model to FBX (Unity, Unreal, most tools) or USD (film pipelines, Omniverse), keeping its skeleton, skin and animations. Writes to the output folder and says where.",
    input: z.object({ model: MODEL, format: z.enum(["fbx", "usd"]) }),
    async run({ model, format }, ctx) {
      if (!findBlender()) return noBlender();
      const m = resolveModel(model, ctx);
      if ("error" in m) return failed(m.error);
      const out = outPath(
        ctx,
        m.file,
        format,
        format === "fbx" ? ".fbx" : ".usdc",
      );
      const r = await convert(m.file, out);
      return {
        text: `Wrote ${out}\n${r.meshes} mesh(es), ${r.armatures} skeleton(s) with ${r.bones} bones, animations: ${r.actions.join(", ") || "none"}.`,
      };
    },
  }),
  t({
    name: "blender_render",
    title: "Render a model (Blender)",
    description:
      "Render a model in a studio setup (three-point lights, floor, backdrop): a PNG still, or an MP4 of a turntable or of the model's own animation (a creature's walk). EEVEE is fast; Cycles is path traced (slower, more real). Writes to the output folder and says where. Videos take minutes.",
    input: z.object({
      model: MODEL,
      video: z.boolean().optional().describe("An MP4 instead of a still."),
      animation: z
        .boolean()
        .optional()
        .describe("Video: play the model's animation instead of turning it."),
      seconds: z
        .number()
        .min(0.5)
        .max(60)
        .optional()
        .describe("Video length (default 4)."),
      engine: z.enum(["eevee", "cycles"]).optional(),
      width: z.number().int().min(64).max(3840).optional(),
      height: z.number().int().min(64).max(2160).optional(),
    }),
    async run(
      { model, video, animation, seconds, engine, width, height },
      ctx,
    ) {
      if (!findBlender()) return noBlender();
      const m = resolveModel(model, ctx);
      if ("error" in m) return failed(m.error);
      const out = outPath(
        ctx,
        m.file,
        video ? "video" : "render",
        video ? ".mp4" : ".png",
      );
      const r = await render(m.file, out, {
        engine: engine ?? "eevee",
        width: width ?? 1280,
        height: height ?? 720,
        seconds: seconds ?? 4,
        animation: !!animation,
      });
      return {
        text: `Wrote ${out}\n${r.width}×${r.height}, ${r.frames} frame(s), ${r.engine}, ${r.seconds} s.`,
      };
    },
  }),
];
