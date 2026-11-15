import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyAction, describeAction } from "@/lib/studio/actions";
import { plinthGeometry } from "@/lib/engine/plinth";
import { bakeStatue, toStl } from "@/lib/engine/statueExport";
import { MATERIAL_PRESETS, defaultScene } from "@/lib/studio/presets";
import { PLINTH_SIZE, type SceneDoc } from "@/lib/studio/schema";
import {
  decodeScene,
  decodeSceneLink,
  encodeScene,
  encodeSceneLink,
} from "@/lib/studio/share";

function act(scene: SceneDoc, action: Parameters<typeof applyAction>[1]) {
  const r = applyAction(scene, action);
  if (!r.ok) throw new Error(r.error);
  return r.scene;
}

/** Read a binary STL back: triangles of [normal, a, b, c]. */
function readStl(buffer: ArrayBuffer) {
  const v = new DataView(buffer);
  const count = v.getUint32(80, true);
  const tris: number[][][] = [];
  for (let t = 0; t < count; t++) {
    const at = 84 + t * 50;
    tris.push(
      [0, 1, 2, 3].map((k) =>
        [0, 1, 2].map((c) => v.getFloat32(at + k * 12 + c * 4, true)),
      ),
    );
  }
  return { count, tris, header: new TextDecoder().decode(buffer.slice(0, 32)) };
}

describe("statues: plinths and statue materials", () => {
  it("puts a figure on a plinth, changes it and takes it away", () => {
    let s = act(defaultScene(), {
      type: "setPlinth",
      figure: "fig-1",
      plinth: "round",
    });
    expect(s.figures[0].plinth).toBe("round");
    expect(applyAction(s, { type: "setPlinth", plinth: "round" })).toEqual({
      ok: true,
      scene: s,
    });
    s = act(s, { type: "setPlinth", plinth: "square" });
    expect(s.figures[0].plinth).toBe("square");
    expect(
      describeAction(s, { type: "setPlinth", figure: "fig-1", plinth: null }),
    ).toBe("No plinth");
    s = act(s, { type: "setPlinth", figure: "fig-1", plinth: null });
    expect("plinth" in s.figures[0]).toBe(false);
    expect(
      applyAction(s, {
        type: "setPlinth",
        figure: "fig-1",
        plinth: "oval",
      } as never).ok,
    ).toBe(false);
    // Two figures: the label says which.
    s = act(s, { type: "addFigure" });
    expect(
      describeAction(s, {
        type: "setPlinth",
        figure: "fig-2",
        plinth: "round",
      }),
    ).toBe("Figure 2: Round plinth");
    // A copy keeps its plinth.
    s = act(s, { type: "setPlinth", figure: "fig-2", plinth: "round" });
    s = act(s, { type: "duplicateFigure", figure: "fig-2" });
    expect(s.figures[2].plinth).toBe("round");
  });

  it("keeps plinths in share links, plain and animated", async () => {
    // One figure in the centre: even so it's written as a figure row.
    const one = act(defaultScene(), { type: "setPlinth", plinth: "square" });
    expect(decodeScene(encodeScene(one))!.figures[0].plinth).toBe("square");

    let s = act(one, { type: "addFigure", model: "female" });
    s = act(s, { type: "applyMotion", motion: "wave", figure: "fig-2" });
    const link = await encodeSceneLink(s);
    expect(link.animated).toBe(true);
    const back = (await decodeSceneLink(link.param))!;
    expect(back.figures.map((f) => f.plinth ?? null)).toEqual(["square", null]);
    // A link from before plinths opens without any.
    expect(
      decodeScene(encodeScene(defaultScene()))!.figures[0].plinth,
    ).toBeUndefined();
  });

  it("has statue materials", () => {
    const ids = MATERIAL_PRESETS.map((m) => m.id);
    for (const id of [
      "marble",
      "bronze",
      "plaster",
      "clay",
      "sandstone",
      "dark-stone",
      "gold",
    ])
      expect(ids).toContain(id);
    const s = act(defaultScene(), {
      type: "applyMaterialPreset",
      presetId: "marble",
    });
    expect(s.material.preset).toBe("marble");
  });

  it("builds plinths on the floor, the planned size", () => {
    for (const kind of ["round", "square"] as const) {
      const g = plinthGeometry(kind);
      g.computeBoundingBox();
      const box = g.boundingBox!;
      expect(box.min.y).toBeCloseTo(0, 6);
      expect(box.max.y).toBeCloseTo(PLINTH_SIZE.height, 6);
      expect(box.max.x - box.min.x).toBeCloseTo(PLINTH_SIZE.width, 3);
      expect(box.max.z - box.min.z).toBeCloseTo(PLINTH_SIZE.width, 3);
      g.dispose();
    }
  });
});

describe("statues: baking and STL", () => {
  /** A 1 m tall two-bone strip; the upper bone turned 90°. */
  function bentStrip() {
    const positions: number[] = [];
    const skinIndex: number[] = [];
    const skinWeight: number[] = [];
    for (let i = 0; i <= 4; i++) {
      const y = i / 4;
      for (const x of [-0.05, 0.05]) {
        positions.push(x, y, 0);
        skinIndex.push(y > 0.5 ? 1 : 0, 0, 0, 0);
        skinWeight.push(1, 0, 0, 0);
      }
    }
    const index: number[] = [];
    for (let i = 0; i < 4; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
    g.setAttribute(
      "skinWeight",
      new THREE.Float32BufferAttribute(skinWeight, 4),
    );
    g.setIndex(index);
    const lower = new THREE.Bone();
    const upper = new THREE.Bone();
    upper.position.y = 0.5;
    lower.add(upper);
    const mesh = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
    mesh.name = "model";
    mesh.add(lower);
    mesh.bind(new THREE.Skeleton([lower, upper]));
    const root = new THREE.Group();
    root.add(mesh);
    root.updateMatrixWorld(true);
    upper.rotation.z = -Math.PI / 2; // the top half points along +x
    return { root, mesh };
  }

  it("bakes the pose (bones and face shapes) and leaves out helpers", () => {
    const { root } = bentStrip();
    // A posing helper and a hidden part: not part of the statue.
    const dot = new THREE.Mesh(new THREE.SphereGeometry(1));
    dot.name = "pose-dot";
    root.add(dot);
    const hidden = new THREE.Mesh(new THREE.BoxGeometry());
    hidden.name = "model";
    hidden.visible = false;
    root.add(hidden);
    root.position.x = 2;

    const baked = bakeStatue([root]);
    expect(baked.triangles).toBe(8);
    const p = baked.positions;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      maxX = Math.max(maxX, p[i]);
      maxY = Math.max(maxY, p[i + 1]);
    }
    // Bent: nothing above the joint's height (plus the strip's width),
    // and the top reaches 0.5 m out along x, from where the root stands.
    expect(maxY).toBeLessThan(0.56);
    expect(maxX).toBeCloseTo(2.5, 2);

    // A face shape (morph target) is baked too. Relative, as glTF's are:
    // the top corner moves up 2.
    const g = new THREE.BufferGeometry();
    g.morphTargetsRelative = true;
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    g.morphAttributes.position = [
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 2, 0], 3),
    ];
    const face = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    face.name = "model";
    face.updateMorphTargets();
    face.morphTargetInfluences![0] = 1;
    const shaped = bakeStatue([face]);
    expect(shaped.positions[7]).toBeCloseTo(3);
  });

  it("writes binary STL in millimetres, Z up, on the bed, centred", async () => {
    const { root } = bentStrip();
    const r = toStl(bakeStatue([root]), 120);
    expect(r.triangles).toBe(8);
    expect(r.sizeMm[2]).toBe(120);
    const stl = readStl(await r.blob.arrayBuffer());
    expect(stl.header).toBe("IKO 3D statue, millimetres, Z up");
    expect(stl.count).toBe(8);
    expect(r.blob.size).toBe(84 + 8 * 50);
    const corners = stl.tris.flatMap((t) => t.slice(1));
    const zs = corners.map((c) => c[2]);
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    expect(Math.min(...zs)).toBeCloseTo(0, 3);
    expect(Math.max(...zs)).toBeCloseTo(120, 3);
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0, 3);
    expect(Math.min(...ys) + Math.max(...ys)).toBeCloseTo(0, 3);
    // Flat in the model's z, so flat in the file's y: depth 0.
    expect(r.sizeMm[1]).toBeCloseTo(0, 3);
    for (const [n] of stl.tris) expect(Math.hypot(...n)).toBeCloseTo(1, 4);

    // Y-up becomes Z-up without mirroring: a triangle facing the camera
    // (+z in the studio) faces −y in the file.
    const tri = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
      ),
    );
    tri.name = "model";
    const one = readStl(await toStl(bakeStatue([tri]), 10).blob.arrayBuffer());
    expect(one.tris[0][0][1]).toBeCloseTo(-1, 4);
    expect(() => toStl(bakeStatue([]), 10)).toThrow(/nothing to export/);
  });
});
