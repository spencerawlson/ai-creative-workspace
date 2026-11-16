// Runs a Blender Python job headless: Blender as a background worker,
// never linked into the app (it runs as its own program, so its GPL
// licence stays with it). Jobs live next to this file as *.py; each
// reads one JSON file of arguments and writes its result where the
// arguments say.
//
// Blender is found from $BLENDER, then `blender` on the PATH, then the
// usual install folders (Windows: Program Files\Blender Foundation\
// Blender <version>, newest first; Linux: /usr/bin, /snap/bin, /opt).

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the *.py jobs are: next to this file, or (when a bundler has
 * moved this code, as Next does for the app's server) in
 * scripts/blender under the working folder. */
function jobPath(job) {
  for (const dir of [HERE, join(process.cwd(), "scripts", "blender")]) {
    const p = join(dir, job);
    if (existsSync(p)) return p;
  }
  throw new Error(`Blender job ${job} not found.`);
}

/** Path to the Blender executable, or null. */
export function findBlender() {
  if (process.env.BLENDER && existsSync(process.env.BLENDER))
    return process.env.BLENDER;
  const which = spawnSync(process.platform === "win32" ? "where" : "which", [
    "blender",
  ]);
  if (which.status === 0) {
    const first = which.stdout.toString().split(/\r?\n/)[0].trim();
    if (first) return first;
  }
  if (process.platform === "win32") {
    const base = "C:\\Program Files\\Blender Foundation";
    if (existsSync(base)) {
      const versions = readdirSync(base)
        .filter((d) => /^Blender/.test(d))
        .sort((a, b) =>
          b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }),
        );
      for (const v of versions) {
        const exe = join(base, v, "blender.exe");
        if (existsSync(exe)) return exe;
      }
    }
  } else {
    for (const p of [
      "/usr/bin/blender",
      "/usr/local/bin/blender",
      "/snap/bin/blender",
    ])
      if (existsSync(p)) return p;
    if (existsSync("/opt"))
      for (const d of readdirSync("/opt").filter((d) => /blender/i.test(d))) {
        const exe = join("/opt", d, "blender");
        if (existsSync(exe)) return exe;
      }
  }
  return null;
}

/** Run `job` (a *.py next to this file) with `args`; resolves with its
 * console output, rejects with it when the job fails. */
export function runBlender(job, args, { timeoutMs = 30 * 60_000, log } = {}) {
  const blender = findBlender();
  if (!blender)
    return Promise.reject(
      new Error("Blender isn't installed (or set BLENDER to its path)."),
    );
  const dir = mkdtempSync(join(tmpdir(), "iko-blender-"));
  const argFile = join(dir, "args.json");
  writeFileSync(argFile, JSON.stringify(args));
  return new Promise((resolve, reject) => {
    const child = spawn(
      blender,
      [
        "--background",
        "--factory-startup",
        "--python-exit-code",
        "1",
        "--python",
        jobPath(job),
        "--",
        argFile,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    const take = (b) => {
      const s = b.toString();
      out += s;
      log?.(s);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      rmSync(dir, { recursive: true, force: true });
      if (code === 0) resolve(out);
      else
        reject(
          new Error(
            `Blender job ${job} failed (exit ${code}):\n${out.slice(-2000)}`,
          ),
        );
    });
  });
}
