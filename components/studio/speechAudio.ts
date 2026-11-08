/** The sounds behind lip-sync tracks, in the browser: decoded once from
 * this device's store (lib/studio/sounds.ts), played with the timeline,
 * and mixed for videos. A track whose sound isn't here stays silent. */

import { lipSync } from "@/lib/studio/lipSync";
import type { SceneDoc, Speech } from "@/lib/studio/schema";
import { addSoundFile, loadSound, soundName } from "@/lib/studio/sounds";
import { encodeMouth } from "@/lib/studio/speech";
import { decodeAudioFile } from "./recordVideo";

/** Decoded sounds by id; null: not on this device (or unreadable). */
const buffers = new Map<string, AudioBuffer | null>();
const loading = new Map<string, Promise<AudioBuffer | null>>();

/** A sound just read: no need to fetch and decode it again. */
export function rememberSound(id: string, buffer: AudioBuffer) {
  buffers.set(id, buffer);
}

export function soundBuffer(id: string): Promise<AudioBuffer | null> {
  if (buffers.has(id)) return Promise.resolve(buffers.get(id)!);
  let p = loading.get(id);
  if (!p) {
    p = loadSound(id)
      .then((blob) =>
        blob ? decodeAudioFile(new File([blob], id)).catch(() => null) : null,
      )
      .then((b) => {
        buffers.set(id, b);
        loading.delete(id);
        return b;
      });
    loading.set(id, p);
  }
  return p;
}

/** Below this share of the sound with a voice heard, there's no speech
 * to follow. */
const MIN_VOICED = 0.03;

/** A voice recording read for lip sync (lib/studio/lipSync.ts) and kept
 * on the device to play. Throws, with a reason, when it can't be read,
 * has no voice, or is longer than `room` seconds. `kept` explains why
 * the sound wasn't kept (the mouth still moves). */
export async function readVoice(
  file: File,
  room: number,
): Promise<{
  speech: Pick<Speech, "name" | "sound" | "mouth">;
  seconds: number;
  kept?: string;
}> {
  const buffer = await decodeAudioFile(file);
  if (buffer.duration > room + 0.05)
    throw new Error(
      `That sound is ${Math.round(buffer.duration * 10) / 10} s; there's room for ${Math.round(room * 10) / 10} s. Start earlier or trim the sound.`,
    );
  // Let a "Reading…" state paint before the analysis runs.
  await new Promise((r) => setTimeout(r, 0));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i),
  );
  const result = lipSync(channels, buffer.sampleRate);
  if (result.voiced < MIN_VOICED)
    throw new Error("No voice was heard in that sound.");
  const kept = await addSoundFile(file);
  if ("id" in kept) rememberSound(kept.id, buffer);
  return {
    speech: {
      name: soundName(file.name),
      ...("id" in kept ? { sound: kept.id } : {}),
      mouth: encodeMouth(result.frames),
    },
    seconds: result.duration,
    ...("error" in kept ? { kept: kept.error } : {}),
  };
}

/** Start decoding every track's sound, so playback has them. */
export function preloadSpeech(scene: SceneDoc) {
  for (const sp of scene.speech) if (sp.sound) void soundBuffer(sp.sound);
}

let ctx: AudioContext | null = null;

/** The page's audio output, woken inside a tap or key press (phones
 * only allow sound to start from one). */
export function wakeAudio(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Plays the scene's lip-sync sounds from a time, in step with the
 * timeline; `stop` silences them. */
export class SpeechPlayer {
  private sources: AudioBufferSourceNode[] = [];

  start(scene: SceneDoc, from: number) {
    this.stop();
    const out = wakeAudio();
    if (!out) return;
    const end = scene.animation.duration;
    for (const sp of scene.speech) {
      const buffer = sp.sound ? buffers.get(sp.sound) : null;
      if (!buffer) continue;
      const offset = from - sp.start;
      if (offset >= buffer.duration || sp.start >= end) continue;
      const src = out.createBufferSource();
      src.buffer = buffer;
      src.connect(out.destination);
      src.start(out.currentTime + Math.max(0, -offset), Math.max(0, offset));
      // The animation's end cuts it, as in a video.
      src.stop(out.currentTime + (end - from));
      this.sources.push(src);
    }
  }

  stop() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // Already ended.
      }
      s.disconnect();
    }
    this.sources = [];
  }
}

/** The scene's lip-sync sounds mixed into one, the animation's length;
 * null when none of them is on this device. */
export async function mixSpeech(
  scene: SceneDoc,
): Promise<{ name: string; buffer: AudioBuffer } | null> {
  const parts: Array<{ start: number; buffer: AudioBuffer; name: string }> = [];
  for (const sp of scene.speech) {
    const buffer = sp.sound ? await soundBuffer(sp.sound) : null;
    if (buffer) parts.push({ start: sp.start, buffer, name: sp.name });
  }
  if (parts.length === 0) return null;
  const rate = 48000;
  const length = Math.ceil(scene.animation.duration * rate);
  const off = new OfflineAudioContext(2, length, rate);
  for (const p of parts) {
    const src = off.createBufferSource();
    src.buffer = p.buffer;
    src.connect(off.destination);
    src.start(p.start);
  }
  return {
    name:
      parts.length === 1 ? parts[0].name : `Lip sync (${parts.length} sounds)`,
    buffer: await off.startRendering(),
  };
}
