import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  applyFace,
  buildFace,
  faceControls,
  findEyes,
  lookRotation,
  namedExpressions,
  shapeMeshes,
  vrmExpressions,
  vrmEyeNodes,
} from "@/lib/engine/face";
import { applyAction } from "@/lib/studio/actions";
import { evaluate } from "@/lib/studio/animation";
import {
  decodeScene,
  decodeSceneLink,
  encodeScene,
  encodeSceneLink,
} from "@/lib/studio/share";
import {
  PoseJointsSchema,
  mirrorJoints,
  neutralJoints,
  type PoseJoints,
} from "@/lib/studio/pose";
import { defaultScene } from "@/lib/studio/presets";
import type { SceneDoc } from "@/lib/studio/schema";

/** A mesh with named face shapes (one-triangle geometry). */
function shapeMesh(names: string[]): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  g.morphAttributes.position = names.map(
    () => new THREE.Float32BufferAttribute(new Float32Array(9), 3),
  );
  const m = new THREE.Mesh(g);
  m.updateMorphTargets();
  m.morphTargetDictionary = Object.fromEntries(names.map((n, i) => [n, i]));
  return m;
}

function face(patch: Partial<Record<string, Record<string, number>>>) {
  const j = neutralJoints() as Record<string, Record<string, number>>;
  for (const [id, v] of Object.entries(patch)) Object.assign(j[id], v);
  return j as PoseJoints;
}

function apply(s: SceneDoc, ...actions: object[]): SceneDoc {
  for (const a of actions) {
    const r = applyAction(s, a as never);
    if (!r.ok) throw new Error(r.error);
    s = r.scene;
  }
  return s;
}

describe("face shapes by name", () => {
  it("reads VRoid, ARKit, viseme and prefixed names", () => {
    const vroid = shapeMesh([
      "Fcl_ALL_Neutral",
      "Fcl_ALL_Joy",
      "Fcl_EYE_Close",
      "Fcl_EYE_Close_L",
      "Fcl_MTH_A",
    ]);
    const arkit = shapeMesh([
      "eyeBlinkLeft",
      "eyeBlinkRight",
      "mouthSmileLeft",
      "mouthSmileRight",
      "jawOpen",
      "Head.viseme_O",
    ]);
    const found = namedExpressions([vroid, arkit]);
    expect(found.happy).toEqual([{ mesh: 0, index: 1, weight: 1 }]);
    expect(found.blink).toEqual([{ mesh: 0, index: 2, weight: 1 }]);
    expect(found.blinkLeft).toEqual([{ mesh: 0, index: 3, weight: 1 }]);
    expect(found.blinkRight).toEqual([{ mesh: 1, index: 1, weight: 1 }]);
    expect(found.aa).toEqual([{ mesh: 0, index: 4, weight: 1 }]);
    expect(found.oh).toEqual([{ mesh: 1, index: 5, weight: 1 }]);
    expect(found.angry).toBeUndefined();

    // ARKit alone: a smile is both corners (and cheeks if present).
    const only = namedExpressions([arkit]);
    expect(only.happy?.map((b) => b.index)).toEqual([2, 3]);
    expect(only.aa).toEqual([{ mesh: 0, index: 4, weight: 1 }]);
  });
});

describe("VRM expressions", () => {
  it("reads VRM 1.0 binds per node, primitive meshes included", () => {
    const json = {
      extensions: {
        VRMC_vrm: {
          expressions: {
            preset: {
              happy: { morphTargetBinds: [{ node: 3, index: 2, weight: 1 }] },
              blink: { morphTargetBinds: [{ node: 3, index: 5, weight: 0.5 }] },
              aa: { morphTargetBinds: [{ node: 9, index: 0, weight: 1 }] },
              neutral: { morphTargetBinds: [{ node: 3, index: 0, weight: 1 }] },
            },
          },
        },
      },
    };
    // Node 3 has two primitives (meshes 0 and 1); node 9 none.
    const out = vrmExpressions(json, (n) => (n === 3 ? [0, 1] : []));
    expect(out).toEqual({
      happy: [
        { mesh: 0, index: 2, weight: 1 },
        { mesh: 1, index: 2, weight: 1 },
      ],
      blink: [
        { mesh: 0, index: 5, weight: 0.5 },
        { mesh: 1, index: 5, weight: 0.5 },
      ],
    });
  });

  it("reads VRM 0.x groups, whose binds name a mesh and weigh 0..100", () => {
    const json = {
      nodes: [{ name: "root" }, { name: "Face", mesh: 4 }],
      extensions: {
        VRM: {
          blendShapeMaster: {
            blendShapeGroups: [
              {
                presetName: "joy",
                binds: [{ mesh: 4, index: 7, weight: 100 }],
              },
              {
                presetName: "blink_l",
                binds: [{ mesh: 4, index: 1, weight: 50 }],
              },
              { presetName: "a", binds: [{ mesh: 4, index: 3, weight: 100 }] },
              {
                presetName: "unknown",
                name: "Surprised",
                binds: [{ mesh: 4, index: 9, weight: 100 }],
              },
              { presetName: "neutral", binds: [] },
            ],
          },
        },
      },
    };
    const out = vrmExpressions(json, (n) => (n === 1 ? [0] : []));
    expect(out).toEqual({
      happy: [{ mesh: 0, index: 7, weight: 1 }],
      blinkLeft: [{ mesh: 0, index: 1, weight: 0.5 }],
      aa: [{ mesh: 0, index: 3, weight: 1 }],
      surprised: [{ mesh: 0, index: 9, weight: 1 }],
    });
  });

  it("is null for files that aren't VRM, and finds VRM eye bones", () => {
    expect(vrmExpressions({ asset: {} }, () => [])).toBeNull();
    const l = new THREE.Bone();
    const r = new THREE.Bone();
    const json = {
      extensions: {
        VRM: {
          humanoid: {
            humanBones: [
              { bone: "leftEye", node: 5 },
              { bone: "rightEye", node: 6 },
            ],
          },
        },
      },
    };
    expect(vrmEyeNodes(json, (i) => ({ 5: l, 6: r })[i])).toEqual([l, r]);
    expect(vrmEyeNodes({}, () => l)).toBeNull();
  });
});

describe("a character's face", () => {
  /** root (turned and scaled) > hips > head (turned) > eyes + a face mesh. */
  function character() {
    const root = new THREE.Group();
    root.rotation.y = 0.7;
    root.scale.setScalar(0.01);
    const head = new THREE.Bone();
    head.name = "Head";
    head.quaternion.setFromEuler(new THREE.Euler(0.3, -0.2, 0.5));
    root.add(head);
    const eyes = (["LeftEye", "RightEye"] as const).map((n, i) => {
      const e = new THREE.Bone();
      e.name = `mixamorig:${n}`;
      e.position.set(i ? -3 : 3, 5, 8);
      e.quaternion.setFromEuler(new THREE.Euler(1.1, 0.4, -0.6));
      head.add(e);
      return e;
    });
    const brow = new THREE.Bone();
    brow.name = "LeftEyebrow";
    head.add(brow);
    const mesh = shapeMesh([
      "Fcl_ALL_Joy",
      "Fcl_EYE_Close_L",
      "Fcl_EYE_Close_R",
      "Fcl_MTH_A",
    ]);
    root.add(mesh);
    root.updateMatrixWorld(true);
    return { root, head, eyes, mesh };
  }

  it("finds the eye bones (not the brows) and lists its controls", () => {
    const c = character();
    expect(findEyes(c.head, null)).toEqual(c.eyes);
    const rig = buildFace(c.root, null, c.eyes)!;
    // No "Fcl_EYE_Close": blinking closes both eyes.
    expect(rig.expressions.blink).toHaveLength(2);
    expect(faceControls(rig).sort()).toEqual(
      [
        "eyes.turn",
        "eyes.raise",
        "expression.happy",
        "eyelids.blink",
        "eyelids.left",
        "eyelids.right",
        "mouth.aa",
      ].sort(),
    );
    expect(faceControls(null)).toEqual([]);
  });

  it("sets shape weights from the pose, and back to 0", () => {
    const c = character();
    const rig = buildFace(c.root, null, c.eyes)!;
    const eyes = new Map(c.eyes.map((e) => [e.name, e]));
    const meshes = shapeMeshes(c.root);
    applyFace(
      rig,
      meshes,
      eyes,
      face({ expression: { happy: 40 }, eyelids: { blink: 70, left: 50 } }),
    );
    // Left eye: blink 0.7 + wink 0.5, capped at 1.
    expect(c.mesh.morphTargetInfluences).toEqual([0.4, 1, 0.7, 0]);
    applyFace(rig, meshes, eyes, neutralJoints());
    expect(c.mesh.morphTargetInfluences).toEqual([0, 0, 0, 0]);
  });

  it("turns the eyes in the figure's frame, and they follow the head", () => {
    const c = character();
    const rig = buildFace(c.root, null, c.eyes)!;
    const toRoot = (o: THREE.Object3D) => {
      c.root.updateMatrixWorld(true);
      return c.root
        .getWorldQuaternion(new THREE.Quaternion())
        .invert()
        .multiply(o.getWorldQuaternion(new THREE.Quaternion()));
    };
    const rest = c.eyes.map(toRoot);
    const headRest = toRoot(c.head);
    const eyes = new Map(c.eyes.map((e) => [e.name, e]));
    const meshes = shapeMeshes(c.root);
    const near = (a: THREE.Quaternion, b: THREE.Quaternion) =>
      expect(Math.abs(a.dot(b))).toBeCloseTo(1, 6);

    applyFace(rig, meshes, eyes, neutralJoints());
    c.eyes.forEach((e, i) => near(toRoot(e), rest[i]));

    applyFace(rig, meshes, eyes, face({ eyes: { turn: 20, raise: 10 } }));
    const look = lookRotation(20, 10);
    c.eyes.forEach((e, i) => near(toRoot(e), look.clone().multiply(rest[i])));
    // Forward (+Z) turns towards its left (+X) and up.
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(look);
    expect(fwd.x).toBeGreaterThan(0.3);
    expect(fwd.y).toBeGreaterThan(0.15);

    // Turn the head: the eyes keep looking the same way relative to it.
    const turn = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, 0.5, 0.2),
    );
    c.head.quaternion.premultiply(turn);
    const headNow = toRoot(c.head);
    const delta = headNow.clone().multiply(headRest.clone().invert());
    c.eyes.forEach((e, i) =>
      near(toRoot(e), delta.clone().multiply(look).multiply(rest[i])),
    );
  });

  it("looks with shapes when the file has no eye bones", () => {
    const mesh = shapeMesh(["lookLeft", "lookRight", "lookUp", "lookDown"]);
    const root = new THREE.Group().add(mesh);
    const rig = buildFace(root, null, [])!;
    expect(faceControls(rig)).toEqual(["eyes.turn", "eyes.raise"]);
    applyFace(
      rig,
      [mesh],
      new Map(),
      face({ eyes: { turn: -17.5, raise: 25 } }),
    );
    expect(mesh.morphTargetInfluences).toEqual([0, 0.5, 1, 0]);
  });

  it("is null without face shapes or eyes", () => {
    expect(buildFace(new THREE.Group(), null, [])).toBeNull();
  });
});

describe("the face in the scene", () => {
  it("old poses load with a neutral face; mirror swaps the eyes", () => {
    const old = Object.fromEntries(
      Object.entries(neutralJoints()).filter(
        ([id]) => !["eyes", "expression", "eyelids", "mouth"].includes(id),
      ),
    );
    expect(PoseJointsSchema.parse(old).mouth.aa).toBe(0);
    expect(() =>
      PoseJointsSchema.parse({
        ...neutralJoints(),
        expression: { ...neutralJoints().expression, happy: 101 },
      }),
    ).toThrow(/happy is above 100%/);
    const m = mirrorJoints(face({ eyes: { turn: 12 }, eyelids: { left: 80 } }));
    expect(m.eyes.turn).toBe(-12);
    expect(m.eyelids).toEqual({ blink: 0, left: 0, right: 80 });
  });

  it("body poses and moves keep the face; face edits keep the pose name", () => {
    let s = apply(defaultScene(), {
      type: "applyPosePreset",
      presetId: "arms-up",
    });
    s = apply(s, {
      type: "updateJoint",
      joint: "expression",
      patch: { happy: 80 },
    });
    expect(s.figures[0].pose.preset).toBe("arms-up");
    s = apply(s, { type: "applyPosePreset", presetId: "thinker" });
    expect(s.figures[0].pose.joints.expression.happy).toBe(80);
    s = apply(s, { type: "applyMotion", motion: "wave" });
    expect(
      s.animation.keys.every(
        (k) => k.figures["fig-1"].joints.expression.happy === 80,
      ),
    ).toBe(true);
  });

  it("keys, in-betweens and links carry the face", async () => {
    let s = apply(
      defaultScene(),
      { type: "updateJoint", joint: "mouth", patch: { aa: 0 } },
      { type: "setKey", t: 0 },
      { type: "updateJoint", joint: "mouth", patch: { aa: 100 } },
      { type: "updateJoint", joint: "eyes", patch: { turn: 20 } },
      { type: "setKey", t: 2 },
    );
    const mid = evaluate(s, 1).scene.figures[0].pose.joints;
    expect(mid.mouth.aa).toBeCloseTo(50, 0);
    expect(mid.eyes.turn).toBeCloseTo(10, 0);
    s = apply(s, {
      type: "updateJoint",
      joint: "eyelids",
      patch: { right: 35 },
    });
    expect(
      decodeScene(encodeScene(s))!.figures[0].pose.joints.eyelids.right,
    ).toBe(35);
    const link = await encodeSceneLink(s);
    expect(link.animated).toBe(true);
    const back = (await decodeSceneLink(link.param))!;
    expect(back.figures[0].pose.joints.eyelids.right).toBe(35);
    expect(back.animation.keys[1].figures["fig-1"].joints.mouth.aa).toBe(100);
  });
});
