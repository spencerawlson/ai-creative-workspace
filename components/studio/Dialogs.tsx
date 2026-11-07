"use client";

import { useEffect, useRef, useState } from "react";
import { Box, Download, Music, X } from "lucide-react";
import type { ViewportHandle } from "./StudioViewport";
import {
  decodeAudioFile,
  recordVideo,
  videoFormat,
  type VideoFormat,
} from "./recordVideo";
import { downloadBlob, slug, type Studio } from "./useStudio";
import { isAnimated } from "@/lib/studio/speech";
import { mixSpeech } from "./speechAudio";
import {
  Button,
  Dialog,
  IconButton,
  Kbd,
  Segmented,
  Slider,
  Toggle,
} from "./ui";

type SizeId = "viewport" | "1080p" | "4k" | "square" | "portrait" | "custom";
const SIZES: Record<
  Exclude<SizeId, "viewport" | "custom">,
  { label: string; w: number; h: number }
> = {
  "1080p": { label: "1920 × 1080 (16:9)", w: 1920, h: 1080 },
  "4k": { label: "3840 × 2160 (4K)", w: 3840, h: 2160 },
  square: { label: "2048 × 2048 (1:1)", w: 2048, h: 2048 },
  portrait: { label: "1080 × 1350 (4:5)", w: 1080, h: 1350 },
};

export function ExportDialog({
  open,
  onClose,
  studio,
  viewport,
  onExport3D,
}: {
  open: boolean;
  onClose: () => void;
  studio: Studio;
  viewport: React.RefObject<ViewportHandle | null>;
  /** Switch to the 3D file export. */
  onExport3D?: () => void;
}) {
  const [sizeId, setSizeId] = useState<SizeId>("viewport");
  const [custom, setCustom] = useState({ w: 2400, h: 3000 });
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [transparent, setTransparent] = useState(false);
  const [quality, setQuality] = useState(0.92);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const max = viewport.current?.getStats()?.maxExportSize ?? 4096;
  const vp = viewport.current?.viewportSize() ?? { width: 1280, height: 720 };
  const size =
    sizeId === "viewport"
      ? { w: Math.round(vp.width * 2), h: Math.round(vp.height * 2) }
      : sizeId === "custom"
        ? custom
        : SIZES[sizeId];
  const scale = Math.min(1, max / Math.max(size.w, size.h));
  const final = {
    w: Math.max(16, Math.floor(size.w * scale)),
    h: Math.max(16, Math.floor(size.h * scale)),
  };

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const blob = await viewport.current!.exportImage({
        width: final.w,
        height: final.h,
        format: format === "png" ? "image/png" : "image/jpeg",
        transparent: format === "png" && transparent,
        quality,
      });
      downloadBlob(
        blob,
        `${slug(studio.name)}-${studio.scene.preset}-${final.w}x${final.h}.${format === "png" ? "png" : "jpg"}`,
      );
      studio.notify(
        `Exported ${final.w} × ${final.h} ${format.toUpperCase()}.`,
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export image"
      testId="export-dialog"
      footer={
        <>
          {onExport3D && (
            <Button
              variant="ghost"
              icon={Box}
              className="mr-auto"
              onClick={onExport3D}
              data-testid="export-3d-open"
            >
              3D file
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Download}
            onClick={run}
            disabled={busy}
            data-testid="export-confirm"
          >
            {busy ? "Rendering…" : `Export ${format.toUpperCase()}`}
          </Button>
        </>
      }
    >
      <fieldset className="py-1.5">
        <legend className="mb-1 text-xs text-ink-300">Size</legend>
        <div className="grid gap-1">
          {(
            [
              ["viewport", `Viewport × 2 (${vp.width * 2} × ${vp.height * 2})`],
              ...Object.entries(SIZES).map(([k, v]) => [k, v.label]),
              ["custom", "Custom"],
            ] as Array<[SizeId, string]>
          ).map(([id, label]) => (
            <label
              key={id}
              className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-ink-800"
            >
              <input
                type="radio"
                name="export-size"
                value={id}
                checked={sizeId === id}
                onChange={() => setSizeId(id)}
                className="accent-[#f2b35a]"
              />
              {label}
            </label>
          ))}
        </div>
        {sizeId === "custom" && (
          <div className="mt-2 flex items-center gap-2 px-2 text-sm">
            {(["w", "h"] as const).map((k) => (
              <label key={k} className="flex items-center gap-1.5">
                <span className="text-xs text-ink-400">
                  {k === "w" ? "Width" : "Height"}
                </span>
                <input
                  type="number"
                  min={16}
                  max={max}
                  value={custom[k]}
                  onChange={(e) =>
                    setCustom((c) => ({
                      ...c,
                      [k]: Math.max(
                        16,
                        Math.min(max, Number(e.target.value) || 16),
                      ),
                    }))
                  }
                  className="h-8 w-24 rounded-md border border-ink-700 bg-ink-850 px-2 tabular-nums"
                />
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <Segmented
        label="Format"
        value={format}
        onChange={setFormat}
        options={[
          { value: "png", label: "PNG (lossless)" },
          { value: "jpeg", label: "JPEG" },
        ]}
      />
      {format === "png" ? (
        <Toggle
          label="Transparent background"
          checked={transparent}
          onChange={setTransparent}
          hint="Keeps the floor shadow as soft alpha — ready to composite."
        />
      ) : (
        <Slider
          label="JPEG quality"
          value={quality}
          min={0.6}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={setQuality}
        />
      )}
      <p className="mt-2 text-2xs text-ink-400" data-testid="export-summary">
        Output: {final.w} × {final.h}px
        {scale < 1 && ` (reduced to this device's ${max}px limit)`}. Light
        handles are hidden in exports. This is a render of the 3D scene, not a
        photograph.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}

export const SHORTCUTS: Array<[string, string[]]> = [
  ["Undo", ["Ctrl", "Z"]],
  ["Redo", ["Ctrl", "Shift", "Z"]],
  ["Apply preset 1–6", ["1 … 6"]],
  ["Face / full body / studio overview", ["F", "B", "O"]],
  ["Select next / previous light", ["L", "Shift+L"]],
  ["Move selected light (viewport focused)", ["←", "→", "↑", "↓"]],
  ["Toggle selected light on/off", ["T"]],
  ["Duplicate selected light", ["Ctrl", "D"]],
  ["Delete selected light", ["Del"]],
  ["Switch mannequin", ["M"]],
  ["Pose the mannequin", ["P"]],
  ["Show/hide light handles", ["H"]],
  ["Play / pause animation", ["Space"]],
  ["Set keyframe at the current time", ["K"]],
  ["Previous / next keyframe", [",", "."]],
  ["Show/hide graph editor", ["G"]],
  ["Preview animation (Esc to exit)", ["V"]],
  ["Toggle side panel", ["["]],
  ["Deselect", ["Esc"]],
  ["Export image", ["Ctrl", "E"]],
  ["Save project file", ["Ctrl", "S"]],
  ["Orbit camera (viewport focused, no light selected)", ["←", "→", "↑", "↓"]],
  ["Zoom (viewport focused)", ["+", "−"]],
  ["This list", ["?"]],
];

export function ShortcutsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      testId="shortcuts-dialog"
    >
      <dl className="divide-y divide-ink-750">
        {SHORTCUTS.map(([what, keys]) => (
          <div
            key={what}
            className="flex items-center justify-between gap-4 py-2"
          >
            <dt className="text-sm text-ink-200">{what}</dt>
            <dd className="flex shrink-0 gap-1">
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-2xs text-ink-400">
        On a Mac, use ⌘ instead of Ctrl.
      </p>
    </Dialog>
  );
}

const VIDEO_SIZES = {
  "720p": { label: "1280 × 720 (16:9)", w: 1280, h: 720 },
  "1080p": { label: "1920 × 1080 (16:9)", w: 1920, h: 1080 },
  square: { label: "1080 × 1080 (1:1)", w: 1080, h: 1080 },
  vertical: { label: "1080 × 1920 (9:16)", w: 1080, h: 1920 },
} as const;
type VideoSizeId = keyof typeof VIDEO_SIZES;

/** Record the keyframe animation to a video file (in the browser). */
export function VideoExportDialog({
  open,
  onClose,
  studio,
  viewport,
  keyCamera,
  onFinished,
}: {
  open: boolean;
  onClose: () => void;
  studio: Studio;
  viewport: React.RefObject<ViewportHandle | null>;
  keyCamera: boolean;
  /** Recording leaves the last frame on screen; restore the studio. */
  onFinished: () => void;
}) {
  const [sizeId, setSizeId] = useState<VideoSizeId>("720p");
  const [fps, setFps] = useState<"24" | "30" | "60">("30");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  // Optional sound, decoded here in the browser.
  const [sound, setSound] = useState<{
    name: string;
    buffer: AudioBuffer;
  } | null>(null);
  const soundInput = useRef<HTMLInputElement>(null);
  // Which format this browser really records (checked once, async).
  const [format, setFormat] = useState<VideoFormat | null | undefined>();
  useEffect(() => {
    if (open) void videoFormat().then(setFormat);
  }, [open]);
  // With lip sync, its sounds are the video's unless another is picked.
  const speechScene = useRef(studio.scene);
  speechScene.current = studio.scene;
  useEffect(() => {
    if (!open || speechScene.current.speech.length === 0) return;
    let cancelled = false;
    void mixSpeech(speechScene.current).then((mixed) => {
      if (mixed && !cancelled) setSound((s) => s ?? mixed);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);
  const { duration } = studio.scene.animation;
  const size = VIDEO_SIZES[sizeId];

  async function run() {
    setError(null);
    setProgress(0);
    abort.current = new AbortController();
    try {
      const { blob, format: f } = await recordVideo({
        viewport: viewport.current!,
        scene: studio.scene,
        width: size.w,
        height: size.h,
        fps: Number(fps),
        keyCamera,
        audio: sound?.buffer,
        onProgress: setProgress,
        signal: abort.current.signal,
      });
      downloadBlob(
        blob,
        `${slug(studio.name)}-animation-${size.w}x${size.h}.${f.extension}`,
      );
      studio.notify(
        `Exported ${duration} s ${size.w} × ${size.h} ${f.extension.toUpperCase()} video${sound ? " with sound" : ""}.`,
      );
      onClose();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setError(e instanceof Error ? e.message : "Recording failed.");
    } finally {
      setProgress(null);
      abort.current = null;
      onFinished();
    }
  }

  const busy = progress !== null;
  return (
    <Dialog
      open={open}
      onClose={() => {
        abort.current?.abort();
        onClose();
      }}
      title="Export video"
      testId="video-dialog"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => (busy ? abort.current?.abort() : onClose())}
            data-testid="video-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Download}
            onClick={run}
            disabled={busy || !format || !isAnimated(studio.scene)}
            data-testid="video-confirm"
          >
            {busy
              ? `Rendering… ${Math.round(progress * 100)}%`
              : `Export ${format?.extension.toUpperCase() ?? "video"}`}
          </Button>
        </>
      }
    >
      <fieldset className="py-1.5" disabled={busy}>
        <legend className="mb-1 text-xs text-ink-300">Size</legend>
        <div className="grid gap-1">
          {(Object.keys(VIDEO_SIZES) as VideoSizeId[]).map((id) => (
            <label
              key={id}
              className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-ink-800"
            >
              <input
                type="radio"
                name="video-size"
                value={id}
                checked={sizeId === id}
                onChange={() => setSizeId(id)}
                className="accent-[#f2b35a]"
                data-testid={`video-size-${id}`}
              />
              {VIDEO_SIZES[id].label}
            </label>
          ))}
        </div>
      </fieldset>
      <Segmented
        label="Frame rate"
        value={fps}
        onChange={setFps}
        testIdPrefix="video-fps"
        options={[
          { value: "24", label: "24 fps" },
          { value: "30", label: "30 fps" },
          { value: "60", label: "60 fps" },
        ]}
      />
      <fieldset className="mt-2 py-1" disabled={busy}>
        <legend className="mb-1 text-xs text-ink-300">Sound</legend>
        <input
          ref={soundInput}
          type="file"
          accept="audio/*"
          className="sr-only"
          aria-label="Sound file"
          data-testid="video-sound-input"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setError(null);
            try {
              setSound({
                name: file.name,
                buffer: await decodeAudioFile(file),
              });
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : "Couldn't read that sound.",
              );
            }
          }}
        />
        <div className="flex min-h-8 items-center gap-2">
          <Button
            size="sm"
            icon={Music}
            onClick={() => soundInput.current?.click()}
            data-testid="video-sound-pick"
          >
            {sound ? "Change sound" : "Add a sound file"}
          </Button>
          {sound && (
            <>
              <span
                className="min-w-0 truncate text-xs text-ink-200"
                data-testid="video-sound-name"
              >
                {sound.name} · {sound.buffer.duration.toFixed(1)} s
              </span>
              <IconButton
                icon={X}
                size="sm"
                label="Remove sound"
                onClick={() => setSound(null)}
                data-testid="video-sound-remove"
              />
            </>
          )}
        </div>
        <p className="mt-1 text-2xs text-ink-400">
          {sound
            ? sound.buffer.duration > duration
              ? `Plays from the start and is cut at ${duration} s.`
              : "Plays from the start; silence after it ends."
            : "Optional: music or speech from your device, mixed into the video. It stays on your device."}
        </p>
      </fieldset>
      {busy && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label="Export progress"
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-800"
        >
          <div
            className="h-full bg-accent transition-[width]"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}
      <p className="mt-2 text-2xs text-ink-400" data-testid="video-summary">
        {format === undefined
          ? "Checking which video format this browser can encode…"
          : !format
            ? "This browser can't encode video. Try a current Chrome, Edge, Firefox or Safari."
            : !isAnimated(studio.scene)
              ? "There's no animation yet: set keyframes on the timeline first."
              : `${duration} s at ${fps} fps, ${size.w} × ${size.h}, as ${format.extension.toUpperCase()} (${format.codec === "avc" ? "H.264" : format.codec.toUpperCase()}). Every frame is rendered exactly; a slow device just takes longer. Light handles are hidden.`}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}

/** The figures as a 3D file (lib/engine/gltfExport.ts). */
export function Export3DDialog({
  open,
  onClose,
  studio,
  viewport,
}: {
  open: boolean;
  onClose: () => void;
  studio: Studio;
  viewport: React.RefObject<ViewportHandle | null>;
}) {
  const animated = isAnimated(studio.scene);
  const [animation, setAnimation] = useState(true);
  const [stage, setStage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seconds = studio.scene.animation.duration;
  const areaLights = studio.scene.lights.filter(
    (l) => l.kind === "area",
  ).length;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await viewport.current!.exportGltf({
        animation: animated && animation,
        stage,
      });
      downloadBlob(r.blob, `${slug(studio.name)}.glb`);
      const mb = (r.blob.size / 1e6).toFixed(1);
      studio.notify(
        `Exported a 3D file (${mb} MB${r.frames ? `, ${r.frames} frames` : ""}${
          r.skippedLights
            ? `; ${r.skippedLights} softbox light${r.skippedLights > 1 ? "s" : ""} left out`
            : ""
        }).`,
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export 3D file"
      testId="export-3d-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Download}
            onClick={run}
            disabled={busy}
            data-testid="export-3d-confirm"
          >
            {busy ? "Exporting…" : "Export GLB"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-200">
        The figures as posed, with their skeletons and faces, in one glTF file
        (.glb) that opens in Blender, Unity, Unreal, Maya and most 3D tools.
      </p>
      <Toggle
        label="Include the animation"
        checked={animated && animation}
        onChange={setAnimation}
        disabled={!animated}
        testId="export-3d-animation"
        hint={
          animated
            ? `${seconds} s at 30 frames a second: every bone, where the figures move, their faces.`
            : "This scene has no keyframes, so the file holds the pose as it is now."
        }
      />
      <Toggle
        label="Include the camera and lights"
        checked={stage}
        onChange={setStage}
        testId="export-3d-stage"
        hint={
          areaLights
            ? `glTF has no area lights, so ${areaLights === 1 ? "the softbox is" : `the ${areaLights} softboxes are`} left out; the other lights come along.`
            : "The camera as it is now (and as animated), and the lights."
        }
      />
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}
