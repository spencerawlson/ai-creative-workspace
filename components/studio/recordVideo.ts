/** Render the keyframe animation to a video file in the browser.
 *
 * Every frame is evaluated, drawn at the video's size and encoded with
 * WebCodecs at an exact timestamp (via mediabunny, which also writes
 * the MP4/WebM container). Nothing is real-time: a slow device takes
 * longer to export but the video's timing is always exact, and no
 * frame is dropped. (MediaRecorder, tried first, drops frames while its
 * encoder starts up — the first ~2 s of a short animation went missing.)
 *
 * mediabunny is loaded only when a video is exported. */

import { evaluate } from "@/lib/studio/animation";
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

export async function recordVideo(opts: {
  viewport: ViewportHandle;
  scene: SceneDoc;
  width: number;
  height: number;
  fps: number;
  /** Move the camera along its keys (as playback does). */
  keyCamera: boolean;
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
  const output = new mb.Output({
    format:
      format.extension === "mp4"
        ? new mb.Mp4OutputFormat()
        : new mb.WebMOutputFormat(),
    target,
  });
  try {
    const source = new mb.CanvasSource(canvas, {
      codec: format.codec,
      quality: mb.QUALITY_HIGH,
    });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();

    // Frames 0 .. duration inclusive, each 1/fps long.
    const frames = Math.round(scene.animation.duration * fps) + 1;
    for (let i = 0; i < frames; i++) {
      if (opts.signal?.aborted)
        throw new DOMException("Export cancelled", "AbortError");
      const frame = evaluate(
        scene,
        Math.min(i / fps, scene.animation.duration),
      );
      viewport.preview(frame.scene);
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
