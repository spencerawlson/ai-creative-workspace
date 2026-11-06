"use client";

/** React host for StudioEngine. Three.js is loaded on demand (a separate
 * chunk), the engine is created once per mount and fully disposed on
 * unmount; prop changes are pushed into it imperatively. */

import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";
import type {
  BenchmarkResult,
  CameraView,
  EngineOverrides,
  EngineStats,
  ExportOptions,
  Selection,
  StudioEngine,
} from "@/lib/engine/StudioEngine";
import type { JointId } from "@/lib/studio/pose";
import { nudgeLight } from "@/lib/studio/actions";
import type { CameraPlacement, SceneDoc } from "@/lib/studio/schema";
import { cx } from "./ui";

export interface ViewportHandle {
  exportImage(opts: ExportOptions): Promise<Blob>;
  runBenchmark(durationMs?: number): Promise<BenchmarkResult>;
  getStats(): EngineStats | null;
  viewportSize(): { width: number; height: number };
  cameraPlacement(): CameraPlacement | undefined;
  setCameraPlacement(p: CameraPlacement): void;
  /** Draw `scene` now, without waiting for React (animation playback).
   * The next prop update draws the real scene again. */
  preview(scene: SceneDoc): void;
  /** Video recording: see StudioEngine.beginCapture. */
  beginCapture(width: number, height: number): HTMLCanvasElement | null;
  renderCapture(): void;
  endCapture(): void;
}

type Status = "starting" | "loading" | "ready" | "error" | "unsupported";

export function StudioViewport({
  ref,
  scene,
  overrides,
  view,
  viewNonce,
  selection = null,
  showHandles = true,
  onSelect,
  onLightDrag,
  onLightDragEnd,
  onPoseDrag,
  onPoseDragEnd,
  activeFigure = null,
  onFigureMove,
  onFigureMoveEnd,
  onCameraEnd,
  characters,
  onCharacterProblem,
  onCharacterFace,
  className,
  label = "3D lighting studio viewport",
}: {
  ref?: Ref<ViewportHandle>;
  scene: SceneDoc;
  overrides?: EngineOverrides;
  view: CameraView;
  viewNonce: number;
  selection?: Selection;
  showHandles?: boolean;
  onSelect?: (s: Selection, figure?: string) => void;
  onLightDrag?: (
    id: string,
    patch: { azimuth: number; elevation: number },
  ) => void;
  onLightDragEnd?: (id: string) => void;
  onPoseDrag?: (
    figure: string,
    patches: Partial<Record<JointId, Record<string, number>>>,
  ) => void;
  onPoseDragEnd?: () => void;
  /** The figure being posed or edited (joint overlay, face view). */
  activeFigure?: string | null;
  onFigureMove?: (figure: string, at: { x: number; z: number }) => void;
  onFigureMoveEnd?: () => void;
  onCameraEnd?: () => void;
  /** Imported characters' file URLs, by id. */
  characters?: Record<string, string>;
  onCharacterProblem?: (character: string, message: string) => void;
  /** A character loaded: its face controls ("expression.happy", ...). */
  onCharacterFace?: (character: string, controls: string[]) => void;
  className?: string;
  label?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<StudioEngine | null>(null);
  const [status, setStatus] = useState<Status>("starting");
  const [message, setMessage] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const latest = useRef({
    scene,
    overrides,
    view,
    viewNonce,
    selection,
    showHandles,
    onSelect,
    onLightDrag,
    onLightDragEnd,
    onPoseDrag,
    onPoseDragEnd,
    activeFigure,
    onFigureMove,
    onFigureMoveEnd,
    onCameraEnd,
    characters,
    onCharacterProblem,
    onCharacterFace,
  });
  latest.current = {
    scene,
    overrides,
    view,
    viewNonce,
    selection,
    showHandles,
    onSelect,
    onLightDrag,
    onLightDragEnd,
    onPoseDrag,
    onPoseDragEnd,
    activeFigure,
    onFigureMove,
    onFigureMoveEnd,
    onCameraEnd,
    characters,
    onCharacterProblem,
    onCharacterFace,
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let engine: StudioEngine | null = null;
    let cancelled = false;
    import("@/lib/engine/StudioEngine")
      .then(({ StudioEngine }) => {
        if (cancelled) return;
        try {
          engine = new StudioEngine(container, {
            onSelect: (s, f) => latest.current.onSelect?.(s, f),
            onLightDrag: (id, p) => latest.current.onLightDrag?.(id, p),
            onLightDragEnd: (id) => latest.current.onLightDragEnd?.(id),
            onPoseDrag: (f, p) => latest.current.onPoseDrag?.(f, p),
            onPoseDragEnd: () => latest.current.onPoseDragEnd?.(),
            onFigureMove: (f, at) => latest.current.onFigureMove?.(f, at),
            onFigureMoveEnd: () => latest.current.onFigureMoveEnd?.(),
            onCameraEnd: () => latest.current.onCameraEnd?.(),
            onStatus: (s) => {
              setStatus(s.model);
              setMessage(s.message ?? null);
            },
            onCharacterProblem: (id, m) =>
              latest.current.onCharacterProblem?.(id, m),
            onCharacterFace: (id, c) => latest.current.onCharacterFace?.(id, c),
          });
        } catch {
          setStatus("unsupported");
          return;
        }
        engineRef.current = engine;
        // Automated browsers only: lets E2E tests find joints on screen.
        if (navigator.webdriver)
          Object.assign(window, { __studioEngine: engine });
        const p = latest.current;
        engine.setShowHandles(p.showHandles);
        engine.setSelection(p.selection);
        engine.setActiveFigure(p.activeFigure);
        engine.setCharacters(p.characters ?? {});
        engine.update(p.scene, p.overrides);
        if (p.viewNonce > 0 || p.view !== "full") engine.setView(p.view);
      })
      .catch(() => {
        if (!cancelled) setStatus("unsupported");
      });
    return () => {
      cancelled = true;
      engine?.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.update(scene, overrides);
  }, [scene, overrides]);

  useEffect(() => {
    engineRef.current?.setSelection(selection);
  }, [selection]);

  useEffect(() => {
    engineRef.current?.setCharacters(characters ?? {});
  }, [characters]);

  useEffect(() => {
    engineRef.current?.setShowHandles(showHandles);
  }, [showHandles]);

  useEffect(() => {
    engineRef.current?.setActiveFigure(activeFigure);
  }, [activeFigure]);

  useEffect(() => {
    if (viewNonce > 0) engineRef.current?.setView(view);
  }, [view, viewNonce]);

  useImperativeHandle(
    ref,
    () => ({
      exportImage: (opts) => {
        const e = engineRef.current;
        return e
          ? e.exportImage(opts)
          : Promise.reject(new Error("The 3D view is not ready yet."));
      },
      runBenchmark: (ms) => {
        const e = engineRef.current;
        return e
          ? e.runBenchmark(ms)
          : Promise.reject(new Error("The 3D view is not ready yet."));
      },
      getStats: () => engineRef.current?.getStats() ?? null,
      viewportSize: () => ({
        width: containerRef.current?.clientWidth ?? 0,
        height: containerRef.current?.clientHeight ?? 0,
      }),
      cameraPlacement: () => engineRef.current?.getCameraPlacement(),
      setCameraPlacement: (p) => engineRef.current?.setCameraPlacement(p),
      preview: (scene) =>
        engineRef.current?.update(scene, latest.current.overrides),
      beginCapture: (w, h) => engineRef.current?.beginCapture(w, h) ?? null,
      renderCapture: () => engineRef.current?.renderCapture(),
      endCapture: () => engineRef.current?.endCapture(),
    }),
    [],
  );

  // With a light selected (and handles shown), the arrow keys move that
  // light's handle instead of the camera — the keyboard path for handles.
  const selectedLight =
    showHandles && onLightDrag
      ? scene.lights.find((l) => l.id === selection)
      : undefined;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const engine = engineRef.current;
    if (!engine || e.metaKey || e.ctrlKey || e.altKey) return;
    const step = e.shiftKey ? 15 : 5;
    if (selectedLight && onLightDrag) {
      const nudges: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
      };
      const n = nudges[e.key];
      if (n) {
        e.preventDefault();
        const patch = nudgeLight(selectedLight, n[0], n[1]);
        onLightDrag(selectedLight.id, patch);
        setAnnouncement(
          `${selectedLight.label}: direction ${Math.round(patch.azimuth)}°, height ${Math.round(patch.elevation)}°`,
        );
        return;
      }
    }
    const moves: Record<string, [number, number, number]> = {
      ArrowLeft: [-step, 0, 1],
      ArrowRight: [step, 0, 1],
      ArrowUp: [0, -step, 1],
      ArrowDown: [0, step, 1],
      "+": [0, 0, 0.9],
      "=": [0, 0, 0.9],
      "-": [0, 0, 1.1],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    engine.orbitBy(m[0], m[1], m[2]);
  }

  return (
    <div className={cx("relative h-full w-full overflow-hidden", className)}>
      <div
        ref={containerRef}
        data-testid="lighting-scene"
        data-status={status}
        tabIndex={0}
        role="application"
        aria-label={
          selectedLight
            ? `${label}. ${selectedLight.label} selected: arrow keys move the light, Shift for bigger steps, Escape to deselect.`
            : `${label}. Drag or use arrow keys to orbit, plus and minus to zoom. Press L to select a light.`
        }
        aria-busy={status === "starting" || status === "loading"}
        onKeyDown={onKeyDown}
        className="h-full w-full [&_canvas]:block [&_canvas]:h-full [&_canvas]:w-full [&_canvas]:touch-none"
      />
      <p
        aria-live="polite"
        data-testid="viewport-announcement"
        className="sr-only"
      >
        {announcement}
      </p>
      {(status === "starting" || status === "loading") && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="flex items-center gap-2 rounded-full bg-ink-900/80 px-3 py-1.5 text-xs text-ink-200 backdrop-blur">
            <span
              aria-hidden
              className="h-3 w-3 animate-spin rounded-full border-2 border-ink-500 border-t-accent"
            />
            {status === "starting" ? "Starting 3D…" : "Loading mannequin…"}
          </div>
        </div>
      )}
      {(status === "error" || status === "unsupported") && (
        <div
          role="alert"
          className="absolute inset-x-3 top-3 mx-auto max-w-sm rounded-lg border border-danger/40 bg-ink-900/95 p-3 text-xs text-ink-200 shadow-lg"
        >
          {status === "unsupported"
            ? "3D could not start in this browser. I-K-O 3D needs WebGL — try an up-to-date Chrome, Safari, Edge or Firefox."
            : message}
          {status === "error" && (
            <button
              type="button"
              onClick={() => {
                setStatus("loading");
                engineRef.current?.retryModel();
              }}
              className="ml-2 font-medium text-accent underline"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
