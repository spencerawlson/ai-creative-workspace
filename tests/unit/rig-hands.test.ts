import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { adjacency, findFingers } from "@/scripts/rig-hands.mjs";
import { bindMatrix } from "@/scripts/reskin-cast.mjs";

/** The app's own mannequin: a hand-checked rig, so its finger joints
 * are the answer the finder should reach on its own. */
let pos: Float32Array;
let adj: ReturnType<typeof adjacency>;
let joint: (name: string) => number[];
let tip: (name: string) => number[];

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.readBinary(
    new Uint8Array(readFileSync("public/models/mannequin-male.glb")),
  );
  await doc.transform(dequantize());
  const skin = doc.getRoot().listSkins()[0];
  const M = new THREE.Matrix4().fromArray(bindMatrix(skin));
  const node = doc
    .getRoot()
    .listNodes()
    .find((n) => n.getMesh())!;
  const prim = node.getMesh()!.listPrimitives()[0];
  const P = prim.getAttribute("POSITION")!;
  pos = new Float32Array(P.getCount() * 3);
  const v = new THREE.Vector3();
  const a: number[] = [];
  for (let i = 0; i < P.getCount(); i++) {
    P.getElement(i, a);
    v.set(a[0], a[1], a[2]).applyMatrix4(M);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  adj = adjacency(P.getCount(), prim.getIndices()!.getArray()!);
  const byName = new Map(skin.listJoints().map((j) => [j.getName(), j]));
  joint = (name) => byName.get(name)!.getWorldTranslation();
  const tips = (node.getExtras() as { rig: { tips: Record<string, number[]> } })
    .rig.tips;
  tip = (name) => tips[name];
}, 120_000);

const dist = (a: number[], b: number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("finding a hand's thumb and fingers", () => {
  for (const s of ["L", "R"] as const)
    it(`finds the ${s} hand's thumb and four fingers where the rig has them`, () => {
      const hand = findFingers(
        pos,
        adj,
        joint(`wrist${s}`),
        tip(`wrist${s}`),
        joint(`elbow${s}`),
      );
      expect(hand.thumb).toBeTruthy();
      const handLength = dist(joint(`wrist${s}`), tip(`middle3${s}`));
      const fingers = ["index", "middle", "ring", "pinky"];
      fingers.forEach((f, i) => {
        const found = hand.fingers![i];
        // In order, index next to the thumb: its tip is nearest this
        // finger's tip in the rig.
        const byTip = fingers.map((g) => dist(found.tip, tip(`${g}3${s}`)));
        expect(byTip.indexOf(Math.min(...byTip))).toBe(i);
        expect(byTip[i]).toBeLessThan(0.05 * handLength);
        // Its joints near the rig's: knuckle (inside the palm, the least
        // certain), middle joint, last joint.
        const err = (k: number) =>
          dist(found.joints[k], joint(`${f}${k + 1}${s}`)) / handLength;
        expect(err(0)).toBeLessThan(0.15);
        expect(err(1)).toBeLessThan(0.1);
        expect(err(2)).toBeLessThan(0.05);
      });
      for (const k of [0, 1, 2])
        expect(
          dist(hand.thumb!.joints[k], joint(`thumb${k + 1}${s}`)) / handLength,
        ).toBeLessThan(0.08);
      expect(
        dist(hand.thumb!.tip, tip(`thumb3${s}`)) / handLength,
      ).toBeLessThan(0.06);
    }, 120_000);

  it("doesn't depend on which way the hand faces", () => {
    // The whole figure turned 70° about the forearm's axis: same answer,
    // turned with it.
    const w = joint("wristL");
    const e = joint("elbowL");
    const axis = new THREE.Vector3(
      w[0] - e[0],
      w[1] - e[1],
      w[2] - e[2],
    ).normalize();
    const R = new THREE.Matrix4()
      .makeTranslation(w[0], w[1], w[2])
      .multiply(
        new THREE.Matrix4().makeRotationAxis(axis, (70 * Math.PI) / 180),
      )
      .multiply(new THREE.Matrix4().makeTranslation(-w[0], -w[1], -w[2]));
    const turned = new Float32Array(pos.length);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.length; i += 3) {
      v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(R);
      turned.set([v.x, v.y, v.z], i);
    }
    const t = tip("wristL");
    const tipTurned = v.set(t[0], t[1], t[2]).applyMatrix4(R).toArray();
    const before = findFingers(pos, adj, w, t, e);
    const after = findFingers(turned, adj, w, tipTurned, e);
    expect(after.thumb).toBeTruthy();
    before.fingers!.forEach((f, i) => {
      const expected = v.fromArray(f.joints[0]).applyMatrix4(R).toArray();
      expect(dist(after.fingers![i].joints[0], expected)).toBeLessThan(0.005);
    });
  }, 120_000);
});

describe("a skinned mesh's rest space", () => {
  it("comes from the skin's bind, not the mesh node (quantised files)", async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
    const doc = await io.readBinary(
      new Uint8Array(readFileSync("public/cast/real-man.glb")),
    );
    const skin = doc.getRoot().listSkins()[0];
    const m = bindMatrix(skin);
    const node = doc
      .getRoot()
      .listNodes()
      .find((n) => n.getMesh())!;
    // The node is identity; the bind carries the quantisation's scale.
    expect(node.getWorldMatrix()[0]).toBe(1);
    expect(m[0]).toBeGreaterThan(0.5);
    expect(m[0]).toBeLessThan(0.999);
    // Every joint agrees at rest.
    const ibm = skin.getInverseBindMatrices()!.getArray()!;
    skin.listJoints().forEach((j, i) => {
      const b = new THREE.Matrix4()
        .fromArray(j.getWorldMatrix())
        .multiply(
          new THREE.Matrix4().fromArray(
            Array.from(ibm.slice(i * 16, i * 16 + 16)),
          ),
        );
      b.toArray().forEach((x, k) => expect(x).toBeCloseTo(m[k], 4));
    });
  });
});
