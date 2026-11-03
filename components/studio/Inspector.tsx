"use client";

import { useState } from "react";
import { Copy, Gauge, Trash2 } from "lucide-react";
import { figureLabel } from "@/lib/studio/figures";
import { useSelectNewFigure } from "./useSelectNewFigure";
import { CUSTOM_NOTE, PRESETS } from "@/lib/lighting";
import type {
  BenchmarkResult,
  CameraView,
  Selection,
} from "@/lib/engine/StudioEngine";
import {
  BACKDROP_PRESETS,
  KIND_LABELS,
  MATERIAL_PRESETS,
  focalToVerticalFov,
} from "@/lib/studio/presets";
import {
  LIMITS,
  type Figure,
  type LightPatch,
  type SceneDoc,
  type StudioLight,
} from "@/lib/studio/schema";
import type { Studio } from "./useStudio";
import { PoseInspector, isPoseSelection } from "./PoseInspector";
import type { ViewportHandle } from "./StudioViewport";
import {
  Button,
  ColorField,
  IconButton,
  PanelHeader,
  SectionTitle,
  Segmented,
  Slider,
  Toggle,
  cx,
  Tip,
} from "./ui";

type Props = {
  studio: Studio;
  /** The figure the mannequin and pose controls act on. */
  figure: Figure;
  selection: Selection;
  onSelect: (s: Selection, figure?: string) => void;
  viewport: React.RefObject<ViewportHandle | null>;
  view: CameraView;
  onView: (v: CameraView) => void;
  showHandles: boolean;
  onShowHandles: (v: boolean) => void;
};

export function Inspector(props: Props) {
  const { studio, selection } = props;
  const light = studio.scene.lights.find((l) => l.id === selection);
  return (
    <div className="flex min-h-full flex-col" data-testid="inspector">
      {light ? (
        <LightInspector light={light} {...props} />
      ) : isPoseSelection(selection) ? (
        <PoseInspector {...props} />
      ) : selection === "model" ? (
        <ModelInspector {...props} />
      ) : selection === "camera" ? (
        <CameraInspector {...props} />
      ) : selection === "backdrop" ? (
        <BackdropInspector {...props} />
      ) : (
        <SceneInspector {...props} />
      )}
    </div>
  );
}

export function presetNote(scene: SceneDoc): { title: string; note: string } {
  const p = PRESETS.find((x) => x.id === scene.preset);
  return p
    ? { title: `${p.name} — what to watch`, note: p.note }
    : { title: "Custom setup", note: CUSTOM_NOTE };
}

function LightInspector({
  light,
  studio,
  onSelect,
}: Props & { light: StudioLight }) {
  const { dispatch, seal, scene } = studio;
  const set = (patch: LightPatch) =>
    dispatch({ type: "updateLight", id: light.id, patch });
  const canShadow = light.kind !== "area";
  return (
    <>
      <PanelHeader title={`${light.label}`}>
        <IconButton
          icon={Copy}
          size="sm"
          label="Duplicate light"
          shortcut="Ctrl+D"
          disabled={scene.lights.length >= LIMITS.maxLights}
          onClick={() => dispatch({ type: "duplicateLight", id: light.id })}
        />
        <IconButton
          icon={Trash2}
          size="sm"
          label="Delete light"
          shortcut="Del"
          disabled={scene.lights.length <= 1}
          onClick={() => {
            dispatch({ type: "removeLight", id: light.id });
            onSelect(null);
          }}
        />
      </PanelHeader>
      <div className="px-3 py-3">
        <div className="mb-2 flex items-center gap-2 text-2xs text-ink-400">
          <span className="rounded bg-ink-750 px-1.5 py-0.5 font-medium text-ink-200">
            {KIND_LABELS[light.kind]}
          </span>
          <span>{kindHint(light.kind)}</span>
        </div>
        <label className="block py-1.5">
          <span className="mb-1 block text-xs text-ink-300">Name</span>
          <input
            key={light.id}
            defaultValue={light.label}
            maxLength={32}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== light.label) set({ label: v });
              else e.target.value = light.label;
            }}
            onKeyDown={(e) =>
              e.key === "Enter" && (e.target as HTMLInputElement).blur()
            }
            className="h-8 w-full rounded-md border border-ink-700 bg-ink-850 px-2 text-sm text-ink-100"
          />
        </label>
        <Toggle
          label="Light on"
          checked={light.on}
          onChange={(on) => set({ on })}
          testId="light-on"
        />

        <SectionTitle>Position</SectionTitle>
        <Slider
          label="Direction (azimuth)"
          value={light.azimuth}
          min={0}
          max={360}
          step={1}
          unit="°"
          onChange={(azimuth) => set({ azimuth: azimuth % 360 })}
          onCommitEnd={seal}
          hint="0° front · 90° subject's left · 180° behind"
          testId="light-azimuth"
        />
        <Slider
          label="Height (elevation)"
          value={light.elevation}
          min={LIMITS.elevation[0]}
          max={LIMITS.elevation[1]}
          step={1}
          unit="°"
          onChange={(elevation) => set({ elevation })}
          onCommitEnd={seal}
          testId="light-elevation"
        />
        <Slider
          label="Distance"
          value={light.distance}
          min={LIMITS.distance[0]}
          max={LIMITS.distance[1]}
          step={0.1}
          unit=" m"
          onChange={(distance) => set({ distance })}
          onCommitEnd={seal}
          hint={
            light.kind === "directional"
              ? "Directional light is the sun: distance moves the handle, not the brightness."
              : "Inverse-square: half the distance, four times the light."
          }
        />

        <SectionTitle>Light</SectionTitle>
        <Slider
          label="Intensity"
          value={light.intensity}
          min={0}
          max={4}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(intensity) => set({ intensity })}
          onCommitEnd={seal}
          testId="light-intensity"
        />
        <Slider
          label="Colour temperature"
          value={light.temperature}
          min={LIMITS.temperature[0]}
          max={LIMITS.temperature[1]}
          step={100}
          unit="K"
          onChange={(temperature) => set({ temperature })}
          onCommitEnd={seal}
          hint={temperatureHint(light.temperature)}
        />
        {light.kind === "spot" && (
          <Slider
            label="Cone angle"
            value={light.spotAngle}
            min={LIMITS.spotAngle[0]}
            max={LIMITS.spotAngle[1]}
            step={1}
            unit="°"
            onChange={(spotAngle) => set({ spotAngle })}
            onCommitEnd={seal}
          />
        )}
        {light.kind === "area" && (
          <Slider
            label="Softbox size"
            value={light.size}
            min={LIMITS.size[0]}
            max={LIMITS.size[1]}
            step={0.1}
            unit=" m"
            onChange={(size) => set({ size })}
            onCommitEnd={seal}
            hint="Bigger source, softer light — at the same total output."
          />
        )}

        <SectionTitle>Shadows</SectionTitle>
        <Toggle
          label="Cast shadows"
          checked={canShadow && light.shadows}
          disabled={!canShadow}
          onChange={(shadows) => set({ shadows })}
          testId="light-shadows"
          hint={
            !canShadow
              ? "Softbox lights don't cast real-time shadows in WebGL."
              : light.kind === "point"
                ? "Point shadows render six views — the most expensive kind."
                : undefined
          }
        />
        <Slider
          label={
            light.kind === "spot"
              ? "Softness (shadow + beam edge)"
              : "Shadow softness"
          }
          value={light.softness}
          min={0}
          max={10}
          step={1}
          disabled={!canShadow || (!light.shadows && light.kind !== "spot")}
          onChange={(softness) => set({ softness })}
          onCommitEnd={seal}
        />
      </div>
    </>
  );
}

function ModelInspector({ studio, figure, onSelect }: Props) {
  const { scene, dispatch, seal } = studio;
  const m = scene.material;
  const many = scene.figures.length > 1;
  const expectNewFigure = useSelectNewFigure(scene.figures, onSelect);
  const place = (patch: {
    x?: number;
    y?: number;
    z?: number;
    rotation?: number;
  }) => dispatch({ type: "updateFigure", figure: figure.id, patch });
  return (
    <>
      <PanelHeader title={many ? figureLabel(scene, figure.id) : "Mannequin"}>
        <IconButton
          icon={Copy}
          size="sm"
          label="Duplicate figure"
          disabled={scene.figures.length >= LIMITS.maxFigures}
          data-testid="figure-duplicate"
          onClick={() => {
            expectNewFigure();
            dispatch({ type: "duplicateFigure", figure: figure.id });
          }}
        />
        <IconButton
          icon={Trash2}
          size="sm"
          label="Remove figure"
          disabled={!many}
          data-testid="figure-remove"
          onClick={() => {
            dispatch({ type: "removeFigure", figure: figure.id });
            onSelect(null);
          }}
        />
      </PanelHeader>
      <div className="px-3 py-3">
        <Segmented
          label="Figure"
          value={figure.model}
          testIdPrefix="model"
          options={[
            { value: "male", label: "Male" },
            { value: "female", label: "Female" },
          ]}
          onChange={(model) =>
            dispatch({ type: "setModel", model, figure: figure.id })
          }
        />
        <SectionTitle>Placement</SectionTitle>
        <Slider
          label="Left / right"
          value={figure.x}
          min={LIMITS.figureX[0]}
          max={LIMITS.figureX[1]}
          step={0.05}
          unit=" m"
          testId="figure-x"
          hint="As seen from the front"
          onChange={(x) => place({ x })}
          onCommitEnd={seal}
        />
        <Slider
          label="Forward / back"
          value={figure.z}
          min={LIMITS.figureZ[0]}
          max={LIMITS.figureZ[1]}
          step={0.05}
          unit=" m"
          testId="figure-z"
          hint="Positive comes towards the camera"
          onChange={(z) => place({ z })}
          onCommitEnd={seal}
        />
        <Slider
          label="Up / down"
          value={figure.y}
          min={LIMITS.figureY[0]}
          max={LIMITS.figureY[1]}
          step={0.01}
          unit=" m"
          testId="figure-y"
          hint="Lift or lower the whole figure (jumps, sitting)"
          onChange={(y) => place({ y })}
          onCommitEnd={seal}
        />
        <Slider
          label="Turn"
          value={figure.rotation}
          min={LIMITS.rotation[0]}
          max={LIMITS.rotation[1]}
          step={1}
          unit="°"
          testId="figure-rotation"
          hint="0° faces the camera"
          onChange={(rotation) => place({ rotation })}
          onCommitEnd={seal}
        />
        <Tip className="mt-1">
          With this panel open, drag a figure in the viewport to move it across
          the floor.
        </Tip>
        <SectionTitle>
          {many ? "Material (all figures)" : "Material"}
        </SectionTitle>
        <div
          className="grid grid-cols-4 gap-1.5 py-1.5"
          role="group"
          aria-label="Material presets"
        >
          {MATERIAL_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              title={p.name}
              aria-label={p.name}
              aria-pressed={m.preset === p.id}
              data-testid={`material-${p.id}`}
              onClick={() =>
                dispatch({ type: "applyMaterialPreset", presetId: p.id })
              }
              className={cx(
                "aspect-square rounded-md border-2 transition-colors",
                m.preset === p.id
                  ? "border-accent"
                  : "border-transparent hover:border-ink-500",
              )}
              style={{ background: swatch(p.color, p.roughness, p.metalness) }}
            />
          ))}
        </div>
        <p className="text-2xs text-ink-400">
          {MATERIAL_PRESETS.find((p) => p.id === m.preset)?.name ??
            "Custom material"}
        </p>
        <ColorField
          label="Base colour"
          value={m.color}
          onChange={(color) =>
            dispatch({ type: "updateMaterial", patch: { color } })
          }
        />
        <Slider
          label="Roughness"
          value={m.roughness}
          min={0}
          max={1}
          step={0.01}
          format={(v) => v.toFixed(2)}
          onChange={(roughness) =>
            dispatch({ type: "updateMaterial", patch: { roughness } })
          }
          onCommitEnd={seal}
          hint="Low = glossy, tight highlights. High = matte, broad falloff."
        />
        <Slider
          label="Metalness"
          value={m.metalness}
          min={0}
          max={1}
          step={0.01}
          format={(v) => v.toFixed(2)}
          onChange={(metalness) =>
            dispatch({ type: "updateMaterial", patch: { metalness } })
          }
          onCommitEnd={seal}
        />
      </div>
    </>
  );
}

function CameraInspector({
  studio,
  view,
  onView,
  showHandles,
  onShowHandles,
}: Props) {
  const { scene, dispatch, seal } = studio;
  const c = scene.camera;
  return (
    <>
      <PanelHeader title="Camera" />
      <div className="px-3 py-3">
        <Segmented
          label="Framing"
          value={view}
          testIdPrefix="view"
          options={[
            { value: "full", label: "Full body" },
            { value: "face", label: "Face" },
            { value: "studio", label: "Studio" },
          ]}
          onChange={onView}
        />
        <Slider
          label="Focal length"
          value={c.focalMm}
          min={LIMITS.focalMm[0]}
          max={LIMITS.focalMm[1]}
          step={1}
          format={(v) => `${v} mm · ${focalToVerticalFov(v).toFixed(0)}°`}
          onChange={(focalMm) =>
            dispatch({ type: "updateCamera", patch: { focalMm } })
          }
          onCommitEnd={seal}
          hint="Angle of view on a full-frame camera. Longer lenses flatten the face."
        />
        <SectionTitle>Exposure</SectionTitle>
        <Slider
          label="Exposure compensation"
          value={c.exposureEv}
          min={LIMITS.exposureEv[0]}
          max={LIMITS.exposureEv[1]}
          step={0.1}
          format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} EV`}
          testId="camera-exposure"
          onChange={(exposureEv) =>
            dispatch({ type: "updateCamera", patch: { exposureEv } })
          }
          onCommitEnd={seal}
          hint="Each stop doubles or halves the rendered brightness."
        />
        <Segmented
          label="Tone mapping"
          value={c.toneMapping}
          options={[
            { value: "aces", label: "Filmic" },
            { value: "agx", label: "AgX" },
            { value: "neutral", label: "Neutral" },
          ]}
          onChange={(toneMapping) =>
            dispatch({ type: "updateCamera", patch: { toneMapping } })
          }
        />
        <SectionTitle>Viewport</SectionTitle>
        <Toggle
          label="Show light handles"
          checked={showHandles}
          onChange={onShowHandles}
        />
      </div>
    </>
  );
}

function BackdropInspector({ studio }: Props) {
  const { scene, dispatch, seal } = studio;
  const b = scene.backdrop;
  return (
    <>
      <PanelHeader title="Backdrop" />
      <div className="px-3 py-3">
        <div
          className="grid grid-cols-3 gap-1.5 py-1.5"
          role="group"
          aria-label="Backdrop presets"
        >
          {BACKDROP_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={b.preset === p.id}
              data-testid={`backdrop-${p.id}`}
              onClick={() =>
                dispatch({ type: "applyBackdropPreset", presetId: p.id })
              }
              className={cx(
                "flex flex-col items-start gap-1 rounded-md border-2 p-1.5 text-left text-2xs transition-colors",
                b.preset === p.id
                  ? "border-accent bg-ink-800"
                  : "border-transparent bg-ink-800 hover:border-ink-500",
              )}
            >
              <span
                aria-hidden
                className="h-6 w-full rounded"
                style={{
                  background:
                    p.style === "cyc"
                      ? `linear-gradient(${p.color} 55%, ${shade(p.color, 0.7)})`
                      : p.color,
                }}
              />
              <span className="leading-tight text-ink-200">{p.name}</span>
            </button>
          ))}
        </div>
        <Segmented
          label="Style"
          value={b.style}
          options={[
            { value: "catcher", label: "Shadow catcher" },
            { value: "cyc", label: "Seamless sweep" },
          ]}
          onChange={(style) =>
            dispatch({ type: "updateBackdrop", patch: { style } })
          }
        />
        <ColorField
          label="Colour"
          value={b.color}
          onChange={(color) =>
            dispatch({ type: "updateBackdrop", patch: { color } })
          }
        />
        <Slider
          label="Floor shadow opacity"
          value={b.shadowOpacity}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          disabled={b.style === "cyc"}
          hint={
            b.style === "cyc"
              ? "The sweep receives real shadows from the lights."
              : undefined
          }
          onChange={(shadowOpacity) =>
            dispatch({ type: "updateBackdrop", patch: { shadowOpacity } })
          }
          onCommitEnd={seal}
        />
      </div>
    </>
  );
}

function SceneInspector({ studio, viewport }: Props) {
  const { scene, dispatch } = studio;
  const { title, note } = presetNote(scene);
  const [bench, setBench] = useState<BenchmarkResult | "running" | null>(null);
  const [benchError, setBenchError] = useState<string | null>(null);
  const casters = scene.lights.filter(
    (l) => l.on && l.shadows && l.kind !== "area",
  ).length;
  return (
    <>
      <PanelHeader title="Scene" />
      <div className="px-3 py-3">
        <section aria-live="polite" className="rounded-lg bg-ink-800 p-3">
          <h3
            className="text-xs font-semibold text-ink-100"
            data-testid="preset-note-title"
          >
            {title}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-300">{note}</p>
        </section>
        <Tip className="mt-3">
          Select a light, the mannequin, the camera or the backdrop — in the
          scene list or by clicking it in the viewport — to edit it here.
        </Tip>

        <SectionTitle>Shadows</SectionTitle>
        <Segmented
          label="Shadow map quality"
          value={scene.shadows.quality}
          testIdPrefix="shadow-quality"
          options={[
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
          ]}
          onChange={(quality) =>
            dispatch({ type: "updateShadows", patch: { quality } })
          }
        />
        <Tip className="">
          {casters} light{casters === 1 ? "" : "s"} casting shadows. Each one
          re-renders the figure; on phones keep it to one or two at Medium.
        </Tip>

        <SectionTitle>Performance</SectionTitle>
        <Button
          size="sm"
          icon={Gauge}
          disabled={bench === "running"}
          data-testid="run-benchmark"
          onClick={async () => {
            setBench("running");
            setBenchError(null);
            try {
              const r = await viewport.current!.runBenchmark(4000);
              console.info("[benchmark]", r);
              setBench(r);
            } catch (e) {
              setBench(null);
              setBenchError(
                e instanceof Error ? e.message : "Benchmark failed",
              );
            }
          }}
        >
          {bench === "running"
            ? "Measuring (4 s orbit)…"
            : "Run 4-second benchmark"}
        </Button>
        {benchError && (
          <p className="mt-2 text-2xs text-danger">{benchError}</p>
        )}
        {bench && bench !== "running" && (
          <dl
            className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-ink-800 p-2.5 text-2xs"
            data-testid="benchmark-result"
          >
            <dt className="text-ink-400">Average</dt>
            <dd className="tabular-nums text-ink-100">{bench.avgFps} fps</dd>
            <dt className="text-ink-400">95th pct frame</dt>
            <dd className="tabular-nums text-ink-100">{bench.p95FrameMs} ms</dd>
            <dt className="text-ink-400">Frames</dt>
            <dd className="tabular-nums text-ink-100">{bench.frames}</dd>
            <dt className="text-ink-400">Pixel ratio</dt>
            <dd className="tabular-nums text-ink-100">{bench.pixelRatio}×</dd>
            <dt className="text-ink-400">Draw calls</dt>
            <dd className="tabular-nums text-ink-100">{bench.drawCalls}</dd>
            <dt className="text-ink-400">Triangles</dt>
            <dd className="tabular-nums text-ink-100">
              {bench.triangles.toLocaleString()}
            </dd>
            <dt
              className="col-span-2 mt-1 truncate text-ink-500"
              title={bench.renderer}
            >
              {bench.renderer}
            </dt>
          </dl>
        )}
        <Tip className="mt-2">
          Frame rate is capped by the display refresh rate. The viewport renders
          only when something changes, and drops to 1× resolution while moving
          if frames get slow.
        </Tip>
      </div>
    </>
  );
}

function kindHint(kind: StudioLight["kind"]): string {
  switch (kind) {
    case "directional":
      return "Parallel rays, like the sun.";
    case "spot":
      return "A cone, like a fresnel or snoot.";
    case "point":
      return "Bare bulb in every direction.";
    case "area":
      return "Rectangular source, like a softbox.";
  }
}

function temperatureHint(k: number): string {
  if (k < 2500) return "Candlelight";
  if (k < 3400) return "Tungsten / household bulb";
  if (k < 4500) return "Warm white";
  if (k < 6000) return "Daylight / flash";
  return "Overcast sky / shade";
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) =>
    Math.round(((n >> s) & 255) * f)
      .toString(16)
      .padStart(2, "0");
  return `#${c(16)}${c(8)}${c(0)}`;
}

function lighten(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => {
    const v = (n >> s) & 255;
    return Math.round(v + (255 - v) * t)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${c(16)}${c(8)}${c(0)}`;
}

/** CSS sphere preview: tighter, brighter highlight for glossy/metal. */
function swatch(color: string, roughness: number, metalness: number): string {
  const hi =
    metalness > 0.5 ? "#ffffff" : lighten(color, 0.5 - roughness * 0.35);
  const spot = Math.round(20 + roughness * 40);
  return `radial-gradient(circle at 35% 30%, ${hi} 0%, ${color} ${spot}%, ${shade(color, 0.35)} 100%)`;
}
