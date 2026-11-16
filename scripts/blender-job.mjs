// Blender jobs from the command line (and the functions the app and the
// MCP server call): retopology, conversion to FBX/USD, rendering.
//
//   node scripts/blender-job.mjs retopo  in.glb out.glb   [--faces 8000]
//   node scripts/blender-job.mjs convert in.glb out.fbx|out.usdc
//   node scripts/blender-job.mjs render  in.glb out.png|out.mp4
//        [--engine eevee|cycles] [--width 1280] [--height 720]
//        [--samples 64] [--seconds 4] [--fps 24] [--animation]
//
// Each job reads a GLB and writes its result; nothing else on the
// machine changes. Blender runs headless (scripts/blender/run.mjs).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";
import { runBlender } from "./blender/run.mjs";

/** A plain copy of a GLB for Blender, whose importer can't read meshopt
 * compression (how the app ships its models): decoded, dequantised. */
async function plainCopy(input, dir) {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(readFileSync(input)));
  await doc.transform(dequantize());
  for (const e of doc.getRoot().listExtensionsUsed())
    if (
      ["EXT_meshopt_compression", "KHR_mesh_quantization"].includes(
        e.extensionName,
      )
    )
      e.dispose();
  const out = join(dir, "input.glb");
  writeFileSync(out, await io.writeBinary(doc));
  return out;
}

async function withReport(job, args, timeoutMs) {
  const dir = mkdtempSync(join(tmpdir(), "iko-job-"));
  try {
    const report = join(dir, "report.json");
    const input = await plainCopy(args.input, dir);
    await runBlender(job, { ...args, input, report }, { timeoutMs });
    return JSON.parse(readFileSync(report, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** What this machine's Blender can do, each tried for real
 * (scripts/blender/probe.py): {version, gltf, fbx, usd, render}.
 * @param {{ timeoutMs?: number }} [opts] */
export async function probe({ timeoutMs = 120_000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "iko-probe-"));
  try {
    const report = join(dir, "report.json");
    await runBlender("probe.py", { report }, { timeoutMs });
    return JSON.parse(readFileSync(report, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A dense mesh as a clean quad mesh of about `faces` faces.
 * @param {string} input
 * @param {string} output
 * @param {{ faces?: number, timeoutMs?: number }} [opts] */
export function retopo(input, output, { faces = 8000, timeoutMs } = {}) {
  if (!Number.isInteger(faces) || faces < 100 || faces > 200_000)
    throw new Error("faces: a whole number from 100 to 200,000");
  return withReport(
    "retopo.py",
    {
      input: resolve(input),
      output: resolve(output),
      faces,
    },
    timeoutMs,
  );
}

/** A GLB as FBX or USD (format from the output's extension).
 * @param {string} input
 * @param {string} output
 * @param {{ timeoutMs?: number }} [opts] */
export function convert(input, output, { timeoutMs } = {}) {
  const ext = extname(output).toLowerCase();
  const format =
    ext === ".fbx"
      ? "fbx"
      : [".usd", ".usdc", ".usda"].includes(ext)
        ? "usd"
        : null;
  if (!format) throw new Error("output: .fbx, .usd, .usdc or .usda");
  return withReport(
    "convert.py",
    {
      input: resolve(input),
      output: resolve(output),
      format,
    },
    timeoutMs,
  );
}

/** A still (.png) or a video (.mp4: a turntable, or the animation).
 * @param {string} input
 * @param {string} output
 * @param {{ engine?: string, width?: number, height?: number, samples?: number, seconds?: number, fps?: number, animation?: boolean, timeoutMs?: number }} [opts] */
export function render(
  input,
  output,
  {
    engine = "eevee",
    width = 1280,
    height = 720,
    samples = 64,
    seconds = 4,
    fps = 24,
    animation = false,
    timeoutMs,
  } = {},
) {
  const ext = extname(output).toLowerCase();
  if (![".png", ".mp4"].includes(ext)) throw new Error("output: .png or .mp4");
  if (!["eevee", "cycles"].includes(engine))
    throw new Error("engine: eevee or cycles");
  const whole = (v, lo, hi, name) => {
    if (!Number.isInteger(v) || v < lo || v > hi)
      throw new Error(`${name}: a whole number from ${lo} to ${hi}`);
  };
  whole(width, 16, 7680, "width");
  whole(height, 16, 4320, "height");
  whole(samples, 1, 4096, "samples");
  whole(fps, 1, 120, "fps");
  if (!(seconds > 0 && seconds <= 600)) throw new Error("seconds: 0 to 600");
  return withReport(
    "render.py",
    {
      input: resolve(input),
      output: resolve(output),
      engine,
      width,
      height,
      samples,
      video: ext === ".mp4" ? { seconds, fps, turntable: !animation } : null,
    },
    timeoutMs,
  );
}

async function main() {
  const [job, input, output, ...rest] = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i].replace(/^--/, "");
    if (k === "animation") opts.animation = true;
    else {
      const v = rest[++i];
      opts[k] = ["engine"].includes(k) ? v : Number(v);
    }
  }
  const jobs = { retopo, convert, render };
  if (!jobs[job] || !input || !output) {
    console.error(
      "usage: node scripts/blender-job.mjs retopo|convert|render in.glb out [options]",
    );
    process.exit(1);
  }
  const t0 = Date.now();
  const report = await jobs[job](input, output, opts);
  console.log(
    JSON.stringify(report),
    `(${((Date.now() - t0) / 1000).toFixed(0)} s)`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
