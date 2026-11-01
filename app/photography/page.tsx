"use client";

import { useState } from "react";
import Link from "next/link";
import {
  LightingScene,
  type MannequinModel,
} from "@/components/LightingScene";
import { PRESETS, cloneLights } from "@/lib/lighting";
import {
  EXPOSURES,
  EXPOSURE_HONEST_NOTE,
  FRAMINGS,
  focalToFov,
  type FramingId,
} from "@/lib/photography";

/** Photography M1: camera, composition, and exposure taught on the
 * existing Lighting Studio scene. No new GLBs, no second scene —
 * the same scene component, the same models, the same lights.
 * Exposure here brightens/darkens the preview; it is not a real
 * camera sensor simulation (see the honest note on the page). No
 * photo export is claimed in M1. */

export default function Photography() {
  const [framing, setFraming] = useState<FramingId>("portrait");
  const [focalMm, setFocalMm] = useState(50);
  const [exposureId, setExposureId] = useState("daylight");
  const [showThirds, setShowThirds] = useState(true);
  const [model, setModel] = useState<MannequinModel>("male");
  const [viewNonce, setViewNonce] = useState(0);

  const framingPreset =
    FRAMINGS.find((f) => f.id === framing) ?? FRAMINGS[1];
  const exposurePreset =
    EXPOSURES.find((e) => e.id === exposureId) ?? EXPOSURES[0];
  // Lighting stays at the default Three-point setup for M1; the
  // camera is the lesson here, not a second light editor.
  const [lights] = useState(() => cloneLights(PRESETS[0].lights));

  function applyFraming(id: FramingId) {
    const f = FRAMINGS.find((x) => x.id === id);
    if (!f) return;
    setFraming(id);
    setFocalMm(f.focalMm);
    // Bump the view nonce so LightingScene re-aims even when the
    // view itself (face/full) does not change between framings.
    setViewNonce((n) => n + 1);
  }

  return (
    <main className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100">
      <header className="shrink-0 px-4 pb-3 pt-4 sm:px-6">
        <Link
          href="/"
          className="text-sm font-medium text-zinc-300 underline"
        >
          ← Lighting Studio
        </Link>
        <h1 className="mt-2 text-xl font-semibold leading-tight sm:text-2xl">
          Photography — Camera Basics
        </h1>
        <p className="mt-1 text-sm leading-snug text-zinc-400">
          M1: the same mannequin, the same lights — now the camera
          is the lesson. Framing, focal length, composition, and
          exposure.
        </p>
        <p className="mt-2 inline-block rounded-full bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200">
          Drag to rotate · Pinch to zoom
        </p>
      </header>

      <div
        className="flex flex-wrap gap-2 px-4 pb-3 sm:px-6"
        role="group"
        aria-label="Framing"
      >
        {FRAMINGS.map((f) => (
          <button
            key={f.id}
            type="button"
            data-testid={`framing-${f.id}`}
            onClick={() => applyFraming(f.id)}
            aria-pressed={framing === f.id}
            className={`min-h-11 rounded-full px-4 py-2 text-sm font-medium ${
              framing === f.id
                ? "bg-zinc-100 text-zinc-950"
                : "bg-zinc-800 text-zinc-200"
            }`}
          >
            {f.name}
          </button>
        ))}
      </div>

      <div
        className="flex flex-wrap gap-2 px-4 pb-3 sm:px-6"
        role="group"
        aria-label="Mannequin"
      >
        <button
          type="button"
          data-testid="model-male"
          onClick={() => setModel("male")}
          aria-pressed={model === "male"}
          className={`min-h-11 rounded-full px-4 py-2 text-sm font-medium ${
            model === "male"
              ? "bg-zinc-100 text-zinc-950"
              : "bg-zinc-800 text-zinc-200"
          }`}
        >
          Male mannequin
        </button>
        <button
          type="button"
          data-testid="model-female"
          onClick={() => setModel("female")}
          aria-pressed={model === "female"}
          className={`min-h-11 rounded-full px-4 py-2 text-sm font-medium ${
            model === "female"
              ? "bg-zinc-100 text-zinc-950"
              : "bg-zinc-800 text-zinc-200"
          }`}
        >
          Female mannequin
        </button>
      </div>

      <div className="relative h-[42dvh] shrink-0 px-3 pb-3 sm:px-6 sm:pb-4">
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
            className="pointer-events-none absolute inset-x-3 bottom-3 top-0 sm:inset-x-6 sm:bottom-4"
          >
            <div className="absolute inset-y-0 left-1/3 w-px bg-white/40" />
            <div className="absolute inset-y-0 left-2/3 w-px bg-white/40" />
            <div className="absolute inset-x-0 top-1/3 h-px bg-white/40" />
            <div className="absolute inset-x-0 top-2/3 h-px bg-white/40" />
          </div>
        )}
      </div>

      <section
        className="min-h-[9rem] px-4 pb-4 sm:px-6"
        aria-live="polite"
      >
        <h2 className="text-sm font-semibold text-zinc-300">
          {framingPreset.name} — what to watch
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-zinc-400">
          {framingPreset.note}
        </p>
      </section>

      <section className="px-4 pb-6 sm:px-6" aria-label="Camera controls">
        <label className="block py-1">
          <span className="flex justify-between text-sm text-zinc-300">
            <span>Focal length</span>
            <span className="text-zinc-400">
              {focalMm} mm · {focalToFov(focalMm).toFixed(0)}° view
            </span>
          </span>
          <input
            type="range"
            min={24}
            max={85}
            step={1}
            value={focalMm}
            onChange={(e) => setFocalMm(Number(e.target.value))}
            className="mt-1 w-full accent-zinc-100"
          />
          <span className="text-sm text-zinc-400">
            Shorter (24 mm) sees wider; longer (85 mm) sees narrower
            and flattens a face gently. This changes the angle of
            view only — it does not simulate a real lens, depth of
            field, or distortion.
          </span>
        </label>

        <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={showThirds}
            onChange={(e) => setShowThirds(e.target.checked)}
            className="h-5 w-5 accent-zinc-100"
          />
          Rule-of-thirds guide
        </label>
        <p className="mt-1 text-sm leading-relaxed text-zinc-400">
          Put the eyes or the main subject near where the lines
          cross, not dead centre — unless centre is the point.
          The guide is an overlay on the preview, not part of any
          picture.
        </p>

        <h2 className="mt-5 text-sm font-semibold text-zinc-300">
          Exposure — aperture / ISO / shutter
        </h2>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Exposure">
          {EXPOSURES.map((e) => (
            <button
              key={e.id}
              type="button"
              data-testid={`exposure-${e.id}`}
              onClick={() => setExposureId(e.id)}
              aria-pressed={exposureId === e.id}
              className={`min-h-11 rounded-full px-4 py-2 text-sm font-medium ${
                exposureId === e.id
                  ? "bg-zinc-100 text-zinc-950"
                  : "bg-zinc-800 text-zinc-200"
              }`}
            >
              {e.name}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          {exposurePreset.aperture} · ISO {exposurePreset.iso} ·{" "}
          {exposurePreset.shutter}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-zinc-400">
          {exposurePreset.note}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-zinc-500">
          {EXPOSURE_HONEST_NOTE}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-zinc-500">
          M1 has no photo export. A scene capture, if added later,
          will be labelled as a scene capture, not a photograph.
        </p>
      </section>
    </main>
  );
}
