// Make the built-in cast with Meshy, then slim it for the app.
//
//   npm run cast -- --dry-run         what would run, and the credits
//   npm run cast                      make every character in the spec
//   npm run cast -- --only dancer     just one (or a comma list)
//   npm run cast -- --optimize-only   re-slim downloads, rewrite the list
//
// The key comes from MESHY_API_KEY (on Windows, scripts/meshy-cast.ps1
// sets it from the encrypted copy saved by scripts/meshy-save-key.ps1).
// It is only ever sent to api.meshy.ai, never printed or written down.
//
// Files: assets/cast/cast.spec.json (who to make, committed),
// assets/cast/state.json (task ids and credits, committed: it's the
// record of where each character came from), assets/cast/source/*.glb
// (Meshy's downloads, not committed: large), public/cast/*.glb and
// public/cast/cast.json (what the app serves, committed).

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createMeshy } from "./meshy/client.mjs";
import { estimate, makeCast, manifest, readSpec } from "./meshy/cast.mjs";
import { optimizeCast } from "./meshy/optimize-cast.mjs";

const SPEC = "assets/cast/cast.spec.json";
const STATE = "assets/cast/state.json";
const SOURCE = "assets/cast/source";
const OUT = "public/cast";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const only = (() => {
  const i = args.indexOf("--only");
  return i >= 0 ? args[i + 1]?.split(",") : undefined;
})();

const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
};
const saveJson = (path, data) =>
  writeFile(path, JSON.stringify(data, null, 2) + "\n");

const cast = readSpec(await readJson(SPEC, null));
const state = await readJson(STATE, {});
const { total, lines } = estimate(cast, state, only);
console.log(lines.join("\n"));
console.log(`Credits to spend: ${total}`);

if (flag("dry-run")) process.exit(0);

if (!flag("optimize-only")) {
  const meshy = createMeshy({
    key: process.env.MESHY_API_KEY ?? "",
    log: (l) => console.log(l),
  });
  await mkdir(SOURCE, { recursive: true });
  const { failed } = await makeCast({
    cast,
    state,
    meshy,
    only,
    saveState: (s) => saveJson(STATE, s),
    writeSource: async (id, bytes) => {
      const path = join(SOURCE, `${id}.glb`);
      await writeFile(path, bytes);
      return path.replaceAll("\\", "/");
    },
    log: (l) => console.log(l),
  });
  if (failed.length) process.exitCode = 1;
}

// Slim every downloaded character that's newer than its served copy.
await mkdir(OUT, { recursive: true });
const sizes = {};
for (const m of cast) {
  const s = state[m.id];
  const out = join(OUT, `${m.id}.glb`);
  if (!s?.file || s.prompt !== m.prompt) continue;
  const [src, done] = await Promise.all([
    stat(s.file).catch(() => null),
    stat(out).catch(() => null),
  ]);
  if (src && (!done || src.mtimeMs > done.mtimeMs || flag("optimize-only"))) {
    try {
      const r = await optimizeCast(await readFile(s.file));
      await writeFile(out, r.bytes);
      console.log(
        `${m.id}: ${r.info.triangles} triangles, ${r.info.joints.length} joints, ${(r.bytes.length / 1048576).toFixed(1)} MB → ${out}`,
      );
    } catch (e) {
      console.log(`${m.id}: ${e.message}`);
      process.exitCode = 1;
      continue;
    }
  }
  const served = await stat(out).catch(() => null);
  if (served) sizes[m.id] = served.size;
}
await saveJson(join(OUT, "cast.json"), manifest(cast, state, sizes));
console.log(`${OUT}/cast.json: ${Object.keys(sizes).length} characters`);
