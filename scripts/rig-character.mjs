// Rigs an unrigged humanoid GLB (a Meshy character, A-pose) for the
// app's cast: `node scripts/rig-character.mjs in.glb out.glb`.
//
// 1. Body: scripts/rig-mannequin.mjs fits the 45-bone skeleton.
// 2. Shoulders: that fit reads each shoulder from the armpit's slice;
//    on a stylised body one side can land well off the other. A
//    symmetric figure's shoulders are mirrored, so a pair more than 15%
//    apart is set to their mirrored average.
// 3. Hands: thumb and fingers from scripts/rig-hands.mjs, which works
//    whichever way the hand faces (the mannequin fit expects the scan's
//    hanging hands and leaves others rigid, which the app can't pose).
// 4. Weights: Blender's automatic weights (scripts/blender-weights.mjs)
//    when Blender is installed, else bone heat (scripts/reskin-cast.mjs).
// 5. Slimmed as the cast is: quantised, meshopt.
//
// Fails, rather than writing a hand the app can't pose, when a hand
// doesn't show a thumb and four fingers.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup,
  meshopt,
  prune,
  quantize,
  weld,
} from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { adjacency, findFingers } from "./rig-hands.mjs";
import { BONES, rigTransform } from "./rig-mannequin.mjs";
import { findBlender } from "./blender/run.mjs";
import { blenderWeights } from "./blender-weights.mjs";
import { reskinDocument } from "./reskin-cast.mjs";

const FINGERS = ["index", "middle", "ring", "pinky"];

/** Mirror-average a left/right pair that has drifted apart. */
function symmetrise(world, a, b, log) {
  const L = world[a];
  const R = world[b];
  const xl = Math.abs(L[0]);
  const xr = Math.abs(R[0]);
  if (Math.abs(xl - xr) <= 0.15 * ((xl + xr) / 2)) return;
  const x = (xl + xr) / 2;
  const y = (L[1] + R[1]) / 2;
  const z = (L[2] + R[2]) / 2;
  log(
    `  ${a}/${b}: |x| ${xl.toFixed(3)} / ${xr.toFixed(3)} → ${x.toFixed(3)} both`,
  );
  world[a] = [Math.sign(L[0]) * x, y, z];
  world[b] = [Math.sign(R[0]) * x, y, z];
}

/** Rig `doc` (one mesh, unrigged) in place. */
export async function rigCharacter(doc, glb, log = console.log) {
  await doc.transform(dedup(), weld(), rigTransform("character"), prune());
  const root = doc.getRoot();
  const node = root.listNodes().find((n) => n.getMesh() && n.getSkin());
  const skin = node.getSkin();
  const prim = node.getMesh().listPrimitives()[0];
  const pos = prim.getAttribute("POSITION").getArray();
  const index = prim.getIndices().getArray();
  const byName = new Map(skin.listJoints().map((j) => [j.getName(), j]));
  const world = Object.fromEntries(
    BONES.map(([name]) => [name, byName.get(name).getWorldTranslation()]),
  );
  const extras = node.getExtras();
  const tips = extras.rig.tips;
  /** Where each finger's first bone's skin starts (see rig-hands). */
  const skinFrom = {};

  symmetrise(world, "shoulderL", "shoulderR", log);

  const adj = adjacency(pos.length / 3, index);
  const hands = Object.fromEntries(
    ["L", "R"].map((s) => [
      s,
      findFingers(
        pos,
        adj,
        world[`wrist${s}`],
        tips[`wrist${s}`],
        world[`elbow${s}`],
      ),
    ]),
  );
  // Hands without separate fingers (fists, mittens, an ape's knuckles):
  // no finger bones at all, and the hands stay whole. The app poses a
  // skeleton without fingers; finger bones squeezed onto the wrist
  // would break it.
  const fingerless = !hands.L.thumb || !hands.R.thumb;
  if (fingerless) {
    log(
      `  hands: no thumb and four fingers (L ${hands.L.found}, R ${hands.R.found} finger-like pieces): rigged without finger bones`,
    );
    const finger = /^(thumb|index|middle|ring|pinky)[123][LR]$/;
    for (const j of skin.listJoints())
      if (finger.test(j.getName())) {
        skin.removeJoint(j);
        j.dispose();
      }
    // The old weights point at the removed bones' places: put every
    // vertex on the first bone until the weights are worked out below.
    const n = pos.length / 3;
    const J = new Uint16Array(n * 4);
    const W = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) W[i * 4] = 1;
    prim.getAttribute("JOINTS_0").setArray(J);
    prim.getAttribute("WEIGHTS_0").setArray(W);
  }
  for (const s of fingerless ? [] : ["L", "R"]) {
    const hand = hands[s];
    log(
      `  ${s} hand: thumb + 4 fingers${hand.extra ? ` (+${hand.extra} extra, left to the nearest bones)` : ""}`,
    );
    hand.thumb.joints.forEach((j, k) => (world[`thumb${k + 1}${s}`] = j));
    tips[`thumb3${s}`] = hand.thumb.tip;
    skinFrom[`thumb1${s}`] = hand.thumb.shows;
    hand.fingers.forEach((f, i) => {
      f.joints.forEach((j, k) => (world[`${FINGERS[i]}${k + 1}${s}`] = j));
      tips[`${FINGERS[i]}3${s}`] = f.tip;
      skinFrom[`${FINGERS[i]}1${s}`] = f.shows;
    });
  }

  // Bones are world-aligned at rest: a joint's translation is its offset
  // from its parent; its inverse bind matrix is translate(−joint).
  const parentOf = Object.fromEntries(BONES);
  const ibm = skin.getInverseBindMatrices();
  const m = new Float32Array(skin.listJoints().length * 16);
  skin.listJoints().forEach((j, i) => {
    const name = j.getName();
    const w = world[name];
    const p = parentOf[name] ? world[parentOf[name]] : [0, 0, 0];
    j.setTranslation([w[0] - p[0], w[1] - p[1], w[2] - p[2]]);
    m.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -w[0], -w[1], -w[2], 1], i * 16);
  });
  ibm.setArray(m);
  // The hand's frame, as the mannequin's rig records it: the palm's
  // normal and the direction towards the thumb (index → little finger
  // knuckles, reversed), for tools that read it.
  const palm = {};
  for (const s of fingerless ? [] : ["L", "R"]) {
    const sub = (a, b) => a.map((v, k) => v - b[k]);
    const norm = (a) => {
      const l = Math.hypot(...a) || 1;
      return a.map((v) => v / l);
    };
    const hand = norm(sub(world[`middle1${s}`], world[`wrist${s}`]));
    const thumb = norm(sub(world[`index1${s}`], world[`pinky1${s}`]));
    const cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    palm[s] = {
      normal: norm(s === "L" ? cross(hand, thumb) : cross(thumb, hand)),
      thumb,
    };
  }
  node.setExtras({
    rig: { ...extras.rig, tips, palm: fingerless ? null : palm },
  });

  // Weights: Blender's automatic weights when Blender is installed
  // (they measured best: scripts/blender-weights.mjs), else bone heat.
  if (findBlender()) {
    log("  weights: Blender automatic weights");
    await blenderWeights(doc, glb, { everyBone: true, skinFrom, log });
  } else {
    log("  weights: bone heat (Blender not installed)");
    await reskinDocument(doc, {
      everyBone: true,
      skinFrom,
      label: "character",
      log,
    });
  }
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error("usage: node scripts/rig-character.mjs in.glb out.glb");
    process.exit(1);
  }
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "meshopt.decoder": MeshoptDecoder,
      "meshopt.encoder": MeshoptEncoder,
    });
  const doc = await io.readBinary(new Uint8Array(readFileSync(input)));
  await rigCharacter(doc, io);
  await doc.transform(
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  writeFileSync(output, await io.writeBinary(doc));
  console.log(`wrote ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
