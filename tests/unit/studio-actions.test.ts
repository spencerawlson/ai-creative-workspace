import { describe, expect, it } from "vitest";
import { PRESETS } from "@/lib/lighting";
import {
  SceneActionSchema,
  applyAction,
  describeAction,
  nudgeLight,
  tryApplyAction,
  type SceneAction,
} from "@/lib/studio/actions";
import { defaultScene } from "@/lib/studio/presets";
import { LIMITS, SceneSchema, type SceneDoc } from "@/lib/studio/schema";

function apply(scene: SceneDoc, action: SceneAction): SceneDoc {
  const r = applyAction(scene, action);
  if (!r.ok) throw new Error(r.error);
  return r.scene;
}

describe("defaultScene", () => {
  it("is valid and matches the M1–M3 look", () => {
    const s = defaultScene();
    expect(SceneSchema.safeParse(s).success).toBe(true);
    expect(s.preset).toBe("three-point");
    expect(s.lights.map((l) => l.id)).toEqual(["key", "fill", "rim"]);
    expect(s.lights.every((l) => l.kind === "directional")).toBe(true);
    expect(s.backdrop.color).toBe("#111118");
    expect(s.material.color).toBe("#d8d8de");
  });
});

describe("applyAction", () => {
  it("applies each of the six presets with exact preset values", () => {
    for (const p of PRESETS) {
      const s = apply(defaultScene(), { type: "applyPreset", presetId: p.id });
      expect(s.preset).toBe(p.id);
      s.lights.forEach((l, i) => expect(l).toMatchObject(p.lights[i]));
    }
  });

  it("editing a light marks the scene custom", () => {
    const s = apply(defaultScene(), {
      type: "updateLight",
      id: "key",
      patch: { azimuth: 90 },
    });
    expect(s.preset).toBe("custom");
    expect(s.lights[0].azimuth).toBe(90);
  });

  it("material/backdrop/camera edits keep the lighting preset", () => {
    let s = apply(defaultScene(), {
      type: "applyMaterialPreset",
      presetId: "clay",
    });
    s = apply(s, { type: "applyBackdropPreset", presetId: "white-cyc" });
    s = apply(s, { type: "updateCamera", patch: { focalMm: 85 } });
    expect(s.preset).toBe("three-point");
    expect(s.material.preset).toBe("clay");
    expect(s.backdrop.style).toBe("cyc");
  });

  it("adds lights with unique ids up to the limit, then refuses", () => {
    let s = defaultScene();
    for (let i = s.lights.length; i < LIMITS.maxLights; i++) {
      s = apply(s, { type: "addLight", kind: i % 2 ? "spot" : "area" });
    }
    expect(new Set(s.lights.map((l) => l.id)).size).toBe(LIMITS.maxLights);
    expect(applyAction(s, { type: "addLight", kind: "point" }).ok).toBe(false);
  });

  it("removes and duplicates, never below one light", () => {
    let s = apply(defaultScene(), { type: "duplicateLight", id: "key" });
    expect(s.lights).toHaveLength(4);
    expect(s.lights[3].label).toBe("Key copy");
    s = apply(s, { type: "removeLight", id: "fill" });
    s = apply(s, { type: "removeLight", id: "rim" });
    s = apply(s, { type: "removeLight", id: "light-4" });
    expect(applyAction(s, { type: "removeLight", id: "key" }).ok).toBe(false);
  });

  it("rejects out-of-range values without changing the scene", () => {
    const scene = defaultScene();
    const r = applyAction(scene, {
      type: "updateLight",
      id: "key",
      patch: { intensity: 50 },
    });
    expect(r.ok).toBe(false);
    expect(scene.lights[0].intensity).toBe(2.4);
  });

  it("rejects unknown lights and presets", () => {
    expect(
      applyAction(defaultScene(), { type: "removeLight", id: "nope" }).ok,
    ).toBe(false);
    expect(
      applyAction(defaultScene(), { type: "applyPreset", presetId: "disco" })
        .ok,
    ).toBe(false);
  });
});

describe("SceneActionSchema (untrusted input, e.g. future AI output)", () => {
  it.each([
    [{ type: "deleteEverything" }],
    [{ type: "updateLight", id: "key", patch: { intensity: "bright" } }],
    [{ type: "updateLight", id: "key", patch: { id: "rim" } }],
    [{ type: "updateLight", id: "key", patch: { kind: "spot" } }],
    [{ type: "updateCamera", patch: { focalMm: 5000 } }],
    [{ type: "updateMaterial", patch: { color: "red; background:url(x)" } }],
    [{ type: "applyPreset", presetId: "rembrandt", extra: true }],
    [null],
    ["applyPreset"],
  ])("rejects %j", (input) => {
    expect(SceneActionSchema.safeParse(input).success).toBe(false);
    expect(tryApplyAction(defaultScene(), input).ok).toBe(false);
  });

  it("accepts a well-formed action", () => {
    const r = tryApplyAction(defaultScene(), {
      type: "applyPreset",
      presetId: "rembrandt",
    });
    expect(r.ok).toBe(true);
  });
});

describe("describeAction", () => {
  it("produces readable labels", () => {
    const s = defaultScene();
    expect(
      describeAction(s, { type: "applyPreset", presetId: "rembrandt" }),
    ).toBe("Preset: Rembrandt");
    expect(
      describeAction(s, {
        type: "updateLight",
        id: "key",
        patch: { on: false },
      }),
    ).toBe("Key off");
    expect(
      describeAction(s, {
        type: "updateLight",
        id: "rim",
        patch: { azimuth: 1, elevation: 2 },
      }),
    ).toBe("Rim: direction, height");
    expect(describeAction(s, { type: "addLight", kind: "area" })).toBe(
      "Add softbox light",
    );
  });
});

describe("nudgeLight (keyboard handle movement)", () => {
  it("wraps azimuth around the subject in both directions", () => {
    expect(nudgeLight({ azimuth: 355, elevation: 0 }, 15, 0).azimuth).toBe(10);
    expect(nudgeLight({ azimuth: 5, elevation: 0 }, -15, 0).azimuth).toBe(350);
  });

  it("clamps elevation to the schema range", () => {
    const [lo, hi] = LIMITS.elevation;
    expect(nudgeLight({ azimuth: 0, elevation: hi - 2 }, 0, 5).elevation).toBe(
      hi,
    );
    expect(nudgeLight({ azimuth: 0, elevation: lo + 2 }, 0, -5).elevation).toBe(
      lo,
    );
  });

  it("always patches both fields so mixed presses coalesce into one undo step", () => {
    const scene = defaultScene();
    const key = scene.lights[0];
    const patch = nudgeLight(key, 5, 0);
    expect(Object.keys(patch).sort()).toEqual(["azimuth", "elevation"]);
    const next = applyAction(scene, { type: "updateLight", id: key.id, patch });
    expect(next.ok && next.scene.lights[0].azimuth).toBe(patch.azimuth);
  });
});
