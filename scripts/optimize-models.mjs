// Builds the served mannequin GLBs in public/models/ from the source
// scans in assets/source/. Run with `npm run models` after replacing a
// source file. Output is deterministic for a given source + settings.
//
// Pipeline: dedup -> weld -> quantize -> EXT_meshopt_compression.
// The scene replaces every material at load time, so materials are not
// preserved here.
//
// No simplification, on purpose: A/B renders of the Rembrandt face
// close-up showed meshopt simplify (even at 60% kept, 1e-4 error)
// leaves blotchy shading on the brow and cheek planes — the exact area
// the lesson is about. Compression alone is visually identical to the
// source. A lighter mobile LOD is future work and needs normal re-baking.

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup,
  meshopt,
  prune,
  quantize,
  weld,
} from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";

const SRC = "assets/source";
const OUT = "public/models";

function triangleCount(doc) {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      tris +=
        (idx ? idx.getCount() : prim.getAttribute("POSITION").getCount()) / 3;
    }
  }
  return tris;
}

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });

for (const file of await readdir(SRC)) {
  if (!file.endsWith(".glb")) continue;
  const src = join(SRC, file);
  const out = join(OUT, file.replace("meshy-body-", "mannequin-"));
  const doc = await io.read(src);
  const before = triangleCount(doc);
  await doc.transform(
    dedup(),
    weld(),
    prune(),
    quantize({ quantizePosition: 14, quantizeNormal: 12 }),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  await io.write(out, doc);
  const [a, b] = [await stat(src), await stat(out)];
  console.log(
    `${file}: ${before} -> ${triangleCount(doc)} tris, ` +
      `${(a.size / 1e6).toFixed(1)} MB -> ${(b.size / 1e6).toFixed(2)} MB  (${out})`,
  );
}
