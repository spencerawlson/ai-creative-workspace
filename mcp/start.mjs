// Starts the I-K-O 3D MCP server (mcp/server.ts) from any folder: MCP
// clients launch it with `node <repo>/mcp/start.mjs`. tsx runs the
// TypeScript directly, with the repo's tsconfig for its "@/" imports.
// The repo isn't "type": "module", so tsx loads .ts files as CommonJS:
// both of its hooks are registered, and both read the tsconfig path
// from TSX_TSCONFIG_PATH.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register as registerCjs } from "tsx/cjs/api";
import { register } from "tsx/esm/api";

const here = dirname(fileURLToPath(import.meta.url));
process.env.TSX_TSCONFIG_PATH = join(here, "..", "tsconfig.json");
registerCjs();
register();

try {
  const { main } = createRequire(import.meta.url)("./server.ts");
  await main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
