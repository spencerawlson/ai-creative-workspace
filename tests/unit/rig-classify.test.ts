import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { classifyBody } from "@/lib/rig/classify.mjs";

type BodyKind = ReturnType<typeof classifyBody>["kind"];
import { bindMatrix } from "@/scripts/reskin-cast.mjs";

/** A built-in model's rest positions (through its skin's bind). */
async function restPositions(file: string, turnDeg = 0) {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(readFileSync(file)));
  await doc.transform(dequantize());
  const skin = doc.getRoot().listSkins()[0];
  const M = new THREE.Matrix4().fromArray(bindMatrix(skin));
  // Turned about the vertical: the classifier mustn't care which way
  // the model faces.
  M.premultiply(new THREE.Matrix4().makeRotationY((turnDeg * Math.PI) / 180));
  const pos = doc
    .getRoot()
    .listMeshes()[0]
    .listPrimitives()[0]
    .getAttribute("POSITION")!;
  const out = new Float32Array(pos.getCount() * 3);
  const v = new THREE.Vector3();
  const a: number[] = [];
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, a);
    v.set(a[0], a[1], a[2]).applyMatrix4(M);
    out.set([v.x, v.y, v.z], i * 3);
  }
  return out;
}

const EXPECTED: Array<[string, BodyKind]> = [
  ["public/cast/real-man.glb", "upright"],
  ["public/cast/real-woman.glb", "upright"],
  ["public/cast/toon-man.glb", "upright"],
  ["public/cast/toon-woman.glb", "upright"],
  ["public/cast/infant.glb", "upright"],
  ["public/models/mannequin-male.glb", "upright"],
  ["public/models/mannequin-female.glb", "upright"],
  // Apes stand upright too (scripts/auto-rig.mjs tells them from humans).
  ["public/creatures/gorilla.glb", "upright"],
  ["public/creatures/monkey.glb", "upright"],
  ["public/creatures/lion.glb", "quadruped"],
  ["public/creatures/tiger.glb", "quadruped"],
  ["public/creatures/cat.glb", "quadruped"],
  ["public/creatures/dog-standing.glb", "quadruped"],
  ["public/creatures/dog-side.glb", "quadruped"],
  ["public/creatures/hippo.glb", "quadruped"],
  ["public/creatures/rhino.glb", "quadruped"],
  ["public/creatures/elephant.glb", "quadruped"],
  ["public/creatures/bird.glb", "biped-animal"],
  // Up on its hind legs, its tail tip resting on the floor.
  ["public/creatures/rat.glb", "biped-animal"],
];

describe("recognising a body from its shape", () => {
  for (const [file, kind] of EXPECTED)
    it(`${file.split("/").pop()} is ${kind}`, async () => {
      expect(classifyBody(await restPositions(file)).kind).toBe(kind);
    }, 60_000);

  it("whichever way the model faces", async () => {
    for (const [file, kind] of [
      ["public/creatures/lion.glb", "quadruped"],
      ["public/creatures/bird.glb", "biped-animal"],
      ["public/cast/real-woman.glb", "upright"],
    ] as const)
      for (const turn of [35, 90, 200])
        expect(classifyBody(await restPositions(file, turn)).kind).toBe(kind);
  }, 120_000);

  it("calls something with no clear feet 'other'", () => {
    // A long, lying cylinder (a snake, a log): one patch on the floor.
    const pts: number[] = [];
    for (let i = 0; i <= 200; i++)
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        pts.push(i * 0.01, 0.05 + 0.05 * Math.sin(a), 0.05 * Math.cos(a));
      }
    expect(classifyBody(pts).kind).toBe("other");
  });
});
