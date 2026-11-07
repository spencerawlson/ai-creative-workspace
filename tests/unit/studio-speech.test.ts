import { describe, expect, it } from "vitest";
import { applyAction } from "@/lib/studio/actions";
import { evaluate } from "@/lib/studio/animation";
import { SPEECH_FPS, VISEMES } from "@/lib/studio/lipSync";
import { defaultScene } from "@/lib/studio/presets";
import { SceneSchema, type SceneDoc, type Speech } from "@/lib/studio/schema";
import { decodeSceneLink, encodeSceneLink } from "@/lib/studio/share";
import {
  decodeMouth,
  encodeMouth,
  isAnimated,
  speechLength,
  withSpeech,
} from "@/lib/studio/speech";

/** `seconds` of mouth: "aa" opening to `open` in the middle second. */
function mouth(seconds: number, open = 80): string {
  const n = Math.round(seconds * SPEECH_FPS);
  const frames = new Uint8Array(n * VISEMES.length);
  for (let i = 0; i < n; i++)
    if (i >= SPEECH_FPS && i < 2 * SPEECH_FPS)
      frames[i * VISEMES.length] = open;
  return encodeMouth(frames);
}

function apply(scene: SceneDoc, action: Parameters<typeof applyAction>[1]) {
  const r = applyAction(scene, action);
  if (!r.ok) throw new Error(r.error);
  return r.scene;
}

const speech = (over: Partial<Speech> = {}): Speech => ({
  figure: "fig-1",
  start: 1,
  name: "Hello there",
  mouth: mouth(3),
  ...over,
});

describe("lip-sync tracks in a scene", () => {
  it("round-trips the mouth through its text", () => {
    const frames = Uint8Array.from({ length: 500 }, (_, i) => i % 101);
    expect(Array.from(decodeMouth(encodeMouth(frames)))).toEqual(
      Array.from(frames),
    );
    expect(speechLength(speech())).toBeCloseTo(3, 5);
  });

  it("adds a track in one step, lengthening the animation to hold it", () => {
    const s0 = defaultScene();
    expect(isAnimated(s0)).toBe(false);
    const s1 = apply(s0, {
      type: "addSpeech",
      speech: speech({ start: 4.5 }),
    });
    expect(s1.speech).toHaveLength(1);
    expect(s1.animation.duration).toBe(8); // 4.5 + 3, rounded up
    expect(isAnimated(s1)).toBe(true);
    // Removing it leaves the length as it is.
    const s2 = apply(s1, { type: "removeSpeech", index: 0 });
    expect(s2.speech).toEqual([]);
    expect(s2.animation.duration).toBe(8);
  });

  it("refuses a track for a missing figure, or past the longest animation", () => {
    const s0 = defaultScene();
    expect(
      applyAction(s0, {
        type: "addSpeech",
        speech: speech({ figure: "fig-9" }),
      }).ok,
    ).toBe(false);
    const r = applyAction(s0, {
      type: "addSpeech",
      speech: speech({ start: 119 }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/at most 120 s/);
  });

  it("goes with its figure when the figure is removed", () => {
    let s = apply(defaultScene(), { type: "addFigure" });
    s = apply(s, { type: "addSpeech", speech: speech({ figure: "fig-2" }) });
    s = apply(s, { type: "addSpeech", speech: speech() });
    s = apply(s, { type: "removeFigure", figure: "fig-2" });
    expect(s.speech.map((sp) => sp.figure)).toEqual(["fig-1"]);
  });

  it("lays the mouth over what's shown, never into the scene or its keys", () => {
    let s = apply(defaultScene(), { type: "addSpeech", speech: speech() });
    // Before it starts and after it ends: the figure's own mouth.
    expect(withSpeech(s, 0.5)).toBe(s);
    expect(withSpeech(s, 4.5)).toBe(s);
    // In the middle second of the track (2–3 s in the scene): open.
    const shown = withSpeech(s, 2.5);
    expect(shown.figures[0].pose.joints.mouth.aa).toBe(80);
    expect(s.figures[0].pose.joints.mouth.aa).toBe(0);
    // A key set while it speaks keeps the figure's own (closed) mouth.
    s = apply(s, { type: "setKey", t: 2.5 });
    expect(s.animation.keys[0].figures["fig-1"].joints.mouth.aa).toBe(0);
    expect(evaluate(s, 2.5).scene.figures[0].pose.joints.mouth.aa).toBe(0);
  });

  it("refuses damaged mouth data, and never throws on it", () => {
    const bad = { ...defaultScene(), speech: [speech({ mouth: "AAAAA" })] };
    expect(SceneSchema.safeParse(bad).success).toBe(false);
    const short = { ...defaultScene(), speech: [speech({ mouth: "AAAA" })] };
    expect(SceneSchema.safeParse(short).success).toBe(false); // 3 bytes
    expect(decodeMouth("A").length).toBe(0);
    expect(decodeMouth("AAAAAAAA").length).toBe(5); // 6 bytes → 1 frame
  });

  it("opens older scenes with no lip sync", () => {
    const old = { ...defaultScene() } as Partial<SceneDoc>;
    delete old.speech;
    expect(SceneSchema.parse(old).speech).toEqual([]);
  });

  it("travels in share links (the mouth, and the sound's id), not the sound", async () => {
    let s = apply(defaultScene(), { type: "addFigure" });
    s = apply(s, {
      type: "addSpeech",
      speech: speech({ figure: "fig-2", sound: "snd-0abc12345xyz" }),
    });
    const link = await encodeSceneLink(s);
    expect(link.animated).toBe(true);
    const back = (await decodeSceneLink(link.param))!;
    expect(back.speech).toEqual(s.speech);
    expect(withSpeech(back, 2.5).figures[1].pose.joints.mouth.aa).toBe(80);
  });
});
