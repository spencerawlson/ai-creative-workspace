/** Auto-rigging for the app's server (app/api/rig): a model with no
 * skeleton goes in, comes back rigged for its body (scripts/
 * auto-rig.mjs: a human skeleton, or an animal's with a walk).
 *
 * Offered when the server opts in to heavy jobs (IKO_AUTORIG=1, or
 * IKO_BLENDER=1, which already says so). A rig takes about a minute of
 * CPU, so it runs as its own process, never in the server's: other
 * requests carry on meanwhile. One at a time, a size limit, must be a
 * GLB, a time limit; files live in a fresh temporary folder. */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The same limit as an imported character (lib/studio/characters). */
export const MAX_RIG_UPLOAD = 100 * 1024 * 1024;
const TIME_LIMIT_MS = 8 * 60_000;

export type RigKind = "human" | "quadruped" | "biped";

export function rigOffered(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.IKO_AUTORIG === "1" || env.IKO_BLENDER === "1";
}

let busy = false;

export class RigError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** What the rigger printed last: "wrote <file> (<kind> rig)". */
export function rigKindFrom(output: string): RigKind | null {
  const m = /\((human|quadruped|biped) rig\)\s*$/m.exec(output);
  return m ? (m[1] as RigKind) : null;
}

/** The rigger's own reason, when it refuses a model (its last error). */
export function rigRefusal(output: string): string | null {
  const m = /Error: ([^\n]+)/.exec(output);
  return m ? m[1].trim() : null;
}

export async function runRig(
  glb: Uint8Array,
): Promise<{ bytes: Uint8Array; kind: RigKind }> {
  if (glb.length > MAX_RIG_UPLOAD)
    throw new RigError("That model is too large to rig here.", 413);
  if (
    glb.length < 12 ||
    String.fromCharCode(glb[0], glb[1], glb[2], glb[3]) !== "glTF"
  )
    throw new RigError("That isn't a GLB model.", 400);
  if (busy)
    throw new RigError(
      "Another model is being rigged. Try again in a minute.",
      503,
    );
  busy = true;
  const dir = mkdtempSync(join(tmpdir(), "iko-rig-"));
  try {
    const input = join(dir, "in.glb");
    const output = join(dir, "out.glb");
    writeFileSync(input, glb);
    const out = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [join(process.cwd(), "scripts", "auto-rig.mjs"), input, output],
        { stdio: ["ignore", "pipe", "pipe"], cwd: process.cwd() },
      );
      let text = "";
      child.stdout.on("data", (b) => (text += b));
      child.stderr.on("data", (b) => (text += b));
      const timer = setTimeout(() => child.kill(), TIME_LIMIT_MS);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(text);
        else
          reject(
            new RigError(
              rigRefusal(text) ?? "The model couldn't be rigged.",
              422,
            ),
          );
      });
    });
    const kind = rigKindFrom(out);
    if (!kind) throw new RigError("The model couldn't be rigged.", 422);
    return { bytes: readFileSync(output), kind };
  } finally {
    busy = false;
    rmSync(dir, { recursive: true, force: true });
  }
}
