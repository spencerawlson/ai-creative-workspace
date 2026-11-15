import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyAction } from "@/lib/studio/actions";
import { FINISHES, patchSurface } from "@/lib/engine/surface";
import { defaultScene, materialFromPreset } from "@/lib/studio/presets";
import { decodeScene, encodeScene } from "@/lib/studio/share";

const standard = () => ({
  vertexShader: THREE.ShaderLib.standard.vertexShader,
  fragmentShader: THREE.ShaderLib.standard.fragmentShader,
});

describe("surface finishes", () => {
  it("statue presets come with their surface; a hand-picked one is kept", () => {
    expect(materialFromPreset("marble")?.finish).toBe("marble");
    expect(materialFromPreset("sandstone")?.finish).toBe("stone");
    expect(materialFromPreset("aged-bronze")?.finish).toBe("patina");
    expect(materialFromPreset("bronze")?.finish).toBeUndefined();

    let s = defaultScene();
    const r = applyAction(s, {
      type: "updateMaterial",
      patch: { finish: "stone" },
    });
    if (!r.ok) throw new Error(r.error);
    s = r.scene;
    expect(s.material.finish).toBe("stone");
    // Changing the colour keeps the surface.
    const c = applyAction(s, {
      type: "updateMaterial",
      patch: { color: "#336699" },
    });
    if (!c.ok) throw new Error(c.error);
    expect(c.scene.material.finish).toBe("stone");
    expect(
      applyAction(s, {
        type: "updateMaterial",
        patch: { finish: "wood" },
      } as never).ok,
    ).toBe(false);
  });

  it("share links keep the surface; older links open plain", () => {
    for (const finish of FINISHES) {
      const r = applyAction(defaultScene(), {
        type: "updateMaterial",
        patch: { finish },
      });
      if (!r.ok) throw new Error(r.error);
      const back = decodeScene(encodeScene(r.scene))!;
      expect(back.material.finish ?? "plain").toBe(finish);
    }
    // A plain material's link is as before (no fifth value).
    expect(encodeScene(defaultScene())).toBe(encodeScene(defaultScene()));
    expect(
      decodeScene(encodeScene(defaultScene()))!.material.finish,
    ).toBeUndefined();
  });

  it("patches three.js's standard shader for every finish, before the colour and paint", () => {
    for (const finish of FINISHES) {
      const shader = standard();
      patchSurface(shader, finish);
      if (finish === "plain") {
        expect(shader).toEqual(standard());
        continue;
      }
      expect(shader.vertexShader).toContain(
        "vIkoPos = ( bindMatrix * vec4( position, 1.0 ) ).xyz;",
      );
      expect(shader.fragmentShader).toContain("float ikoFbm");
      // The finish's colour comes before the vertex-colour (paint) step.
      const at = shader.fragmentShader.indexOf("float ikoAmount");
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThan(
        shader.fragmentShader.indexOf("#include <color_fragment>"),
      );
      expect(
        shader.fragmentShader.indexOf("#include <roughnessmap_fragment>"),
      ).toBeLessThan(shader.fragmentShader.indexOf("roughnessFactor ="));
    }
    // A shader without the expected parts is refused, not silently left.
    expect(() =>
      patchSurface(
        { vertexShader: "void main(){}", fragmentShader: "void main(){}" },
        "marble",
      ),
    ).toThrow(/shader has no/);
  });
});
