"use client";

/** Left-hand panels: scene hierarchy, lighting presets, history. */

import { useEffect, useRef, useState } from "react";
import {
  Box,
  Camera,
  Circle,
  Diamond,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Plus,
  Redo2,
  Square,
  Undo2,
  User,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { PRESETS, kelvinToRgb } from "@/lib/lighting";
import type { Selection } from "@/lib/engine/StudioEngine";
import {
  BACKDROP_PRESETS,
  KIND_LABELS,
  MATERIAL_PRESETS,
} from "@/lib/studio/presets";
import {
  LIGHT_KINDS,
  LIMITS,
  type LightKind,
  type StudioLight,
} from "@/lib/studio/schema";
import type { Studio } from "./useStudio";
import { IconButton, PanelHeader, cx } from "./ui";

export const KIND_ICONS: Record<LightKind, LucideIcon> = {
  directional: Diamond,
  spot: Zap,
  point: Circle,
  area: Square,
};

function kelvinCss(k: number): string {
  const [r, g, b] = kelvinToRgb(k);
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

function Row({
  icon: Icon,
  label,
  detail,
  selected,
  onSelect,
  children,
  testId,
  dim,
  swatch,
}: {
  icon: LucideIcon;
  label: string;
  detail?: string;
  selected: boolean;
  onSelect: () => void;
  children?: React.ReactNode;
  testId?: string;
  dim?: boolean;
  swatch?: string;
}) {
  return (
    <li
      className={cx(
        "group flex items-center rounded-md pr-1",
        selected ? "bg-accent-soft" : "hover:bg-ink-800",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        data-testid={testId}
        className="flex min-h-9 min-w-0 flex-1 items-center gap-2 px-2 text-left"
      >
        <Icon
          aria-hidden
          className={cx(
            "h-4 w-4 shrink-0",
            selected ? "text-accent" : "text-ink-400",
          )}
          style={swatch ? { color: swatch } : undefined}
        />
        <span
          className={cx(
            "truncate text-sm",
            dim ? "text-ink-500" : selected ? "text-ink-100" : "text-ink-200",
          )}
        >
          {label}
        </span>
        {detail && (
          <span
            className={cx(
              "ml-auto shrink-0 pl-2 text-2xs tabular-nums",
              // ink-400 fails AA on the amber selection tint.
              selected ? "text-ink-200" : "text-ink-400",
            )}
          >
            {detail}
          </span>
        )}
      </button>
      {children}
    </li>
  );
}

export function ScenePanel({
  studio,
  selection,
  onSelect,
}: {
  studio: Studio;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const { scene, dispatch } = studio;
  const [adding, setAdding] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const full = scene.lights.length >= LIMITS.maxLights;

  useEffect(() => {
    if (!adding) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setAdding(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [adding]);

  // After adding a light, select it once the new scene arrives.
  const pendingSelect = useRef<Set<string> | null>(null);
  function add(kind: LightKind) {
    setAdding(false);
    pendingSelect.current = new Set(scene.lights.map((l) => l.id));
    dispatch({ type: "addLight", kind });
  }
  useEffect(() => {
    const before = pendingSelect.current;
    if (!before) return;
    pendingSelect.current = null;
    const added = scene.lights.find((l) => !before.has(l.id));
    if (added) onSelect(added.id);
  }, [scene.lights, onSelect]);

  const material =
    MATERIAL_PRESETS.find((m) => m.id === scene.material.preset)?.name ??
    "Custom";
  const backdrop =
    BACKDROP_PRESETS.find((b) => b.id === scene.backdrop.preset)?.name ??
    "Custom";

  return (
    <div data-testid="scene-panel">
      <PanelHeader title="Scene" />
      <div className="px-2 py-2">
        <ul className="space-y-0.5" aria-label="Scene objects">
          <Row
            icon={Camera}
            label="Camera"
            detail={`${scene.camera.focalMm} mm`}
            selected={selection === "camera"}
            onSelect={() => onSelect("camera")}
            testId="node-camera"
          />
        </ul>
        <div className="mb-1 mt-3 flex items-center justify-between px-2">
          <h3 className="text-2xs font-semibold uppercase tracking-wider text-ink-400">
            Lights{" "}
            <span className="font-normal normal-case tracking-normal">
              ({scene.lights.length}/{LIMITS.maxLights})
            </span>
          </h3>
          <div className="relative" ref={menuRef}>
            <IconButton
              icon={Plus}
              size="sm"
              label="Add light"
              disabled={full}
              aria-expanded={adding}
              aria-haspopup="menu"
              data-testid="add-light"
              onClick={() => setAdding((v) => !v)}
            />
            {adding && (
              <div
                role="menu"
                className="absolute right-0 top-8 z-20 w-40 rounded-lg border border-ink-700 bg-ink-850 p-1 shadow-xl"
              >
                {LIGHT_KINDS.map((k) => {
                  const Icon = KIND_ICONS[k];
                  return (
                    <button
                      key={k}
                      role="menuitem"
                      type="button"
                      data-testid={`add-light-${k}`}
                      onClick={() => add(k)}
                      className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-sm text-ink-200 hover:bg-ink-750"
                    >
                      <Icon aria-hidden className="h-4 w-4 text-ink-400" />{" "}
                      {KIND_LABELS[k]}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <ul className="space-y-0.5" aria-label="Lights">
          {scene.lights.map((l: StudioLight) => (
            <Row
              key={l.id}
              icon={KIND_ICONS[l.kind]}
              label={l.label}
              dim={!l.on}
              detail={l.on ? `${l.temperature}K` : "off"}
              swatch={l.on ? kelvinCss(l.temperature) : undefined}
              selected={selection === l.id}
              onSelect={() => onSelect(l.id)}
              testId={`node-light-${l.id}`}
            >
              <IconButton
                icon={l.on ? Eye : EyeOff}
                size="sm"
                label={`Turn ${l.label} ${l.on ? "off" : "on"}`}
                data-testid={`toggle-light-${l.id}`}
                className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() =>
                  dispatch({
                    type: "updateLight",
                    id: l.id,
                    patch: { on: !l.on },
                  })
                }
              />
            </Row>
          ))}
        </ul>
        <ul className="mt-3 space-y-0.5" aria-label="Subject and set">
          <Row
            icon={User}
            label="Mannequin"
            detail={`${scene.model === "male" ? "Male" : "Female"} · ${material}`}
            selected={selection === "model"}
            onSelect={() => onSelect("model")}
            testId="node-model"
          />
          <Row
            icon={ImageIcon}
            label="Backdrop"
            detail={backdrop}
            selected={selection === "backdrop"}
            onSelect={() => onSelect("backdrop")}
            testId="node-backdrop"
          />
          <Row
            icon={Box}
            label="Scene settings"
            selected={selection === null}
            onSelect={() => onSelect(null)}
            testId="node-scene"
          />
        </ul>
      </div>
    </div>
  );
}

const PRESET_BLURBS: Record<string, string> = {
  "three-point": "Key, fill and rim — the studio default",
  rembrandt: "Triangle of light on the shadow cheek",
  split: "Half lit, half in shadow",
  butterfly: "High frontal key, shadow under the nose",
  "low-key": "Dark and moody, no fill",
  "high-key": "Bright, airy, faint shadows",
};

export function PresetsPanel({ studio }: { studio: Studio }) {
  const { scene, dispatch } = studio;
  return (
    <div data-testid="presets-panel">
      <PanelHeader title="Lighting presets" />
      <div className="px-2 py-2">
        <p className="px-1 pb-2 text-2xs text-ink-400">
          A preset replaces the lights only — mannequin, material, camera and
          backdrop stay. Undo with Ctrl+Z.
        </p>
        <ul className="space-y-1" aria-label="Lighting presets">
          {PRESETS.map((p, i) => {
            const active = scene.preset === p.id;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  data-testid={`preset-${p.id}`}
                  onClick={() =>
                    dispatch({ type: "applyPreset", presetId: p.id })
                  }
                  className={cx(
                    "flex w-full items-start gap-3 rounded-lg border px-2.5 py-2 text-left transition-colors",
                    active
                      ? "border-accent/60 bg-accent-soft"
                      : "border-ink-750 bg-ink-850 hover:border-ink-600",
                  )}
                >
                  <span
                    aria-hidden
                    className={cx(
                      "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded text-2xs font-semibold",
                      active
                        ? "bg-accent text-ink-950"
                        : "bg-ink-700 text-ink-300",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink-100">
                      {p.name}
                    </span>
                    <span
                      className={cx(
                        "block text-2xs",
                        active ? "text-ink-200" : "text-ink-400",
                      )}
                    >
                      {PRESET_BLURBS[p.id]}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {scene.preset === "custom" && (
          <p
            className="mt-2 px-1 text-2xs text-ink-400"
            data-testid="custom-indicator"
          >
            Custom setup — tap a preset to start over from it.
          </p>
        )}
      </div>
    </div>
  );
}

export function HistoryPanel({ studio }: { studio: Studio }) {
  const { history, jump, undo, redo, canUndo, canRedo } = studio;
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-current="step"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [history.index]);
  return (
    <div data-testid="history-panel">
      <PanelHeader title="History">
        <IconButton
          icon={Undo2}
          size="sm"
          label="Undo"
          shortcut="Ctrl+Z"
          disabled={!canUndo}
          onClick={undo}
        />
        <IconButton
          icon={Redo2}
          size="sm"
          label="Redo"
          shortcut="Ctrl+Shift+Z"
          disabled={!canRedo}
          onClick={redo}
        />
      </PanelHeader>
      <ol
        ref={listRef}
        className="space-y-0.5 px-2 py-2"
        aria-label="Edit history"
      >
        {history.entries.map((e, i) => {
          const current = i === history.index;
          const future = i > history.index;
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => jump(i)}
                aria-current={current ? "step" : undefined}
                className={cx(
                  "flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs",
                  current
                    ? "bg-accent-soft text-ink-100"
                    : future
                      ? "text-ink-500 hover:bg-ink-800"
                      : "text-ink-300 hover:bg-ink-800",
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    current
                      ? "bg-accent"
                      : future
                        ? "bg-ink-600"
                        : "bg-ink-400",
                  )}
                />
                <span className="truncate">{e.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="px-3 pb-3 text-2xs text-ink-400">
        Last {history.entries.length} of up to 100 steps. Slider drags count as
        one step. Click a step to jump to it.
      </p>
    </div>
  );
}
