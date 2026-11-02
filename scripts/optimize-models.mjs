// Builds the served mannequin GLBs in public/models/ from the source
// scans in assets/source/. Run with `npm run models` after replacing a
// source file. Output is deterministic for a given source + settings.
//
// Pipeline: dedup -> weld -> simplify (bounded error, keeps facial
// planes) -> quantize -> EXT_meshopt_compression. The scene replaces
// every material at load time, so materials are not preserved here.

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup,
  meshopt,
  prune,
  quantize,
  simplify,
  weld,
} from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const SRC = "assets/source";
const OUT = "public/models";
/** Fraction of triangles to keep, and the max allowed geometric error
 * as a fraction of the mesh radius. Error wins over ratio, so flat
 * regions are reduced and curved ones (nose, brow, cheek) keep detail. */
const RATIO = 0.3;
const ERROR = 0.0008;

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
await MeshoptSimplifier.ready;
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
    simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: ERROR }),
    prune(),
    quantize({ quantizePosition: 14, quantizeNormal: 10 }),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  await io.write(out, doc);
  const [a, b] = [await stat(src), await stat(out)];
  console.log(
    `${file}: ${before} -> ${triangleCount(doc)} tris, ` +
      `${(a.size / 1e6).toFixed(1)} MB -> ${(b.size / 1e6).toFixed(2)} MB  (${out})`,
  );
}
