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
import type { SceneDoc } from "@/lib/studio/schema";
import { cx } from "./ui";

export interface ViewportHandle {
  exportImage(opts: ExportOptions): Promise<Blob>;
  runBenchmark(durationMs?: number): Promise<BenchmarkResult>;
  getStats(): EngineStats | null;
  viewportSize(): { width: number; height: number };
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
  onSelect?: (s: Selection) => void;
  onLightDrag?: (
    id: string,
    patch: { azimuth: number; elevation: number },
  ) => void;
  onLightDragEnd?: (id: string) => void;
  onPoseDrag?: (
    patches: Partial<Record<JointId, Record<string, number>>>,
  ) => void;
  onPoseDragEnd?: () => void;
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
            onSelect: (s) => latest.current.onSelect?.(s),
            onLightDrag: (id, p) => latest.current.onLightDrag?.(id, p),
            onLightDragEnd: (id) => latest.current.onLightDragEnd?.(id),
            onPoseDrag: (p) => latest.current.onPoseDrag?.(p),
            onPoseDragEnd: () => latest.current.onPoseDragEnd?.(),
            onStatus: (s) => {
              setStatus(s.model);
              setMessage(s.message ?? null);
            },
          });
        } catch {
          setStatus("unsupported");
          return;
        }
        engineRef.current = engine;
        const p = latest.current;
        engine.setShowHandles(p.showHandles);
        engine.setSelection(p.selection);
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
    engineRef.current?.setShowHandles(showHandles);
  }, [showHandles]);

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
            ? "3D could not start in this browser. Lighting Studio needs WebGL — try an up-to-date Chrome, Safari, Edge or Firefox."
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
