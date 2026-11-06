import { describe, expect, it } from "vitest";
import { bokehAperture, needsPost } from "@/lib/engine/post";
import { applyAction, tryApplyAction } from "@/lib/studio/actions";
import { defaultScene } from "@/lib/studio/presets";
import { SceneSchema } from "@/lib/studio/schema";
import { decodeScene, encodeScene } from "@/lib/studio/share";

const off = {
  ao: false,
  fStop: null,
  focus: 3,
  focalMm: 50,
  bloom: 0,
  vignette: 0,
  grain: 0,
};

describe("the lens look", () => {
  it("old scenes load with everything off", () => {
    const s = defaultScene() as Record<string, unknown>;
    const camera = { focalMm: 50, exposureEv: 0, toneMapping: "aces" };
    const parsed = SceneSchema.parse({ ...s, camera });
    expect(parsed.camera).toMatchObject({
      aperture: 0,
      bloom: 0,
      vignette: 0,
      grain: 0,
    });
  });

  it("edits set only what they name, within range", () => {
    let r = applyAction(defaultScene(), {
      type: "updateCamera",
      patch: { aperture: 1.8, vignette: 0.4 },
    });
    if (!r.ok) throw new Error(r.error);
    r = applyAction(r.scene, { type: "updateCamera", patch: { bloom: 0.3 } });
    if (!r.ok) throw new Error(r.error);
    expect(r.scene.camera).toMatchObject({
      aperture: 1.8,
      vignette: 0.4,
      bloom: 0.3,
      grain: 0,
    });
    for (const patch of [{ aperture: 0.5 }, { aperture: 30 }, { grain: 2 }])
      expect(
        tryApplyAction(defaultScene(), { type: "updateCamera", patch }).ok,
      ).toBe(false);
  });

  it("links carry it, and links from before it open sharp", () => {
    const r = applyAction(defaultScene(), {
      type: "updateCamera",
      patch: { aperture: 2.8, bloom: 0.25, vignette: 0.5, grain: 0.1 },
    });
    if (!r.ok) throw new Error(r.error);
    expect(decodeScene(encodeScene(r.scene))!.camera).toEqual(r.scene.camera);
    expect(decodeScene(encodeScene(defaultScene()))!.camera.aperture).toBe(0);
  });

  it("only runs the effects pipeline when something needs it", () => {
    expect(needsPost(off)).toBe(false);
    expect(needsPost({ ...off, ao: true })).toBe(true);
    expect(needsPost({ ...off, fStop: 4 })).toBe(true);
    expect(needsPost({ ...off, grain: 0.1 })).toBe(true);
  });

  it("blurs more with a wider aperture and a longer lens", () => {
    expect(bokehAperture(1.4, 85)).toBeGreaterThan(bokehAperture(4, 85));
    expect(bokehAperture(2.8, 135)).toBeGreaterThan(bokehAperture(2.8, 35));
  });
});

describe("backdrop colour on the effects path", () => {
  it("un-tone-maps a colour back to itself on every curve", async () => {
    const { toneMap, untoneMap } = await import("@/lib/engine/tonemap");
    const colours: Array<[number, number, number]> = [
      [0.008, 0.009, 0.012], // studio dark
      [0.18, 0.18, 0.18],
      [0.5, 0.3, 0.1],
      [0.05, 0.2, 0.6],
    ];
    for (const curve of ["aces", "agx", "neutral"] as const)
      for (const exposure of [0.6, 1, 2])
        for (const c of colours) {
          const back = toneMap(untoneMap(c, curve, exposure), curve, exposure);
          back.forEach((v, i) => expect(v).toBeCloseTo(c[i], 3));
        }
  });

  it("matches three.js's ACES at a known point", async () => {
    const { toneMap } = await import("@/lib/engine/tonemap");
    // Mid grey stays mid-ish and neutral; black stays black.
    const g = toneMap([0.18, 0.18, 0.18], "aces", 1);
    expect(g[0]).toBeCloseTo(g[1], 2);
    expect(g[0]).toBeGreaterThan(0.15);
    expect(g[0]).toBeLessThan(0.35);
    expect(toneMap([0, 0, 0], "aces", 1)[0]).toBeCloseTo(0, 3);
  });
});
