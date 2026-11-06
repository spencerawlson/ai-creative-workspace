import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { vrmHumanoid } from "@/lib/engine/humanoid";
import {
  applyAction,
  describeAction,
  tryApplyAction,
} from "@/lib/studio/actions";
import {
  MAX_CHARACTER_BYTES,
  characterName,
  checkCharacterFile,
} from "@/lib/studio/characters";
import { defaultScene } from "@/lib/studio/presets";
import { SceneSchema } from "@/lib/studio/schema";

const GLB = new TextEncoder().encode("glTF");

describe("character files", () => {
  it("takes GLB and VRM files and says why it won't take others", () => {
    expect(checkCharacterFile("hero.glb", 1000, GLB)).toBeNull();
    expect(checkCharacterFile("Hero.VRM", 1000, GLB)).toBeNull();
    expect(checkCharacterFile("hero.gltf", 1000, GLB)).toMatch(/single \.glb/);
    expect(checkCharacterFile("hero.fbx", 1000, GLB)).toMatch(/\.fbx files/);
    expect(checkCharacterFile("hero.png", 1000, GLB)).toMatch(/\.glb or \.vrm/);
    expect(
      checkCharacterFile("hero.glb", MAX_CHARACTER_BYTES + 1, GLB),
    ).toMatch(/limit is 100 MB/);
    expect(
      checkCharacterFile(
        "hero.glb",
        1000,
        new TextEncoder().encode("PK\x03\x04"),
      ),
    ).toMatch(/isn't a GLB/);
  });

  it("names a character after its file", () => {
    expect(characterName("my_hero-v2.vrm")).toBe("my hero v2");
    expect(characterName(".glb")).toBe("Character");
    expect(characterName(`${"x".repeat(60)}.glb`)).toHaveLength(40);
  });
});

describe("setCharacter", () => {
  const scene = defaultScene();
  const id = "ch-abc123def0";

  it("puts a character on a figure and takes it off again", () => {
    const on = applyAction(scene, {
      type: "setCharacter",
      character: id,
      name: "Hero",
    });
    expect(on.ok && on.scene.figures[0].character).toBe(id);
    if (!on.ok) return;
    // Survives the scene schema (autosave, project files).
    expect(SceneSchema.parse(on.scene).figures[0].character).toBe(id);
    const off = applyAction(on.scene, {
      type: "setCharacter",
      character: null,
    });
    expect(off.ok && "character" in off.scene.figures[0]).toBe(false);
    expect(
      describeAction(scene, {
        type: "setCharacter",
        character: id,
        name: "Hero",
      }),
    ).toBe("Character: Hero");
  });

  it("refuses ids that aren't character ids", () => {
    expect(
      tryApplyAction(scene, {
        type: "setCharacter",
        character: "../x",
      } as never).ok,
    ).toBe(false);
  });

  it("keeps old scenes, with no character, as they were", () => {
    const parsed = SceneSchema.parse(JSON.parse(JSON.stringify(scene)));
    expect(parsed.figures[0].character).toBeUndefined();
  });
});

describe("VRM bone maps", () => {
  const bones = (names: string[]) =>
    names.map((n) => {
      const b = new THREE.Bone();
      b.name = n;
      return b;
    });

  it("reads VRM 1.0's map", () => {
    const b = bones(["a", "b", "c", "d"]);
    const json = {
      extensions: {
        VRMC_vrm: {
          humanoid: {
            humanBones: {
              hips: { node: 0 },
              leftUpperArm: { node: 1 },
              leftThumbMetacarpal: { node: 2 },
              leftThumbProximal: { node: 3 },
            },
          },
        },
      },
    };
    const m = vrmHumanoid(json, (i) => b[i]);
    expect(m).toEqual({
      pelvis: b[0],
      shoulderL: b[1],
      thumb1L: b[2],
      thumb2L: b[3],
    });
  });

  it("reads VRM 0.x's map, whose thumb names are one along", () => {
    const b = bones(["a", "b", "c", "d"]);
    const json = {
      extensions: {
        VRM: {
          humanoid: {
            humanBones: [
              { bone: "hips", node: 0 },
              { bone: "rightThumbProximal", node: 1 },
              { bone: "rightThumbIntermediate", node: 2 },
              { bone: "rightThumbDistal", node: 3 },
            ],
          },
        },
      },
    };
    expect(vrmHumanoid(json, (i) => b[i])).toEqual({
      pelvis: b[0],
      thumb1R: b[1],
      thumb2R: b[2],
      thumb3R: b[3],
    });
  });

  it("is null for files that aren't VRM", () => {
    expect(vrmHumanoid({ asset: { version: "2.0" } }, () => undefined)).toBe(
      null,
    );
  });
});

describe("characters in links", () => {
  it("carries each figure's character, and old links still have none", async () => {
    const { decodeScene, encodeScene } = await import("@/lib/studio/share");
    let s = defaultScene();
    const add = applyAction(s, { type: "addFigure" });
    if (!add.ok) throw new Error(add.error);
    const on = applyAction(add.scene, {
      type: "setCharacter",
      figure: "fig-2",
      character: "ch-abc123def0",
    });
    if (!on.ok) throw new Error(on.error);
    s = on.scene;
    const back = decodeScene(encodeScene(s))!;
    expect(back.figures.map((f) => f.character)).toEqual([
      undefined,
      "ch-abc123def0",
    ]);
    expect(back).toEqual(s);
    // A lone centred figure with a character keeps it too.
    const one = applyAction(defaultScene(), {
      type: "setCharacter",
      character: "ch-abc123def0",
    });
    if (!one.ok) throw new Error(one.error);
    expect(decodeScene(encodeScene(one.scene))!.figures[0].character).toBe(
      "ch-abc123def0",
    );
    expect(
      decodeScene(encodeScene(defaultScene()))!.figures[0].character,
    ).toBeUndefined();
  });
});
