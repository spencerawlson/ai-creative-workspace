// A cast member's GLB as the app serves it: Meshy's rigged download,
// slimmed for phones like the mannequins (meshopt geometry), keeping
// its skeleton and its own materials, with textures shrunk to 1024 px
// WebP. Checked to be a skinned humanoid before it's written.

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup,
  meshopt,
  prune,
  quantize,
  textureCompress,
} from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

/** Bones a character needs for the app to pose it (any common naming:
 * Mixamo's "mixamorig:Hips", plain "Hips", VRM's "J_Bip_C_Hips"...). */
const NEEDED = ["hips", "spine", "head", "arm", "forearm", "upleg", "leg"];

async function io() {
  await MeshoptEncoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
}

/** What's in a GLB: triangles, joints, textures. */
export function inspect(doc) {
  const root = doc.getRoot();
  let triangles = 0;
  for (const mesh of root.listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      triangles +=
        (idx ? idx.getCount() : prim.getAttribute("POSITION").getCount()) / 3;
    }
  // Skins may share bones (one per skinned mesh): each bone once.
  const joints = [...new Set(root.listSkins().flatMap((s) => s.listJoints()))];
  return {
    triangles: Math.round(triangles),
    skins: root.listSkins().length,
    joints: joints.map((j) => j.getName()),
    textures: root.listTextures().length,
  };
}

/** Why a GLB can't be a cast member, or null. */
export function problem(info) {
  if (info.skins === 0) return "it has no skeleton (skin)";
  const names = info.joints.map((n) => n.toLowerCase().replace(/[^a-z]/g, ""));
  const missing = NEEDED.filter((b) => !names.some((n) => n.endsWith(b)));
  return missing.length
    ? `its skeleton has no ${missing.join(", ")} bone${missing.length > 1 ? "s" : ""}`
    : null;
}

/** Slim `bytes` (a rigged GLB) for the app; returns the new bytes and
 * what's in them, or throws why it can't be used. */
export async function optimizeCast(bytes) {
  const glb = await io();
  const doc = await glb.readBinary(bytes);
  const before = inspect(doc);
  const why = problem(before);
  if (why) throw new Error(`Not usable as a character: ${why}.`);
  await doc.transform(
    dedup(),
    prune(),
    textureCompress({
      encoder: sharp,
      targetFormat: "webp",
      resize: [1024, 1024],
    }),
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  const out = await glb.writeBinary(doc);
  return { bytes: out, info: inspect(doc), before };
}
