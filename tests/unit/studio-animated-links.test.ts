import { describe, expect, it } from "vitest";
import { applyAction, type SceneAction } from "@/lib/studio/actions";
import { defaultScene } from "@/lib/studio/presets";
import type { SceneDoc } from "@/lib/studio/schema";
import {
  MAX_LINK,
  decodeSceneLink,
  encodeScene,
  encodeSceneLink,
} from "@/lib/studio/share";

const apply = (s: SceneDoc, ...actions: SceneAction[]) =>
  actions.reduce((acc, a) => {
    const r = applyAction(acc, a);
    if (!r.ok) throw new Error(r.error);
    return r.scene;
  }, s);

const view = {
  position: [1.5, 1.4, 3.2] as [number, number, number],
  target: [0, 1, 0] as [number, number, number],
};

/** Two figures (ids fig-1, fig-3 after a removal), keys at 0 and 2 s,
 * with camera, a tangent and linear interpolation. */
function animated(): SceneDoc {
  let s = apply(
    defaultScene(),
    { type: "addFigure" },
    { type: "addFigure", model: "female" },
    { type: "removeFigure", figure: "fig-2" },
    { type: "setKey", t: 0, camera: view },
    {
      type: "updateJoint",
      joint: "elbowL",
      patch: { bend: 80 },
      figure: "fig-3",
    },
    { type: "updateLight", id: "key", patch: { azimuth: 300, intensity: 2 } },
    { type: "setKey", t: 2, camera: { ...view, position: [-1, 1.6, 3] } },
    { type: "setKeyEase", t: 0, ease: "linear" },
  );
  s = apply(s, {
    type: "setKeyTangent",
    t: 2,
    channel: { kind: "joint", figure: "fig-3", joint: "elbowL", dof: "bend" },
    slope: 12.5,
  });
  return s;
}

describe("animated share links", () => {
  it("a scene without keys gets the same plain link as before", async () => {
    const s = defaultScene();
    const link = await encodeSceneLink(s);
    expect(link).toEqual({
      param: encodeScene(s),
      animated: false,
      tooLong: false,
    });
    expect(await decodeSceneLink(link.param)).toEqual(s);
  });

  it("carries the animation: keys, interpolation, tangents, camera, lights", async () => {
    const s = animated();
    const link = await encodeSceneLink(s);
    expect(link.animated).toBe(true);
    expect(link.param.startsWith("z")).toBe(true);
    const back = (await decodeSceneLink(link.param))!;
    expect(back.figures.map((f) => f.id)).toEqual(["fig-1", "fig-2"]);
    const [k0, k2] = back.animation.keys;
    expect(k0.ease).toBe("linear");
    expect(k0.camera?.view).toEqual(view);
    expect(k2.lights.key.azimuth).toBe(300);
    expect(k2.lights.key.intensity).toBe(2);
    // fig-3 came back as fig-2, in its keys and its tangent too.
    expect(k2.figures["fig-2"].joints.elbowL.bend).toBe(80);
    expect(k2.tangents?.["fig-2.elbowL.bend"]).toEqual({ in: 12.5, out: 12.5 });
    expect(back.animation.duration).toBe(s.animation.duration);
  });

  it("an animation too long for a URL falls back to the current frame", async () => {
    let s = apply(defaultScene(), { type: "setDuration", duration: 120 });
    for (let i = 0; i < 3; i++) s = apply(s, { type: "addFigure" });
    for (let t = 0; t < 60; t++)
      s = apply(
        s,
        {
          type: "updateJoint",
          joint: "elbowL",
          patch: { bend: (t * 37) % 140 },
          figure: `fig-${(t % 4) + 1}`,
        },
        {
          type: "setKey",
          t: t * 2,
          camera: { ...view, position: [t / 10, 1.4, 3] },
        },
      );
    const link = await encodeSceneLink(s);
    if (link.tooLong) {
      expect(link.animated).toBe(false);
      expect(link.param).toBe(encodeScene(s));
    } else expect(link.param.length).toBeLessThanOrEqual(MAX_LINK);
  });

  it("rejects damaged links and decompression bombs", async () => {
    const link = await encodeSceneLink(animated());
    expect(
      await decodeSceneLink(link.param.slice(0, -12) + "AAAAAAAAAAAA"),
    ).toBeNull();
    expect(await decodeSceneLink("z!!!")).toBeNull();
    // 2 MB of zeros deflates to a tiny link.
    const bomb = new Blob([new Uint8Array(2 * 1024 * 1024)])
      .stream()
      .pipeThrough(new CompressionStream("deflate-raw"));
    const bytes = new Uint8Array(await new Response(bomb).arrayBuffer());
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    const param =
      "z" +
      btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(param.length).toBeLessThan(MAX_LINK);
    expect(await decodeSceneLink(param)).toBeNull();
  });

  it("still opens plain v2 links", async () => {
    const s = apply(defaultScene(), { type: "applyPreset", presetId: "split" });
    expect((await decodeSceneLink(encodeScene(s)))?.preset).toBe("split");
  });
});
