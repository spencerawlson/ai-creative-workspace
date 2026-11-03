/** Record the keyframe animation to a video file in the browser: each
 * frame is evaluated, drawn at the video's size and handed to a
 * MediaRecorder on the canvas. No server, no extra dependency.
 *
 * MediaRecorder timestamps frames by wall-clock time, so frames are
 * paced in real time. A device that can't draw a frame within 1/fps
 * makes the video run slower there; the dialog says so. */

import { evaluate } from "@/lib/studio/animation";
import type { SceneDoc } from "@/lib/studio/schema";
import type { ViewportHandle } from "./StudioViewport";

export type VideoFormat = { mimeType: string; extension: "mp4" | "webm" };

/** The best format this browser can record, or null if it can't. */
export function videoFormat(): VideoFormat | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates: VideoFormat[] = [
    { mimeType: "video/mp4;codecs=avc1", extension: "mp4" },
    { mimeType: "video/mp4", extension: "mp4" },
    { mimeType: "video/webm;codecs=vp9", extension: "webm" },
    { mimeType: "video/webm;codecs=vp8", extension: "webm" },
    { mimeType: "video/webm", extension: "webm" },
  ];
  return (
    candidates.find((c) => MediaRecorder.isTypeSupported(c.mimeType)) ?? null
  );
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
}): Promise<{ blob: Blob; format: VideoFormat; slowFrames: number }> {
  const format = videoFormat();
  if (!format) throw new Error("This browser can't record video.");
  const { viewport, scene, width, height, fps } = opts;
  const canvas = viewport.beginCapture(width, height);
  if (!canvas) throw new Error("The 3D view is not ready yet.");
  try {
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    const recorder = new MediaRecorder(stream, {
      mimeType: format.mimeType,
      videoBitsPerSecond: Math.round(width * height * fps * 0.12),
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.start();

    const frames = Math.max(1, Math.round(scene.animation.duration * fps));
    const start = performance.now();
    let slowFrames = 0;
    for (let i = 0; i <= frames; i++) {
      if (opts.signal?.aborted) {
        recorder.stop();
        await stopped;
        throw new DOMException("Recording cancelled", "AbortError");
      }
      const frame = evaluate(
        scene,
        Math.min(i / fps, scene.animation.duration),
      );
      viewport.preview(frame.scene);
      if (opts.keyCamera && frame.view) viewport.setCameraPlacement(frame.view);
      viewport.renderCapture();
      track.requestFrame();
      opts.onProgress?.(i / frames);
      // Real-time pacing: the next frame belongs at start + (i+1)/fps.
      const due = start + ((i + 1) * 1000) / fps;
      const wait = due - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      else slowFrames++;
    }
    recorder.stop();
    await stopped;
    track.stop();
    return {
      blob: new Blob(chunks, { type: format.mimeType.split(";")[0] }),
      format,
      slowFrames,
    };
  } finally {
    viewport.endCapture();
  }
}
