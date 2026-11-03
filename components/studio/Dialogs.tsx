"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import type { ViewportHandle } from "./StudioViewport";
import { downloadBlob, slug, type Studio } from "./useStudio";
import { Button, Dialog, Kbd, Segmented, Slider, Toggle } from "./ui";

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
}: {
  open: boolean;
  onClose: () => void;
  studio: Studio;
  viewport: React.RefObject<ViewportHandle | null>;
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
