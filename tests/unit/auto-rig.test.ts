import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { chooseRig } from "@/scripts/auto-rig.mjs";
import { fitBiped, fitQuadruped } from "@/scripts/rig-animal.mjs";
import { bindMatrix } from "@/scripts/reskin-cast.mjs";

/** A built-in model's rest positions (through its skin's bind). */
async function rest(file: string) {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(readFileSync(file)));
  await doc.transform(dequantize());
  const M = new THREE.Matrix4().fromArray(
    bindMatrix(doc.getRoot().listSkins()[0]),
  );
  const pos = doc
    .getRoot()
    .listMeshes()[0]
    .listPrimitives()[0]
    .getAttribute("POSITION")!;
  const out = new Float64Array(pos.getCount() * 3);
  const v = new THREE.Vector3();
  const a: number[] = [];
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, a);
    v.set(a[0], a[1], a[2]).applyMatrix4(M);
    out.set([v.x, v.y, v.z], i * 3);
  }
  return out;
}

const RIGS: Array<[string, "human" | "quadruped" | "biped"]> = [
  ["public/cast/real-man.glb", "human"],
  ["public/cast/real-woman.glb", "human"],
  ["public/cast/toon-man.glb", "human"],
  ["public/cast/toon-woman.glb", "human"],
  ["public/cast/infant.glb", "human"],
  ["public/models/mannequin-male.glb", "human"],
  ["public/models/mannequin-female.glb", "human"],
  // Upright too, but their arms reach far lower: the animal rig.
  ["public/creatures/gorilla.glb", "biped"],
  ["public/creatures/monkey.glb", "biped"],
  ["public/creatures/bird.glb", "biped"],
  ["public/creatures/rat.glb", "biped"],
  ["public/creatures/lion.glb", "quadruped"],
  ["public/creatures/elephant.glb", "quadruped"],
  ["public/creatures/cat.glb", "quadruped"],
  ["public/creatures/dog-side.glb", "quadruped"],
];

describe("choosing a rig for a body", () => {
  for (const [file, rig] of RIGS)
    it(`${file.split("/").pop()} gets the ${rig} rig`, async () => {
      expect(chooseRig(await rest(file)).rig).toBe(rig);
    }, 60_000);
});

describe("fitting an animal's skeleton", () => {
  it("a quadruped: head forward, legs front and back, left and right", async () => {
    const fit = fitQuadruped(await rest("public/creatures/dog-standing.glb"));
    const at = (n: string) => fit.bones.find((b) => b.name === n)!;
    const along = (p: number[]) =>
      p[0] * fit.forward[0] + p[2] * fit.forward[1];
    const side = (p: number[]) => p[0] * fit.left[0] + p[2] * fit.left[1];
    expect(fit.bones.map((b) => b.name)).toEqual([
      "root",
      "spine",
      "chest",
      "neck",
      "head",
      ...["FL", "FR", "BL", "BR"].flatMap((s) => [
        `leg${s}`,
        `leg${s}Lower`,
        `foot${s}`,
      ]),
      "tail1",
      "tail2",
    ]);
    // The head is ahead of the chest, the chest ahead of the hips, and
    // the tail behind.
    expect(along(at("head").head)).toBeGreaterThan(along(at("chest").tail));
    expect(along(at("chest").tail)).toBeGreaterThan(along(at("spine").head));
    expect(along(at("tail2").tail)).toBeLessThan(along(at("spine").head));
    // Front legs ahead of back legs; left legs on the left.
    expect(along(at("legFL").head)).toBeGreaterThan(along(at("legBL").head));
    expect(side(at("legFL").head)).toBeGreaterThan(side(at("legFR").head));
    expect(side(at("legBL").head)).toBeGreaterThan(side(at("legBR").head));
    // Knees between hips and feet; feet near the floor.
    for (const s of ["FL", "FR", "BL", "BR"]) {
      expect(at(`leg${s}`).head[1]).toBeGreaterThan(at(`leg${s}Lower`).head[1]);
      expect(at(`leg${s}Lower`).head[1]).toBeGreaterThan(
        at(`foot${s}`).head[1],
      );
    }
  }, 60_000);

  it("an ape: arms that hang clear of the body; a sitting rat: none", async () => {
    const ape = fitBiped(await rest("public/creatures/gorilla.glb"));
    expect(ape.bones.map((b) => b.name)).toEqual(
      expect.arrayContaining([
        "armL",
        "armR",
        "handL",
        "handR",
        "legL",
        "legR",
      ]),
    );
    const rat = fitBiped(await rest("public/creatures/rat.glb"));
    expect(rat.bones.map((b) => b.name)).not.toContain("armL");
    expect(rat.bones.map((b) => b.name)).toEqual(
      expect.arrayContaining(["legL", "legR", "tail1", "tail2"]),
    );
  }, 60_000);
});
