/** Render the keyframe animation to a video file in the browser.
 *
 * Every frame is evaluated, drawn at the video's size and encoded with
 * WebCodecs at an exact timestamp (via mediabunny, which also writes
 * the MP4/WebM container). Nothing is real-time: a slow device takes
 * longer to export but the video's timing is always exact, and no
 * frame is dropped. (MediaRecorder, tried first, drops frames while its
 * encoder starts up — the first ~2 s of a short animation went missing.)
 *
 * An optional sound (an audio file the user picks, decoded in the
 * browser) is cut to the animation's length and encoded alongside: AAC
 * in MP4 or Opus, whichever the browser can encode for the container.
 *
 * mediabunny is loaded only when a video is exported. */

import { evaluate } from "@/lib/studio/animation";
import { withSpeech } from "@/lib/studio/speech";
import type { SceneDoc } from "@/lib/studio/schema";
import type { ViewportHandle } from "./StudioViewport";

export type VideoFormat = {
  codec: "avc" | "vp9" | "vp8";
  extension: "mp4" | "webm";
};

let picked: Promise<VideoFormat | null> | null = null;

/** What this browser can really encode: MP4 (H.264) where possible,
 * since it plays everywhere, else WebM (VP9/VP8). Asked once. */
export function videoFormat(): Promise<VideoFormat | null> {
  picked ??= (async () => {
    if (typeof VideoEncoder === "undefined") return null;
    const mb = await import("mediabunny");
    const size = { width: 1920, height: 1080 };
    if (await mb.canEncodeVideo("avc", size))
      return { codec: "avc", extension: "mp4" } as const;
    const webm = await mb.getFirstEncodableVideoCodec(["vp9", "vp8"], size);
    return webm === "vp9" || webm === "vp8"
      ? ({ codec: webm, extension: "webm" } as const)
      : null;
  })().catch(() => null);
  return picked;
}

/** The first `seconds` of a sound (all of it if shorter). */
export function trimAudio(buffer: AudioBuffer, seconds: number): AudioBuffer {
  const length = Math.min(
    buffer.length,
    Math.ceil(seconds * buffer.sampleRate),
  );
  if (length === buffer.length) return buffer;
  const out = new AudioBuffer({
    length,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
  });
  for (let c = 0; c < buffer.numberOfChannels; c++)
    out.copyToChannel(buffer.getChannelData(c).subarray(0, length), c);
  return out;
}

/** Decode an audio file the user picked (never uploaded). */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, 1, 48000);
  try {
    return await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error(`Couldn't read “${file.name}” as sound.`);
  }
}

export async function recordVideo(opts: {
  viewport: ViewportHandle;
  scene: SceneDoc;
  width: number;
  height: number;
  fps: number;
  /** Move the camera along its keys (as playback does). */
  keyCamera: boolean;
  /** Sound for the video, from the start; cut to the animation. */
  audio?: AudioBuffer;
  onProgress?: (done: number) => void;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; format: VideoFormat }> {
  const format = await videoFormat();
  if (!format) throw new Error("This browser can't encode video.");
  const mb = await import("mediabunny");
  const { viewport, scene, width, height, fps } = opts;
  const canvas = viewport.beginCapture(width, height);
  if (!canvas) throw new Error("The 3D view is not ready yet.");
  const target = new mb.BufferTarget();
  const container =
    format.extension === "mp4"
      ? new mb.Mp4OutputFormat()
      : new mb.WebMOutputFormat();
  const output = new mb.Output({ format: container, target });
  try {
    const source = new mb.CanvasSource(canvas, {
      codec: format.codec,
      quality: mb.QUALITY_HIGH,
    });
    output.addVideoTrack(source, { frameRate: fps });
    let sound: InstanceType<typeof mb.AudioBufferSource> | null = null;
    if (opts.audio) {
      const { numberOfChannels, sampleRate } = opts.audio;
      const codec = await mb.getFirstEncodableAudioCodec(
        container.getSupportedAudioCodecs(),
        { numberOfChannels, sampleRate },
      );
      if (!codec)
        throw new Error(
          "This browser can't encode sound for this video format.",
        );
      sound = new mb.AudioBufferSource({ codec, quality: mb.QUALITY_HIGH });
      output.addAudioTrack(sound);
    }
    await output.start();
    if (sound && opts.audio)
      await sound.add(trimAudio(opts.audio, scene.animation.duration));

    // Frames 0 .. duration inclusive, each 1/fps long.
    const frames = Math.round(scene.animation.duration * fps) + 1;
    for (let i = 0; i < frames; i++) {
      if (opts.signal?.aborted)
        throw new DOMException("Export cancelled", "AbortError");
      const t = Math.min(i / fps, scene.animation.duration);
      const frame = evaluate(scene, t);
      viewport.preview(withSpeech(frame.scene, t));
      if (opts.keyCamera && frame.view) viewport.setCameraPlacement(frame.view);
      viewport.renderCapture();
      await source.add(i / fps, 1 / fps); // waits for the encoder
      opts.onProgress?.((i + 1) / frames);
      // Let the page paint the progress bar.
      await new Promise((r) => setTimeout(r, 0));
    }
    await output.finalize();
    if (!target.buffer || target.buffer.byteLength === 0)
      throw new Error("The browser produced an empty video.");
    return {
      blob: new Blob([target.buffer], {
        type: format.extension === "mp4" ? "video/mp4" : "video/webm",
      }),
      format,
    };
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    viewport.endCapture();
  }
}
