"use client";

import { useState } from "react";
import { BrandLink, Sidebar, WorkspaceMenu } from "@/components/WorkspaceNav";
import { LightingScene, type MannequinModel } from "@/components/LightingScene";
import {
  SectionTitle,
  Segmented,
  Slider,
  Tip,
  Toggle,
  cx,
} from "@/components/studio/ui";
import { PRESETS, cloneLights } from "@/lib/lighting";
import {
  EXPOSURES,
  EXPOSURE_HONEST_NOTE,
  FRAMINGS,
  focalToFov,
  type FramingId,
} from "@/lib/photography";

/** Photography: camera, composition and exposure, taught on the studio's
 * scene (the same component, models and lights). Laid out like the other
 * workspaces: the sidebar, a panel of controls, the camera view.
 * Exposure brightens or darkens the preview; it is not a camera sensor
 * simulation (the honest note says so). There's no photo export. */

export default function Photography() {
  const [framing, setFraming] = useState<FramingId>("portrait");
  const [focalMm, setFocalMm] = useState(50);
  const [exposureId, setExposureId] = useState("daylight");
  const [showThirds, setShowThirds] = useState(true);
  const [model, setModel] = useState<MannequinModel>("male");
  const [viewNonce, setViewNonce] = useState(0);

  const framingPreset = FRAMINGS.find((f) => f.id === framing) ?? FRAMINGS[1];
  const exposurePreset =
    EXPOSURES.find((e) => e.id === exposureId) ?? EXPOSURES[0];
  // Lighting stays at the default Three-point setup: the camera is the
  // lesson here, not a second light editor.
  const [lights] = useState(() => cloneLights(PRESETS[0].lights));

  function applyFraming(id: FramingId) {
    const f = FRAMINGS.find((x) => x.id === id);
    if (!f) return;
    setFraming(id);
    setFocalMm(f.focalMm);
    // Re-aim even when the view itself (face/full) doesn't change.
    setViewNonce((n) => n + 1);
  }

  return (
    <main className="flex h-dvh flex-col bg-ink-950 text-ink-100">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-ink-800 bg-ink-900 px-2 sm:px-3">
        <BrandLink />
        {/* Phones have no sidebar: the workspaces are a menu here. */}
        <WorkspaceMenu current="photography" className="md:hidden" />
        <div className="mx-1 hidden h-6 w-px bg-ink-750 sm:block" />
        <h1 className="truncate text-sm font-medium text-ink-100">
          Camera basics
        </h1>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="hidden md:flex">
          <Sidebar current="photography" />
        </div>

        {/* The camera view: first on phones, on the right on wider screens. */}
        <div className="relative order-1 min-h-[45dvh] flex-1 bg-black md:order-3 md:min-h-0">
          <LightingScene
            lights={lights}
            view={framingPreset.view}
            viewNonce={viewNonce}
            model={model}
            fov={focalToFov(focalMm)}
            exposure={exposurePreset.exposure}
          />
          {showThirds && (
            <div
              data-testid="thirds-overlay"
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
            >
              <div className="absolute inset-y-0 left-1/3 w-px bg-white/35" />
              <div className="absolute inset-y-0 left-2/3 w-px bg-white/35" />
              <div className="absolute inset-x-0 top-1/3 h-px bg-white/35" />
              <div className="absolute inset-x-0 top-2/3 h-px bg-white/35" />
            </div>
          )}
          <p className="pointer-events-none absolute bottom-2 left-3 right-3 text-2xs text-ink-300">
            Drag to orbit · scroll or pinch to zoom
          </p>
        </div>

        <aside
          aria-label="Camera controls"
          className="order-2 max-h-[55dvh] shrink-0 overflow-y-auto border-t border-ink-800 bg-ink-900 px-3 pb-6 md:max-h-none md:w-80 md:border-r md:border-t-0"
        >
          <SectionTitle>Framing</SectionTitle>
          <Segmented
            label="Framing"
            hideLabel
            value={framing}
            testIdPrefix="framing"
            options={FRAMINGS.map((f) => ({ value: f.id, label: f.name }))}
            onChange={applyFraming}
          />
          <div
            className="mt-1 rounded-md bg-ink-850 px-3 py-2"
            aria-live="polite"
          >
            <p className="text-xs font-medium text-ink-100">
              {framingPreset.name}: what to watch
            </p>
            <p className="mt-1 text-2xs leading-relaxed text-ink-300">
              {framingPreset.note}
            </p>
          </div>

          <SectionTitle>Lens</SectionTitle>
          <Slider
            label="Focal length"
            value={focalMm}
            min={24}
            max={85}
            step={1}
            unit=" mm"
            testId="photo-focal"
            format={(v) => `${v} mm · ${focalToFov(v).toFixed(0)}° view`}
            hint="Shorter sees wider; longer sees narrower and flattens a face gently. Angle of view only: no lens distortion or depth of field."
            onChange={setFocalMm}
          />

          <SectionTitle>Composition</SectionTitle>
          <Toggle
            label="Rule-of-thirds guide"
            checked={showThirds}
            onChange={setShowThirds}
            hint="Put the eyes or the main subject near where the lines cross, not dead centre, unless centre is the point. The guide is drawn over the view, not part of any picture."
            testId="photo-thirds"
          />

          <SectionTitle>Exposure</SectionTitle>
          <div className="space-y-1" role="group" aria-label="Exposure">
            {EXPOSURES.map((e) => (
              <button
                key={e.id}
                type="button"
                data-testid={`exposure-${e.id}`}
                onClick={() => setExposureId(e.id)}
                aria-pressed={exposureId === e.id}
                className={cx(
                  "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors",
                  exposureId === e.id
                    ? "bg-accent-soft text-ink-100 ring-1 ring-accent"
                    : "bg-ink-850 text-ink-200 hover:bg-ink-800",
                )}
              >
                <span>{e.name}</span>
                <span
                  className={cx(
                    "text-2xs",
                    // ink-400 fails AA on the amber selection tint.
                    exposureId === e.id ? "text-ink-200" : "text-ink-400",
                  )}
                >
                  {e.aperture} · ISO {e.iso}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-2xs leading-relaxed text-ink-300">
            {exposurePreset.aperture} · ISO {exposurePreset.iso} ·{" "}
            {exposurePreset.shutter}. {exposurePreset.note}
          </p>
          <Tip className="mt-2">{EXPOSURE_HONEST_NOTE}</Tip>

          <SectionTitle>Subject</SectionTitle>
          <Segmented
            label="Mannequin"
            value={model}
            testIdPrefix="model"
            options={[
              { value: "male", label: "Male" },
              { value: "female", label: "Female" },
            ]}
            onChange={setModel}
          />
          <p className="mt-3 text-2xs text-ink-400">
            No photo export here: a picture of the scene, if added, will be
            called a scene capture, not a photograph.
          </p>
        </aside>
      </div>
    </main>
  );
}
