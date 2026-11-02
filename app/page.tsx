"use client";

import { useEffect, useRef, useState } from "react";
import { LightingScene, type MannequinModel } from "@/components/LightingScene";
import {
  CUSTOM_NOTE,
  PRESETS,
  cloneLights,
  type LightState,
} from "@/lib/lighting";
import { decodeSetup, encodeSetup } from "@/lib/share";

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block py-1">
      <span className="flex justify-between text-sm text-zinc-300">
        <span>{label}</span>
        <span className="text-zinc-400">
          {value}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-zinc-100"
      />
    </label>
  );
}

export default function Home() {
  const [activePreset, setActivePreset] = useState<string>("three-point");
  const [lights, setLights] = useState<LightState[]>(() =>
    cloneLights(PRESETS[0].lights),
  );
  const [openLight, setOpenLight] = useState<string>("key");
  const [hydrated, setHydrated] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  // Face close-up view: drives LightingScene's OrbitControls target +
  // camera only; lights/presets/share are untouched by view changes.
  const [view, setView] = useState<"face" | "full">("full");
  const [viewNonce, setViewNonce] = useState(0);
  // Mannequin choice: male (from-scratch Meshy) or female (Meshy).
  // Lights/preset/share are untouched by switching; the choice is
  // NOT encoded in share links (lights only, as in M3).
  const [model, setModel] = useState<MannequinModel>("male");
  function setViewMode(v: "face" | "full") {
    setView(v);
    setViewNonce((n) => n + 1);
  }
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // M3: on first load, restore a shared setup from ?s= if it is valid.
  // Invalid params fall back to the default Three-point setup.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("s");
    const shared = decodeSetup(param);
    if (shared) {
      setActivePreset(shared.preset);
      setLights(shared.lights);
    }
    setHydrated(true);
  }, []);

  // M3: keep the URL in sync with the current setup, without reloading.
  useEffect(() => {
    if (!hydrated) return;
    const param = encodeSetup(activePreset, lights);
    const url = new URL(window.location.href);
    if (url.searchParams.get("s") !== param) {
      url.searchParams.set("s", param);
      window.history.replaceState(null, "", url.toString());
    }
  }, [hydrated, activePreset, lights]);

  async function copyLink() {
    // Build the URL from current state directly, so the copied link is
    // always the setup on screen even if the sync effect has not run yet.
    const url = new URL(window.location.href);
    url.searchParams.set("s", encodeSetup(activePreset, lights));
    window.history.replaceState(null, "", url.toString());
    const link = url.toString();
    let ok = false;
    try {
      await navigator.clipboard.writeText(link);
      ok = true;
    } catch {
      // Fallback for browsers that block the async clipboard API.
      try {
        const ta = document.createElement("textarea");
        ta.value = link;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    setCopyState(ok ? "copied" : "failed");
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyState("idle"), 2500);
  }

  function resetSetup() {
    setActivePreset("three-point");
    setLights(cloneLights(PRESETS[0].lights));
    const url = new URL(window.location.href);
    url.searchParams.delete("s");
    window.history.replaceState(null, "", url.toString());
  }

  const preset = PRESETS.find((p) => p.id === activePreset);
  const note = preset ? preset.note : CUSTOM_NOTE;

  function applyPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setActivePreset(id);
    setLights(cloneLights(p.lights));
  }

  function updateLight(id: string, patch: Partial<LightState>) {
    setActivePreset("custom");
    setLights((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    );
  }

  return (
    <main className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100">
      <header className="shrink-0 px-4 pb-3 pt-4 sm:px-6">
        <h1 className="text-xl font-semibold leading-tight sm:text-2xl">
          Lighting Studio — Pilot
        </h1>
        <p className="mt-1 text-sm leading-snug text-zinc-400">
          M3: share any setup as a link, plus mobile polish.
        </p>
        <p className="mt-2 text-sm">
          <a
            href="/photography"
            className="font-medium text-zinc-300 underline"
          >
            Photography — Camera Basics →
          </a>
        </p>
        <p className="mt-2 inline-block rounded-full bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200">
          Drag to rotate · Pinch to zoom
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={copyLink}
            data-testid="copy-link"
            className="min-h-11 rounded-full bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950"
          >
            {copyState === "copied"
              ? "Copied"
              : copyState === "failed"
                ? "Copy failed — copy the URL from the address bar"
                : "Copy link"}
          </button>
          <button
            type="button"
            onClick={resetSetup}
            data-testid="reset-setup"
            className="min-h-11 rounded-full bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200"
          >
            Reset
          </button>
        </div>
      </header>

      {/* Preset chips above the canvas, wrapping — no horizontal scroll. */}
      <div
        className="flex flex-wrap gap-2 px-4 pb-3 sm:px-6"
        role="group"
        aria-label="Lighting presets"
      >
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            data-testid={`preset-${p.id}`}
            onClick={() => applyPreset(p.id)}
            aria-pressed={activePreset === p.id}
            className={`min-h-11 rounded-full px-4 py-2 text-sm font-medium ${
              activePreset === p.id
                ? "bg-zinc-100 text-zinc-950"
                : "bg-zinc-800 text-zinc-200"
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* View buttons: face close-up vs full body, phone-friendly,
          no horizontal scroll. Camera only — lights/share untouched. */}
      <div
        className="flex flex-wrap gap-2 px-4 pb-3 sm:px-6"
        role="group"
        aria-label="Camera view"
      >
        <button
          type="button"
          data-testid="view-face"
          onClick={() => setViewMode("face")}
          aria-pressed={view === "face"}
          className={`min-h-11 rounded-full px-4 py-2 text-sm font-medium ${
            view === "face"
              ? "bg-zinc-100 text-zinc-950"
              : "bg-zinc-800 text-zinc-200"
          }`}
        >
          Face close-up
        </button>
        <button
          type="button"
          data-testid="view-full"
          onClick={() => setViewMode("full")}
          aria-pressed={view === "full"}
          className={`min-h-11 rounded-full px-4 py-2 text-sm font-medium ${
            view === "full"
              ? "bg-zinc-100 text-zinc-950"
              : "bg-zinc-800 text-zinc-200"
          }`}
        >
          Full body
        </button>
      </div>

      {/* Mannequin switcher: male / female, phone-friendly,
          no horizontal scroll. Model only — lights/share untouched. */}
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

      {/* M3: canvas sized to leave the controls reachable on a phone
          screen, instead of pushing them far below the fold. */}
      <div className="h-[42dvh] shrink-0 px-3 pb-3 sm:px-6 sm:pb-4">
        <LightingScene
          lights={lights}
          view={view}
          viewNonce={viewNonce}
          model={model}
        />
      </div>

      {/* Active preset note, under the canvas. Fixed minimum height so
          switching presets does not jump the controls below. */}
      <section
        className="min-h-[11rem] px-4 pb-4 sm:min-h-[9rem] sm:px-6"
        aria-live="polite"
      >
        <h2 className="text-sm font-semibold text-zinc-300">
          {preset ? `${preset.name} — what to watch` : "Custom setup"}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-zinc-400">{note}</p>
      </section>

      {/* Bottom controls: per-light collapsible sections. */}
      <section className="px-4 pb-6 sm:px-6" aria-label="Light controls">
        {lights.map((l) => {
          const open = openLight === l.id;
          return (
            <div
              key={l.id}
              className="mb-3 overflow-hidden rounded-xl bg-zinc-900"
            >
              <button
                type="button"
                onClick={() => setOpenLight(open ? "" : l.id)}
                aria-expanded={open}
                className="flex min-h-12 w-full items-center justify-between px-4 py-3 text-left"
              >
                <span className="font-medium">
                  {l.label} light{" "}
                  <span className="text-sm text-zinc-400">
                    {l.on ? "on" : "off"} · {l.temperature}K
                  </span>
                </span>
                <span className="text-zinc-400">{open ? "−" : "+"}</span>
              </button>
              {open && (
                <div className="border-t border-zinc-800 px-4 py-3">
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={l.on}
                      onChange={(e) =>
                        updateLight(l.id, { on: e.target.checked })
                      }
                      className="h-5 w-5 accent-zinc-100"
                    />
                    Light on
                  </label>
                  <Slider
                    label="Direction (azimuth)"
                    value={l.azimuth}
                    min={0}
                    max={360}
                    step={5}
                    unit="°"
                    onChange={(v) => updateLight(l.id, { azimuth: v })}
                  />
                  <Slider
                    label="Height (elevation)"
                    value={l.elevation}
                    min={0}
                    max={80}
                    step={5}
                    unit="°"
                    onChange={(v) => updateLight(l.id, { elevation: v })}
                  />
                  <Slider
                    label="Distance"
                    value={l.distance}
                    min={2}
                    max={7}
                    step={0.5}
                    unit=""
                    onChange={(v) => updateLight(l.id, { distance: v })}
                  />
                  <Slider
                    label="Intensity"
                    value={l.intensity}
                    min={0}
                    max={4}
                    step={0.1}
                    unit=""
                    onChange={(v) => updateLight(l.id, { intensity: v })}
                  />
                  <Slider
                    label="Colour temperature"
                    value={l.temperature}
                    min={2700}
                    max={6500}
                    step={100}
                    unit="K"
                    onChange={(v) => updateLight(l.id, { temperature: v })}
                  />
                  <Slider
                    label="Shadow softness"
                    value={l.softness}
                    min={0}
                    max={10}
                    step={1}
                    unit=""
                    onChange={(v) => updateLight(l.id, { softness: v })}
                  />
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={l.shadows}
                      onChange={(e) =>
                        updateLight(l.id, { shadows: e.target.checked })
                      }
                      className="h-5 w-5 accent-zinc-100"
                    />
                    Cast shadows {l.id !== "key" ? "(off by default)" : ""}
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </main>
  );
}
