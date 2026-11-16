// Slim rigged creatures for the app, preserving skeleton, skin weights
// and the "walk" clip. Mirrors scripts/meshy/optimize-cast.mjs but with
// an animal-appropriate skeleton check (no texture step: the creatures
// are untextured grey).
//
//   node scripts/slim-animals.mjs [--only lion,elephant]
// Reads assets/creatures/rigged/<id>.glb, writes public/creatures/<id>.glb
// and regenerates public/creatures/creatures.json (keeps the existing
// entries' id/name/heightMeters/credit, updates size).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, quantize } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";

const RIGGED = "assets/creatures/rigged";
const OUT = "public/creatures";
const LIST = join(OUT, "creatures.json");

const SPECIES = [
  "lion",
  "elephant",
  "hippo",
  "rhino",
  "tiger",
  "cat",
  "dog-standing",
  "dog-side",
  "gorilla",
  "monkey",
  "rat",
  "bird",
];

// Bones each species must have (names from the rig spec).
const REQUIRED = {
  quad: [
    "root",
    "spine",
    "chest",
    "neck",
    "head",
    "tail1",
    "legFL",
    "legFLLower",
    "footFL",
    "legFR",
    "legFRLower",
    "footFR",
    "legBL",
    "legBLLower",
    "footBL",
    "legBR",
    "legBRLower",
    "footBR",
  ],
  biped: [
    "root",
    "pelvis",
    "spine",
    "neck",
    "head",
    "legL",
    "legLLower",
    "footL",
    "legR",
    "legRLower",
    "footR",
    "armL",
    "armLLower",
    "handL",
    "armR",
    "armRLower",
    "handR",
  ],
  bird: [
    "root",
    "spine",
    "neck",
    "head",
    "tail1",
    "legL",
    "legLLower",
    "footL",
    "legR",
    "legRLower",
    "footR",
    "wingL",
    "wingLLower",
    "wingR",
    "wingRLower",
  ],
  rat: [
    "root",
    "pelvis",
    "spine",
    "neck",
    "head",
    "legL",
    "legLLower",
    "footL",
    "legR",
    "legRLower",
    "footR",
    "armL",
    "armLLower",
    "handL",
    "armR",
    "armRLower",
    "handR",
    "tail1",
    "tail2",
    "tail3",
  ],
};
const TYPE = {
  lion: "quad",
  elephant: "quad",
  hippo: "quad",
  rhino: "quad",
  tiger: "quad",
  cat: "quad",
  "dog-standing": "quad",
  "dog-side": "quad",
  gorilla: "biped",
  monkey: "biped",
  rat: "rat",
  bird: "bird",
};

async function io() {
  await MeshoptEncoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
}

function inspect(doc) {
  const root = doc.getRoot();
  let triangles = 0;
  for (const mesh of root.listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      triangles +=
        (idx ? idx.getCount() : prim.getAttribute("POSITION").getCount()) / 3;
    }
  const joints = [...new Set(root.listSkins().flatMap((s) => s.listJoints()))];
  const anims = root.listAnimations().map((a) => {
    const times = a
      .listSamplers()
      .flatMap((s) => s.getInput().getArray() ?? []);
    return {
      name: a.getName(),
      duration: times.length ? Math.max(...times) : 0,
    };
  });
  return {
    triangles: Math.round(triangles),
    skins: root.listSkins().length,
    joints: joints.map((j) => j.getName()),
    animations: anims,
  };
}

const args = process.argv.slice(2);
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(",") : null;
const list = only ? SPECIES.filter((s) => only.includes(s)) : SPECIES;

const glb = await io();
await mkdir(OUT, { recursive: true });
const sizes = {};
for (const id of list) {
  const src = join(RIGGED, `${id}.glb`);
  const bytes = await readFile(src);
  const doc = await glb.readBinary(bytes);
  const before = inspect(doc);
  const need = REQUIRED[TYPE[id]];
  const missing = need.filter((b) => !before.joints.includes(b));
  if (before.skins === 0) throw new Error(`${id}: no skin in rigged GLB`);
  if (missing.length)
    throw new Error(`${id}: missing bones: ${missing.join(", ")}`);
  const walk = before.animations.find((a) => a.name === "walk");
  if (!walk) throw new Error(`${id}: no "walk" animation in rigged GLB`);
  if (Math.abs(walk.duration - 1.0) > 0.1)
    throw new Error(`${id}: "walk" duration ${walk.duration}s, expected ~1.0s`);
  await doc.transform(
    dedup(),
    prune(),
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  const out = await glb.writeBinary(doc);
  const after = inspect(doc);
  const walkAfter = after.animations.find((a) => a.name === "walk");
  if (!walkAfter) throw new Error(`${id}: "walk" lost in slimming`);
  const missingAfter = need.filter((b) => !after.joints.includes(b));
  if (after.skins === 0 || missingAfter.length)
    throw new Error(
      `${id}: skeleton lost in slimming: ${missingAfter.join(", ")}`,
    );
  await writeFile(join(OUT, `${id}.glb`), out);
  sizes[id] = out.length;
  console.log(
    `${id}: ${before.triangles} tris -> ${after.triangles} tris, ` +
      `${(bytes.length / 1024).toFixed(0)} KB -> ${(out.length / 1024).toFixed(0)} KB, ` +
      `${after.joints.length} joints, walk ${walkAfter.duration.toFixed(2)}s`,
  );
}

// Regenerate the list, keeping each entry's id/name/heightMeters/credit.
const prev = JSON.parse(await readFile(LIST, "utf8"));
const entries = prev.creatures.map((e) => ({
  ...e,
  size: sizes[e.file.replace(".glb", "")] ?? e.size,
}));
await writeFile(
  LIST,
  JSON.stringify({ version: 1, creatures: entries }, null, 2) + "\n",
);
console.log(`${LIST}: ${entries.length} creatures`);
