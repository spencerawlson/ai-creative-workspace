// @vitest-environment jsdom
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { validateBytes } from "gltf-validator";
import { EXPORT_FPS, exportGlb, type GlbSource } from "@/lib/engine/gltfExport";

/** A two-bone arm with a quantized mesh, a face shape, and a studio
 * helper hung on a bone, placed like a figure on stage. */
function figure() {
  const root = new THREE.Group();
  root.position.set(1, 0, -0.5);
  root.rotation.y = 0.4;
  const shoulder = new THREE.Bone();
  shoulder.name = "shoulderL";
  const elbow = new THREE.Bone();
  elbow.name = "elbowL";
  elbow.position.set(0, -0.3, 0);
  shoulder.add(elbow);
  const geometry = new THREE.BufferGeometry();
  // Positions as normalized int16, as meshopt-compressed models have.
  const pos = new Int16Array([
    0, 0, 0, 3000, -9000, 0, -3000, -9000, 0, 0, -18000, 0,
  ]);
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3, true));
  geometry.setAttribute(
    "skinIndex",
    new THREE.Uint16BufferAttribute(
      [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      4,
    ),
  );
  geometry.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute(
      [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      4,
    ),
  );
  geometry.setIndex([0, 1, 2, 1, 3, 2]);
  geometry.morphAttributes.position = [
    new THREE.Float32BufferAttribute(new Array(12).fill(0.01), 3),
  ];
  const mesh = new THREE.SkinnedMesh(
    geometry,
    new THREE.MeshStandardMaterial({ name: "Mannequin" }),
  );
  mesh.add(shoulder);
  mesh.bind(new THREE.Skeleton([shoulder, elbow]));
  mesh.morphTargetInfluences = [0];
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.01),
    new THREE.MeshBasicMaterial(),
  );
  dot.name = "pose-dot-ring";
  elbow.add(dot);
  const pick = new THREE.Mesh(
    new THREE.SphereGeometry(0.01),
    new THREE.MeshBasicMaterial(),
  );
  pick.name = "pose-pick";
  shoulder.add(pick);
  root.add(mesh);
  root.updateMatrixWorld(true);
  return { root, shoulder, mesh };
}

async function read(bytes: Uint8Array) {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(bytes);
}

describe("3D file export", () => {
  it("writes a valid glTF of the posed figure, without the studio's helpers", async () => {
    const f = figure();
    f.shoulder.rotation.z = 1.2; // posed
    const camera = new THREE.PerspectiveCamera(40, 1.5, 0.1, 100);
    camera.position.set(0, 1.5, 4);
    const key = new THREE.DirectionalLight(0xffeedd, 3);
    key.position.set(2, 3, 2);
    const area = new THREE.RectAreaLight(0xffffff, 5, 1, 1);
    const src: GlbSource = {
      figures: [{ name: "Figure 1", root: f.root }],
      camera,
      lights: [
        { name: "Key", light: key },
        { name: "Softbox", light: area },
      ],
      duration: 1,
    };
    const r = await exportGlb(src, { animation: true, stage: true });
    expect(r.frames).toBe(0); // no animation to sample
    expect(r.skippedLights).toBe(1);
    const bytes = new Uint8Array(await r.blob.arrayBuffer());
    const report = await validateBytes(bytes);
    expect(report.issues.messages.filter((m) => m.severity === 0)).toEqual([]);

    const doc = await read(bytes);
    const root = doc.getRoot();
    const names = root.listNodes().map((n) => n.getName());
    expect(names).toEqual(
      expect.arrayContaining([
        "Figure 1",
        "shoulderL",
        "elbowL",
        "Camera",
        "Key",
      ]),
    );
    expect(names).not.toContain("pose-dot-ring");
    expect(names).not.toContain("pose-pick");
    expect(names).not.toContain("Softbox");
    // The figure's place, and the pose on the bone.
    const fig = root.listNodes().find((n) => n.getName() === "Figure 1")!;
    expect(fig.getTranslation()).toEqual(
      [1, 0, -0.5].map((v) => expect.closeTo(v, 5)),
    );
    const q = root
      .listNodes()
      .find((n) => n.getName() === "shoulderL")!
      .getRotation();
    expect(q[2]).toBeCloseTo(Math.sin(0.6), 4);
    // Plain floats: no KHR_mesh_quantization needed to read it.
    expect(root.listExtensionsUsed().map((e) => e.extensionName)).not.toContain(
      "KHR_mesh_quantization",
    );
    const position = root
      .listMeshes()[0]
      .listPrimitives()[0]
      .getAttribute("POSITION")!;
    expect(position.getArray()).toBeInstanceOf(Float32Array);
    expect(position.getElement(3, [])[1]).toBeCloseTo(-18000 / 32767, 4);
    expect(root.listMaterials()[0].getName()).toBe("Mannequin");
    // The live figure keeps its own (quantized) geometry.
    expect(f.mesh.geometry.getAttribute("position").array).toBeInstanceOf(
      Int16Array,
    );
  });

  it("samples the animation through seek: moving parts only, then restores", async () => {
    const f = figure();
    const camera = new THREE.PerspectiveCamera();
    let restored = false;
    const src: GlbSource = {
      figures: [{ name: "Figure 1", root: f.root }],
      camera,
      lights: [],
      duration: 2,
      seek: (t) => {
        f.shoulder.rotation.z = t; // the arm swings up
        f.mesh.morphTargetInfluences![0] = t / 2; // the face changes
        f.root.position.x = 1 + t; // and the figure walks
      },
      restore: () => {
        restored = true;
      },
    };
    const r = await exportGlb(src, { animation: true, stage: false });
    expect(restored).toBe(true);
    expect(r.frames).toBe(2 * EXPORT_FPS + 1);
    const bytes = new Uint8Array(await r.blob.arrayBuffer());
    const report = await validateBytes(bytes);
    expect(report.issues.messages.filter((m) => m.severity === 0)).toEqual([]);

    const [clip] = (await read(bytes)).getRoot().listAnimations();
    const channels = clip
      .listChannels()
      .map((c) => `${c.getTargetNode()!.getName()}.${c.getTargetPath()}`);
    expect(channels).toEqual(
      expect.arrayContaining([
        "shoulderL.rotation",
        "Figure 1.translation",
        expect.stringMatching(/\.weights$/),
      ]),
    );
    // The elbow and the figure's turn never change: no tracks for them.
    expect(channels).not.toContain("elbowL.rotation");
    expect(channels).not.toContain("Figure 1.rotation");
    const shoulder = clip
      .listChannels()
      .find((c) => c.getTargetNode()!.getName() === "shoulderL")!;
    const times = shoulder.getSampler()!.getInput()!.getArray()!;
    expect(times.length).toBe(61);
    expect(times[60]).toBeCloseTo(2, 5);
    const out = shoulder.getSampler()!.getOutput()!.getArray()!;
    // Last frame: 2 rad about z.
    expect(out[out.length - 2]).toBeCloseTo(Math.sin(1), 4);
  });
});
