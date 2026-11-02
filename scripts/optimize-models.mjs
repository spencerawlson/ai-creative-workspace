// Builds the served mannequin GLBs in public/models/ from the source
// scans in assets/source/. Run with `npm run models` after replacing a
// source file. Output is deterministic for a given source + settings.
//
// Pipeline: dedup -> weld -> rig (skeleton + skin weights, see
// rig-mannequin.mjs) -> quantize -> EXT_meshopt_compression.
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
import { BONES, rigMesh } from "./rig-mannequin.mjs";

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

/** gltf-transform step: fit a skeleton to the (welded) mesh and bind it. */
function rig() {
  return (doc) => {
    const root = doc.getRoot();
    const [node] = root.listNodes().filter((n) => n.getMesh());
    const prim = node.getMesh().listPrimitives()[0];
    const pos = prim.getAttribute("POSITION").getArray();
    const r = rigMesh(pos, prim.getIndices().getArray());
    const buffer = root.listBuffers()[0];

    prim.setAttribute(
      "JOINTS_0",
      doc
        .createAccessor()
        .setType("VEC4")
        .setArray(r.jointIdx)
        .setBuffer(buffer),
    );
    prim.setAttribute(
      "WEIGHTS_0",
      doc
        .createAccessor()
        .setType("VEC4")
        .setArray(r.weights)
        .setBuffer(buffer),
    );

    // World-aligned bones: local translation = offset from the parent.
    const nodes = {};
    const ibm = new Float32Array(BONES.length * 16);
    BONES.forEach(([name, parent], i) => {
      const j = r.joints[name];
      const p = parent ? r.joints[parent] : [0, 0, 0];
      nodes[name] = doc
        .createNode(name)
        .setTranslation([j[0] - p[0], j[1] - p[1], j[2] - p[2]]);
      if (parent) nodes[parent].addChild(nodes[name]);
      // Inverse bind matrix: translate(-joint), column-major.
      ibm.set(
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -j[0], -j[1], -j[2], 1],
        i * 16,
      );
    });
    const skin = doc
      .createSkin("mannequin")
      .setSkeleton(nodes.pelvis)
      .setInverseBindMatrices(
        doc.createAccessor().setType("MAT4").setArray(ibm).setBuffer(buffer),
      );
    for (const [name] of BONES) skin.addJoint(nodes[name]);
    node.setSkin(skin);
    // Limb tips (fingertips, toes, crown) let the runtime size its
    // picking capsules without reading the mesh.
    node.setExtras({ rig: { version: 1, tips: r.tips } });
    root.listScenes()[0].addChild(nodes.pelvis);
    console.log(`  rigged: ${JSON.stringify(r.stats.labelCounts)}`);
  };
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
    rig(),
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
