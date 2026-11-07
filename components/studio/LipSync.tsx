"use client";

import { useRef, useState } from "react";
import { AudioLines, X } from "lucide-react";
import { roundTime } from "@/lib/studio/animation";
import { lipSync } from "@/lib/studio/lipSync";
import { LIMITS, type Figure } from "@/lib/studio/schema";
import { addSoundFile, soundName } from "@/lib/studio/sounds";
import { encodeMouth, speechEnd } from "@/lib/studio/speech";
import { decodeAudioFile } from "./recordVideo";
import { rememberSound } from "./speechAudio";
import type { Studio } from "./useStudio";
import { Button, IconButton, SectionTitle } from "./ui";

/** Below this share of the sound with a voice heard, there's no speech
 * to follow. */
const MIN_VOICED = 0.03;

const secs = (t: number) => `${Math.round(t * 10) / 10} s`;

/** Lip sync for one figure: read a sound on the device, and the mouth
 * follows it from the playhead (lib/studio/lipSync.ts). */
export function LipSyncSection({
  studio,
  figure,
  time,
  /** False when the figure's character has no mouth shapes. */
  canSpeak,
}: {
  studio: Studio;
  figure: Figure;
  time: number;
  canSpeak: boolean;
}) {
  const { scene, dispatch, notify } = studio;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tracks = scene.speech
    .map((sp, index) => ({ sp, index }))
    .filter(({ sp }) => sp.figure === figure.id);

  async function read(file: File) {
    setBusy(true);
    setError(null);
    try {
      const start = roundTime(time);
      const room = LIMITS.duration[1] - start;
      const buffer = await decodeAudioFile(file);
      if (buffer.duration > room + 0.05)
        throw new Error(
          `That sound is ${secs(buffer.duration)}; from ${secs(start)} there's room for ${secs(room)}. Move the playhead earlier or trim the sound.`,
        );
      // Let the "Reading…" state paint before the analysis runs.
      await new Promise((r) => setTimeout(r, 0));
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
        buffer.getChannelData(i),
      );
      const result = lipSync(channels, buffer.sampleRate);
      if (result.voiced < MIN_VOICED)
        throw new Error("No voice was heard in that sound.");
      const kept = await addSoundFile(file);
      if ("id" in kept) rememberSound(kept.id, buffer);
      dispatch({
        type: "addSpeech",
        speech: {
          figure: figure.id,
          start,
          name: soundName(file.name),
          ...("id" in kept ? { sound: kept.id } : {}),
          mouth: encodeMouth(result.frames),
        },
      });
      notify(
        "id" in kept
          ? `Lip sync: ${secs(result.duration)} from ${secs(start)}. Press Space to play it with the sound.`
          : `Lip sync: ${secs(result.duration)} from ${secs(start)}. ${kept.error} The mouth moves; the sound won't play.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that sound.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Lip sync" data-testid="lip-sync" className="mt-3">
      <SectionTitle>Lip sync</SectionTitle>
      <p className="text-2xs leading-relaxed text-ink-300">
        {canSpeak
          ? "Pick a recording of a voice: the mouth follows it from the playhead, opening with how loud it is and shaping each vowel. It's read on this device; the sound isn't uploaded."
          : "This character has no mouth shapes, so its mouth can't follow a sound."}
      </p>
      <input
        ref={input}
        type="file"
        accept="audio/*"
        className="sr-only"
        tabIndex={-1}
        aria-label="Sound for lip sync"
        data-testid="lip-sync-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void read(file);
        }}
      />
      <Button
        size="sm"
        icon={AudioLines}
        className="mt-2"
        disabled={busy || !canSpeak}
        onClick={() => input.current?.click()}
        data-testid="lip-sync-add"
      >
        {busy ? "Reading the sound…" : `From a sound at ${secs(time)}`}
      </Button>
      {error && (
        <p
          role="alert"
          className="mt-1.5 text-xs text-danger"
          data-testid="lip-sync-error"
        >
          {error}
        </p>
      )}
      {tracks.length > 0 && (
        <ul className="mt-2 space-y-1" data-testid="lip-sync-tracks">
          {tracks.map(({ sp, index }) => (
            <li
              key={index}
              className="flex items-center gap-2 rounded-md bg-ink-800 px-2 py-1 text-xs text-ink-200"
            >
              <span className="min-w-0 flex-1 truncate" title={sp.name}>
                {sp.name}
              </span>
              <span className="shrink-0 text-2xs text-ink-400">
                {secs(sp.start)}–{secs(speechEnd(sp))}
                {sp.sound ? "" : " · silent"}
              </span>
              <IconButton
                icon={X}
                size="sm"
                label={`Remove lip sync ${sp.name}`}
                onClick={() => dispatch({ type: "removeSpeech", index })}
                data-testid={`lip-sync-remove-${index}`}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
