/** Blender jobs for the app's own server (app/api/blender): a model the
 * browser built (a GLB) goes in, the result comes back.
 *
 * Off unless the server opts in (IKO_BLENDER=1) and Blender is
 * installed. Then, because each job starts a heavy program:
 * - one job at a time (another waits for a "busy" answer),
 * - a size limit on what's sent, and it must be a GLB,
 * - only these jobs, with checked settings (no paths, nothing to run),
 * - a time limit per job.
 * Files live in a fresh temporary folder, removed afterwards. */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { convert, probe, render, retopo } from "@/scripts/blender-job.mjs";
import { findBlender } from "@/scripts/blender/run.mjs";

/** Largest model accepted (a 4K-textured sculpture is ~30 MB). */
export const MAX_UPLOAD = 64 * 1024 * 1024;
/** A job past this is stopped. */
const TIME_LIMIT_MS = 10 * 60_000;

export function blenderOffered(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.IKO_BLENDER === "1" && !!findBlender();
}

/** Which jobs this server's Blender can do (the app shows only these). */
export interface BlenderJobs {
  fbx: boolean;
  usd: boolean;
  quads: boolean;
  render: boolean;
}
const NONE: BlenderJobs = {
  fbx: false,
  usd: false,
  quads: false,
  render: false,
};

/** Abilities to jobs: every job reads the model as glTF first. */
export function jobsFrom(p: {
  gltf?: boolean;
  fbx?: boolean;
  usd?: boolean;
  render?: boolean;
}): BlenderJobs {
  const g = !!p.gltf;
  return {
    fbx: g && !!p.fbx,
    usd: g && !!p.usd,
    quads: g,
    render: g && !!p.render,
  };
}

let probed: Promise<BlenderJobs> | null = null;
/** Probed once per server (a few seconds), then remembered. */
export function blenderJobs(): Promise<BlenderJobs> {
  if (!blenderOffered()) return Promise.resolve(NONE);
  probed ??= probe()
    .then(jobsFrom)
    .catch(() => NONE);
  return probed;
}

export const JobSettings = {
  convert: z.object({ format: z.enum(["fbx", "usd"]) }),
  retopo: z.object({ faces: z.coerce.number().int().min(500).max(50_000) }),
  render: z.object({
    engine: z.enum(["eevee", "cycles"]).default("eevee"),
    size: z.enum(["1080p", "720p", "square"]).default("1080p"),
  }),
} as const;
export type JobName = keyof typeof JobSettings;
/** Own keys only: `in` would also accept "__proto__", "constructor"…. */
export const isJob = (j: string): j is JobName =>
  Object.prototype.hasOwnProperty.call(JobSettings, j);

const SIZES = {
  "1080p": [1920, 1080],
  "720p": [1280, 720],
  square: [1080, 1080],
} as const;

/** What a job gives back: the file and how to name it. */
export interface JobResult {
  bytes: Uint8Array;
  type: string;
  ext: string;
}

let busy = false;
export const blenderBusy = () => busy;

export class JobError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Run `job` on `glb` with raw settings (from the URL). */
export async function runJob(
  job: JobName,
  glb: Uint8Array,
  raw: Record<string, string>,
): Promise<JobResult> {
  if (glb.length > MAX_UPLOAD)
    throw new JobError("That model is too large to send to Blender.", 413);
  if (
    glb.length < 12 ||
    String.fromCharCode(glb[0], glb[1], glb[2], glb[3]) !== "glTF"
  )
    throw new JobError("That isn't a GLB model.", 400);
  const parsed = JobSettings[job].safeParse(raw);
  if (!parsed.success)
    throw new JobError(`Bad settings for ${job}: ${parsed.error.message}`, 400);
  if (busy)
    throw new JobError(
      "Blender is busy with another job. Try again in a moment.",
      503,
    );
  busy = true;
  const dir = mkdtempSync(join(tmpdir(), "iko-app-blender-"));
  try {
    const input = join(dir, "model.glb");
    writeFileSync(input, glb);
    const timeoutMs = TIME_LIMIT_MS;
    if (job === "convert") {
      const { format } = parsed.data as z.infer<typeof JobSettings.convert>;
      const ext = format === "fbx" ? ".fbx" : ".usdc";
      const out = join(dir, `out${ext}`);
      await convert(input, out, { timeoutMs });
      return {
        bytes: readFileSync(out),
        type: "application/octet-stream",
        ext,
      };
    }
    if (job === "retopo") {
      const { faces } = parsed.data as z.infer<typeof JobSettings.retopo>;
      const out = join(dir, "out.glb");
      await retopo(input, out, { faces, timeoutMs });
      return {
        bytes: readFileSync(out),
        type: "model/gltf-binary",
        ext: ".glb",
      };
    }
    const { engine, size } = parsed.data as z.infer<typeof JobSettings.render>;
    const [width, height] = SIZES[size];
    const out = join(dir, "out.png");
    await render(input, out, { engine, width, height, samples: 64, timeoutMs });
    return { bytes: readFileSync(out), type: "image/png", ext: ".png" };
  } finally {
    busy = false;
    rmSync(dir, { recursive: true, force: true });
  }
}
