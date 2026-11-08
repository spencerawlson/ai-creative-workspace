/** Lip-sync tracks in a scene (`scene.speech`): each is a figure's mouth,
 * read from a sound (lib/studio/lipSync.ts), from a start time on.
 *
 * The mouth is laid over what's shown (`withSpeech`), not written into
 * the scene: keyframes keep their own mouth, and a key set mid-sentence
 * doesn't catch the speech's open mouth. */

import type { SceneDoc, Speech } from "./schema";
import { SPEECH_FPS, VISEMES, mouthAt } from "./lipSync";

export function encodeMouth(frames: Uint8Array): string {
  let text = "";
  for (let i = 0; i < frames.length; i += 0x8000)
    text += String.fromCharCode(...frames.subarray(i, i + 0x8000));
  return btoa(text);
}

/** Decoded mouths, by their text: playback asks every frame. */
const decoded = new Map<string, Uint8Array>();

export function decodeMouth(mouth: string): Uint8Array {
  let frames = decoded.get(mouth);
  if (!frames) {
    let text = "";
    try {
      text = atob(mouth);
    } catch {
      // Damaged (the schema refuses these): no mouth.
    }
    const whole = text.length - (text.length % VISEMES.length);
    frames = Uint8Array.from(text.slice(0, whole), (c) => c.charCodeAt(0));
    if (decoded.size >= 32) decoded.clear();
    decoded.set(mouth, frames);
  }
  return frames;
}

/** Seconds of mouth in a track. */
export function speechLength(sp: Pick<Speech, "mouth">): number {
  return decodeMouth(sp.mouth).length / VISEMES.length / SPEECH_FPS;
}

export const speechEnd = (sp: Speech) => sp.start + speechLength(sp);

/** Anything that moves over time: keyframes or lip sync. */
export const isAnimated = (scene: SceneDoc) =>
  scene.animation.keys.length > 0 || scene.speech.length > 0;

/** `scene` as shown at `t` seconds: each figure that is speaking then
 * has its mouth from the track (the later track where two overlap).
 * The same object when no one is. */
export function withSpeech(scene: SceneDoc, t: number): SceneDoc {
  if (scene.speech.length === 0) return scene;
  let figures = scene.figures;
  for (const sp of scene.speech) {
    const mouth = mouthAt(decodeMouth(sp.mouth), t - sp.start);
    if (!mouth) continue;
    figures = figures.map((f) =>
      f.id === sp.figure
        ? {
            ...f,
            pose: { ...f.pose, joints: { ...f.pose.joints, mouth } },
          }
        : f,
    );
  }
  return figures === scene.figures ? scene : { ...scene, figures };
}
