// Rigs any unrigged model the right way for its body, recognised from
// its shape: `node scripts/auto-rig.mjs in.glb out.glb`.
//
//   upright on two feet, short arms  → a human: the human skeleton,
//                                      fingers included (rig-character);
//                                      every studio pose works on it
//   upright, arms reaching low       → an ape: the two-legged animal
//                                      rig and a walk (rig-animal)
//   four feet                        → a quadruped rig and a walk
//   two feet, long and low           → a bird, a rodent up on its hind
//                                      legs: the two-legged animal rig
//   no clear feet                    → refused: nothing to walk on
//
// Apes and humans both stand upright. What tells them apart is where the
// hands hang against the hips: a human's (an A-pose) above them, by
// 0.03–0.19 of the height; an ape's long arms at or below them (−0.02
// to 0.00). Measured on the 12 human and 4 ape models we have, served
// and original (tests/unit/auto-rig.test.ts). A very long arm (3D,
// 0.36 of the height or more: no human's is over 0.32) also says ape.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { meshopt, quantize } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { classifyBody } from "../lib/rig/classify.mjs";
import { fitBiped, rigAnimal } from "./rig-animal.mjs";
import { rigCharacter } from "./rig-character.mjs";

/** Hands this close to the hips (share of height) or lower: an ape. */
export const APE_HANDS_OVER_HIPS = 0.015;
/** An arm this long (shoulder to hand, 3D, share of height): an ape. */
export const APE_ARM = 0.36;

/** Which rig suits a body with rest positions `P` (+Y up), and why.
 * @param {ArrayLike<number>} P
 * @returns {{ rig: "human" | "quadruped" | "biped" | "none", shape: import("../lib/rig/classify.mjs").BodyShape, handsOverHips?: number, arm?: number }} */
export function chooseRig(P) {
  const shape = classifyBody(P);
  if (shape.kind === "quadruped") return { rig: "quadruped", shape };
  if (shape.kind === "biped-animal") return { rig: "biped", shape };
  if (shape.kind === "other") return { rig: "none", shape };
  // Upright: where do the hands hang, against the hips?
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < P.length / 3; i++) {
    lo = Math.min(lo, P[i * 3 + 1]);
    hi = Math.max(hi, P[i * 3 + 1]);
  }
  const H = hi - lo;
  const fit = fitBiped(P);
  const arms = ["L", "R"]
    .map((s) => [
      fit.bones.find((b) => b.name === `arm${s}`),
      fit.bones.find((b) => b.name === `hand${s}`),
    ])
    .filter(([arm, hand]) => arm && hand);
  // Arms held against the body (none found apart): a human's.
  if (!arms.length) return { rig: "human", shape };
  const handLow = Math.min(...arms.map(([, h]) => (h.tail[1] - lo) / H));
  const handsOverHips = handLow - fit.legShare;
  const arm = Math.max(
    ...arms.map(
      ([a, h]) => Math.hypot(...a.head.map((x, k) => x - h.tail[k])) / H,
    ),
  );
  const ape = handsOverHips < APE_HANDS_OVER_HIPS || arm >= APE_ARM;
  return { rig: ape ? "biped" : "human", shape, handsOverHips, arm };
}

/** Rest positions of an unrigged doc's mesh (through its node). */
function positionsOf(doc) {
  const node = doc
    .getRoot()
    .listNodes()
    .find((x) => x.getMesh());
  if (node.getSkin()) throw new Error("this model already has a skeleton");
  const m = node.getWorldMatrix();
  const pos = node.getMesh().listPrimitives()[0].getAttribute("POSITION");
  const P = new Float64Array(pos.getCount() * 3);
  const a = [];
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, a);
    for (let k = 0; k < 3; k++)
      P[i * 3 + k] =
        m[k] * a[0] + m[4 + k] * a[1] + m[8 + k] * a[2] + m[12 + k];
  }
  return P;
}

/** Recognise and rig `doc` in place; returns which rig it got. */
export async function autoRig(doc, glb, log = console.log) {
  const choice = chooseRig(positionsOf(doc));
  log(
    `  recognised: ${choice.shape.kind} (${choice.shape.feet} feet, stance ${choice.shape.stance.toFixed(2)}${choice.handsOverHips !== undefined ? `, hands over hips ${choice.handsOverHips.toFixed(2)}, arm ${choice.arm.toFixed(2)}` : ""}) → ${choice.rig} rig`,
  );
  if (choice.rig === "none")
    throw new Error(
      "this model doesn't stand on feet (no separate feet on the floor), so it can't be rigged to walk",
    );
  if (choice.rig === "human") await rigCharacter(doc, glb, log);
  else await rigAnimal(doc, glb, log);
  return choice.rig;
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error("usage: node scripts/auto-rig.mjs in.glb out.glb");
    process.exit(1);
  }
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const glb = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "meshopt.decoder": MeshoptDecoder,
      "meshopt.encoder": MeshoptEncoder,
    });
  const doc = await glb.readBinary(new Uint8Array(readFileSync(input)));
  const rig = await autoRig(doc, glb);
  await doc.transform(
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  writeFileSync(output, await glb.writeBinary(doc));
  console.log(`wrote ${output} (${rig} rig)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
