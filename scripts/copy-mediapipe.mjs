// Copies MediaPipe's WebAssembly runtime from node_modules into
// public/mediapipe/wasm, so the site serves it itself (no third-party
// origins; see next.config.ts). Runs before `dev` and `build`. The
// pose model (public/mediapipe/pose_landmarker_full.task) is committed.
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const to = join(root, "public/mediapipe/wasm");
// The loader picks the SIMD build, or the other on browsers without it.
const FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

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
console.log(`MediaPipe runtime ready in public/mediapipe/wasm`);
