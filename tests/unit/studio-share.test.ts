import { describe, expect, it } from "vitest";
import { PRESETS, cloneLights } from "@/lib/lighting";
import { encodeSetup } from "@/lib/share";
import { applyAction, type SceneAction } from "@/lib/studio/actions";
import { defaultScene } from "@/lib/studio/presets";
import { decodeScene, encodeScene } from "@/lib/studio/share";
import type { SceneDoc } from "@/lib/studio/schema";

function apply(scene: SceneDoc, ...actions: SceneAction[]): SceneDoc {
  return actions.reduce((s, a) => {
    const r = applyAction(s, a);
    if (!r.ok) throw new Error(r.error);
    return r.scene;
  }, scene);
}

describe("v2 share codec", () => {
  it("round-trips every preset exactly", () => {
    for (const p of PRESETS) {
      const s = apply(defaultScene(), { type: "applyPreset", presetId: p.id });
      expect(decodeScene(encodeScene(s))).toEqual(s);
    }
  });

  it("round-trips a fully customised scene, including unicode names", () => {
    const s = apply(
      defaultScene(),
      { type: "addLight", kind: "spot" },
      { type: "addLight", kind: "area" },
      {
        type: "updateLight",
        id: "light-4",
        patch: { label: "Hair light ✨", spotAngle: 25 },
      },
      { type: "setModel", model: "female" },
      { type: "applyMaterialPreset", presetId: "bronze" },
      { type: "applyBackdropPreset", presetId: "deep-blue" },
      {
        type: "updateCamera",
        patch: { focalMm: 85, exposureEv: -0.5, toneMapping: "agx" },
      },
      { type: "updateShadows", patch: { quality: "high" } },
    );
    expect(decodeScene(encodeScene(s))).toEqual(s);
  });

  it("opens M3 (v1) links, restoring exact preset values", () => {
    const rembrandt = PRESETS.find((p) => p.id === "rembrandt")!;
    const s = decodeScene(
      encodeSetup("rembrandt", cloneLights(rembrandt.lights)),
    );
    expect(s?.preset).toBe("rembrandt");
    expect(s?.lights[1].intensity).toBe(0.35);
    expect(s?.figures[0].model).toBe("male");
  });

  it("opens v1 custom links with their encoded values", () => {
    const lights = cloneLights(PRESETS[0].lights);
    lights[0].azimuth = 120;
    const s = decodeScene(encodeSetup("custom", lights));
    expect(s?.preset).toBe("custom");
    expect(s?.lights[0].azimuth).toBe(120);
  });

  it.each([
    ["null", null],
    ["garbage", "!!!!"],
    ["oversized", "a".repeat(5000)],
    ["future version", btoa(JSON.stringify({ v: 3 }))],
    ["broken v2", btoa(JSON.stringify({ v: 2, p: "custom", l: [] }))],
  ])("rejects %s", (_n, input) => {
    expect(decodeScene(input)).toBeNull();
  });

  it("rejects a v2 link with an out-of-range light", () => {
    const raw = JSON.parse(
      atob(encodeScene(defaultScene()).replace(/-/g, "+").replace(/_/g, "/")),
    );
    raw.l[0][7] = 400; // intensity
    expect(decodeScene(btoa(JSON.stringify(raw)))).toBeNull();
  });
});
