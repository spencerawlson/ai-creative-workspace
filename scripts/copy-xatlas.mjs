// Copies the xatlas UV unwrapper (a web worker and its WebAssembly) from
// node_modules into public/xatlas, so the site serves it itself (no
// third-party origins; see next.config.ts). Runs before `dev` and `build`.
// Used by lib/sculpt/unwrap.ts when exporting textured models.
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules/xatlasjs/dist");
const to = join(root, "public/xatlas");
const FILES = ["xatlas.js", "xatlas.wasm"];

mkdirSync(to, { recursive: true });
for (const f of FILES) {
  const src = join(from, f);
  const dst = join(to, f);
  const same = (() => {
    try {
      const a = statSync(src);
      const b = statSync(dst);
      return a.size === b.size && a.mtimeMs <= b.mtimeMs;
    } catch {
      return false;
    }
  })();
  if (!same) copyFileSync(src, dst);
}
console.log(`xatlas unwrapper ready in public/xatlas`);
