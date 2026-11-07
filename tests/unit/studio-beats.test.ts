import { describe, expect, it } from "vitest";
import { applyAction, type SceneAction } from "@/lib/studio/actions";
import { evaluate } from "@/lib/studio/animation";
import {
  BLEND,
  POSE_TIME,
  beatScript,
  parseBeat,
  planBeats,
  splitBeats,
  type BeatSpec,
} from "@/lib/studio/beats";
import { defaultScene } from "@/lib/studio/presets";
import { SceneSchema, type SceneDoc } from "@/lib/studio/schema";
import { decodeSceneLink, encodeSceneLink } from "@/lib/studio/share";
import { SPEECH_FPS, VISEMES } from "@/lib/studio/lipSync";
import { encodeMouth } from "@/lib/studio/speech";

function apply(scene: SceneDoc, action: SceneAction) {
  const r = applyAction(scene, action);
  if (!r.ok) throw new Error(r.error);
  return r.scene;
}

function beats(script: string): BeatSpec[] {
  return splitBeats(script).map((line) => {
    const p = parseBeat(line);
    if (!p.ok) throw new Error(p.error);
    return p.beat;
  });
}

describe("direction beats", () => {
  it("reads each line as a move, a pose, a hold or a turn, with its note", () => {
    const wave = parseBeat("wave twice — says hi");
    expect(wave).toMatchObject({
      ok: true,
      beat: {
        text: "wave twice",
        note: "says hi",
        do: { kind: "motion", motion: "wave", repeat: 2 },
      },
    });
    expect(parseBeat("pause 2 s")).toMatchObject({
      ok: true,
      beat: { do: { kind: "hold", seconds: 2 } },
      label: "Hold 2 s",
    });
    expect(parseBeat("hold")).toMatchObject({
      beat: { do: { kind: "hold", seconds: 1 } },
    });
    expect(parseBeat("face the camera")).toMatchObject({
      beat: { do: { kind: "turn", to: "camera" } },
    });
    expect(parseBeat("turn to the left -- looks out")).toMatchObject({
      beat: { note: "looks out", do: { kind: "turn", to: "left" } },
    });
    // "Turn around" is the library's stepping turn.
    expect(parseBeat("turn around")).toMatchObject({
      beat: { do: { kind: "motion", motion: "turn-around" } },
    });
    expect(parseBeat("sit down")).toMatchObject({
      beat: { do: { kind: "motion", motion: "sit-down" } },
    });
    expect(parseBeat("left kick")).toMatchObject({
      beat: { do: { kind: "motion", motion: "kick", mirror: true } },
    });
    expect(parseBeat("fly to the moon").ok).toBe(false);
    // A typo in a move's name is still read.
    expect(parseBeat("wavee")).toMatchObject({
      beat: { do: { kind: "motion", motion: "wave" } },
    });
    expect(splitBeats("walk\n\n  wave ; bow \n")).toEqual([
      "walk",
      "wave",
      "bow",
    ]);
  });

  it("lays beats end to end, each from where the last one ended", () => {
    const fig = defaultScene().figures[0];
    const plan = planBeats(
      fig,
      1,
      beats("walk 2 times\nface the camera\npause 1 s\nwave"),
    );
    if ("error" in plan) throw new Error(plan.error);
    const [walk, turn, hold, wave] = plan.markers;
    expect(walk.t).toBe(1);
    // Each beat starts where the one before ended.
    expect(turn.t).toBeCloseTo(walk.t + walk.length, 5);
    expect(hold.t).toBeCloseTo(turn.t + turn.length, 5);
    expect(wave.t).toBeCloseTo(hold.t + hold.length, 5);
    expect(turn.length).toBeCloseTo(POSE_TIME, 5);
    expect(hold.length).toBeCloseTo(1, 5);
    expect(plan.end).toBeCloseTo(wave.t + wave.length, 5);
    // Keys in time order; the walk travelled towards the camera.
    const ts = plan.entries.map((e) => e.t);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
    const afterWalk = plan.entries.find((e) => e.t === turn.t)!.entry;
    expect(afterWalk.z).toBeGreaterThan(fig.z + 0.5);
    // The move blends in from the standing pose.
    expect(plan.entries[1].t).toBeCloseTo(1 + BLEND, 5);
  });

  it("directs beats as keys and markers in one undo step, then plays them", () => {
    let s = apply(defaultScene(), {
      type: "updateFigure",
      figure: "fig-1",
      patch: { rotation: 90 },
    });
    s = apply(s, {
      type: "directBeats",
      figure: "fig-1",
      t: 0,
      beats: beats("face the camera — finds us\npause 1 s\nbow"),
    });
    expect(s.beats.map((b) => [b.text, b.t])).toEqual([
      ["face the camera", 0],
      ["pause 1 s", POSE_TIME],
      ["bow", POSE_TIME + 1],
    ]);
    expect(s.beats[0].note).toBe("finds us");
    expect(s.animation.keys.length).toBeGreaterThan(3);
    expect(s.animation.duration).toBeGreaterThanOrEqual(
      Math.ceil(s.beats[2].t + s.beats[2].length),
    );
    // Turned from 90° to face the camera, and held there.
    const at = (t: number) => evaluate(s, t).scene.figures[0];
    expect(at(0).rotation).toBe(90);
    expect(at(POSE_TIME).rotation).toBe(0);
    expect(at(POSE_TIME + 0.5).rotation).toBe(0);
    // Its script comes back as written.
    expect(beatScript(s.beats)).toBe(
      "face the camera — finds us\npause 1 s\nbow",
    );
  });

  it("replaces beats directed again over the same time, keeps others", () => {
    let s = apply(defaultScene(), {
      type: "directBeats",
      figure: "fig-1",
      t: 0,
      beats: beats("wave\nbow"),
    });
    const late = apply(s, {
      type: "directBeats",
      figure: "fig-1",
      t: 20,
      beats: beats("clap"),
    });
    expect(late.beats.map((b) => b.text)).toEqual(["wave", "bow", "clap"]);
    s = apply(late, {
      type: "directBeats",
      figure: "fig-1",
      t: 0,
      beats: beats("nod"),
    });
    // The wave it overlaps is replaced; the clap later on is kept.
    expect(s.beats.map((b) => b.text)).not.toContain("wave");
    expect(s.beats[0].text).toBe("nod");
    expect(s.beats.at(-1)!.text).toBe("clap");
    const cleared = apply(s, { type: "clearBeats", figure: "fig-1" });
    expect(cleared.beats).toEqual([]);
    expect(cleared.animation.keys).toEqual(s.animation.keys);
  });

  it("refuses beats that would run past the longest animation", () => {
    const r = applyAction(defaultScene(), {
      type: "directBeats",
      figure: "fig-1",
      t: 118,
      beats: beats("pause 5 s"),
    });
    expect(r.ok).toBe(false);
  });

  it("go with their figure, open in older scenes, and travel in links", async () => {
    let s = apply(defaultScene(), { type: "addFigure" });
    s = apply(s, {
      type: "directBeats",
      figure: "fig-2",
      t: 0,
      beats: beats("wave — hello"),
    });
    const link = await encodeSceneLink(s);
    expect((await decodeSceneLink(link.param))!.beats).toEqual(s.beats);
    expect(apply(s, { type: "removeFigure", figure: "fig-2" }).beats).toEqual(
      [],
    );
    const old = { ...defaultScene() } as Partial<SceneDoc>;
    delete old.beats;
    expect(SceneSchema.parse(old).beats).toEqual([]);
  }, 30_000);
});

/** `seconds` of a mouth, as a beat's sound. */
const voice = (seconds: number, name = "hello") => ({
  name,
  mouth: encodeMouth(
    new Uint8Array(Math.round(seconds * SPEECH_FPS) * VISEMES.length).fill(40),
  ),
});

describe("direction beats with sounds, and retiming", () => {
  it("a say beat lasts as long as its sound, and any beat can speak", () => {
    expect(parseBeat("say hello — friendly")).toMatchObject({
      ok: true,
      beat: { do: { kind: "say" }, note: "friendly" },
    });
    const spec = beats("say hello\nwave");
    // Without its sound, a say beat can't be directed.
    expect(
      applyAction(defaultScene(), {
        type: "directBeats",
        figure: "fig-1",
        t: 1,
        beats: spec,
      }).ok,
    ).toBe(false);
    const s = apply(defaultScene(), {
      type: "directBeats",
      figure: "fig-1",
      t: 1,
      beats: [
        { ...spec[0], speech: voice(2) },
        { ...spec[1], speech: voice(0.5, "hi") },
      ],
    });
    expect(s.beats[0]).toMatchObject({ t: 1, length: 2 });
    expect(s.speech.map((sp) => [sp.name, sp.start, sp.beat])).toEqual([
      ["hello", 1, true],
      ["hi", 3, true],
    ]);
    // Directed again over its time (1–2 s): that beat's sound is
    // replaced; the wave's at 3 s, outside it, and a lip-sync track
    // added by hand are kept.
    const withOwn = apply(s, {
      type: "addSpeech",
      speech: { figure: "fig-1", start: 1.5, ...voice(1, "own") },
    });
    const again = apply(withOwn, {
      type: "directBeats",
      figure: "fig-1",
      t: 1,
      beats: [{ ...spec[0], speech: voice(1, "bye") }],
    });
    expect(again.speech.map((sp) => sp.name).sort()).toEqual([
      "bye",
      "hi",
      "own",
    ]);
  });

  it("dragging a beat later moves it and what follows; the figure holds in the gap", () => {
    let s = apply(defaultScene(), {
      type: "updateFigure",
      figure: "fig-1",
      patch: { rotation: 90 },
    });
    s = apply(s, {
      type: "directBeats",
      figure: "fig-1",
      t: 0,
      beats: [
        ...beats("face the camera"),
        { ...beats("say hello")[0], speech: voice(1) },
        ...beats("turn left"),
      ],
    });
    const [, say, turn] = s.beats;
    expect(say.t).toBeCloseTo(POSE_TIME, 5);
    const moved = apply(s, {
      type: "moveBeat",
      figure: "fig-1",
      index: 1,
      to: say.t + 2,
    });
    // It and the beat after it moved by 2 s, with its sound.
    expect(moved.beats.map((b) => b.t)).toEqual([0, say.t + 2, turn.t + 2]);
    expect(moved.speech[0].start).toBeCloseTo(say.t + 2, 5);
    // In the gap the figure holds where the first beat left it.
    const at = (t: number) => evaluate(moved, t).scene.figures[0];
    expect(at(say.t + 1).rotation).toBe(0);
    expect(at(turn.t + 2 + POSE_TIME).rotation).toBe(90);
    // Never before the beat ahead ends; back to where it was works.
    const early = apply(moved, {
      type: "moveBeat",
      figure: "fig-1",
      index: 1,
      to: 0,
    });
    expect(early.beats[1].t).toBeCloseTo(say.t, 5);
    expect(early.beats[2].t).toBeCloseTo(turn.t, 5);
    expect(evaluate(early, turn.t + POSE_TIME).scene.figures[0].rotation).toBe(
      90,
    );
  });
});
