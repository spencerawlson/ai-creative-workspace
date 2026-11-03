"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  History as HistoryIcon,
  Keyboard,
  Layers,
  Link2,
  PanelLeftClose,
  PanelLeftOpen,
  Redo2,
  RotateCcw,
  Save,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { PRESETS } from "@/lib/lighting";
import type { CameraView, Selection } from "@/lib/engine/StudioEngine";
import { parseProject, serializeProject } from "@/lib/studio/persistence";
import { ExportDialog, ShortcutsDialog, VideoExportDialog } from "./Dialogs";
import { Inspector } from "./Inspector";
import type { JointId } from "@/lib/studio/pose";
import { isPoseSelection } from "./PoseInspector";
import { HistoryPanel, PresetsPanel, ScenePanel } from "./Panels";
import { StudioViewport, type ViewportHandle } from "./StudioViewport";
import { Timeline } from "./Timeline";
import { GraphEditor } from "./GraphEditor";
import { evaluate } from "@/lib/studio/animation";
import { Button, IconButton, cx } from "./ui";
import {
  copyText,
  downloadBlob,
  slug,
  useStudio,
  type Studio,
} from "./useStudio";

type Tool = "scene" | "presets" | "history";
type MobileTab = "presets" | "scene" | "edit" | "history";

const TOOLS: Array<{ id: Tool; label: string; icon: typeof Layers }> = [
  { id: "scene", label: "Scene", icon: Layers },
  { id: "presets", label: "Presets", icon: Sparkles },
  { id: "history", label: "History", icon: HistoryIcon },
];

/** Server snapshot is "desktop"; the client corrects it right after
 * hydration without a mismatch error. */
function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => true,
  );
}

/** Space on a focused button presses it; don't also play/pause. */
function isButton(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && el.closest("button") !== null;
}

function isTextField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (
    el.isContentEditable ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT"
  )
    return true;
  if (el.tagName !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["range", "checkbox", "radio", "button", "color"].includes(type);
}

export function LightingStudio() {
  const studio = useStudio();
  const { scene, dispatch, seal, undo, redo } = studio;
  // md+: docked panels. lg+: room for both side panels; below that the
  // tool panel floats over the viewport and starts collapsed.
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const isWide = useMediaQuery("(min-width: 1024px)");
  const viewport = useRef<ViewportHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [selection, setSelection] = useState<Selection>(null);
  // Keyframe timeline: where edits are keyed, and how.
  const [time, setTime] = useState(0);
  const [autoKey, setAutoKey] = useState(false);
  const [keyCamera, setKeyCamera] = useState(true);
  const [loop, setLoop] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [playRequest, setPlayRequest] = useState(0);
  // The figure the mannequin and pose controls act on.
  const [activeId, setActiveId] = useState<string | null>(null);
  const figure =
    scene.figures.find((f) => f.id === activeId) ?? scene.figures[0];
  const [tool, setTool] = useState<Tool>("scene");
  const [panelPref, setPanelOpen] = useState<boolean | null>(null);
  const panelOpen = panelPref ?? isWide;
  const [mobileTab, setMobileTab] = useState<MobileTab>("presets");
  const [view, setView] = useState<CameraView>("full");
  const [viewNonce, setViewNonce] = useState(0);
  const [showHandles, setShowHandles] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  // A selection pointing at a light that no longer exists (undo, preset,
  // delete) falls back to the scene.
  const validSelection =
    selection &&
    !["model", "camera", "backdrop"].includes(selection) &&
    !isPoseSelection(selection) &&
    !scene.lights.some((l) => l.id === selection)
      ? null
      : selection;

  const select = useCallback(
    (s: Selection, figureId?: string) => {
      setSelection(s);
      if (figureId) setActiveId(figureId);
      if (!isDesktop && s !== null) setMobileTab("edit");
    },
    [isDesktop],
  );

  const changeView = useCallback((v: CameraView) => {
    setView(v);
    setViewNonce((n) => n + 1);
  }, []);

  const onLightDrag = useCallback(
    (id: string, patch: { azimuth: number; elevation: number }) =>
      dispatch({ type: "updateLight", id, patch }, { gesture: true }),
    [dispatch],
  );

  const onPoseDrag = useCallback(
    (
      figureId: string,
      patches: Partial<Record<JointId, Record<string, number>>>,
    ) =>
      dispatch(
        { type: "updateJoints", patches, figure: figureId },
        { gesture: true },
      ),
    [dispatch],
  );

  // Show the animation at time t (also where the next edit is keyed).
  const sceneNow = useRef(scene);
  sceneNow.current = scene;
  const seek = useCallback(
    (t: number) => {
      setTime(t);
      studio.showTime(t);
      const view = keyCamera ? evaluate(sceneNow.current, t).view : null;
      if (view) viewport.current?.setCameraPlacement(view);
    },
    [studio, keyCamera],
  );

  // Every dispatch reads this to auto-key at the current time.
  useEffect(() => {
    studio.timeline.current = {
      t: time,
      autoKey,
      camera: () =>
        keyCamera ? viewport.current?.cameraPlacement() : undefined,
    };
  }, [studio.timeline, time, autoKey, keyCamera]);

  // Auto-key: finishing an orbit keys the camera too.
  const onCameraEnd = useCallback(() => {
    if (!autoKey || !keyCamera || previewing) return;
    dispatch({
      type: "setKey",
      t: time,
      camera: viewport.current?.cameraPlacement(),
    });
  }, [autoKey, keyCamera, previewing, dispatch, time]);

  const onFigureMove = useCallback(
    (figureId: string, at: { x: number; z: number }) =>
      dispatch(
        { type: "updateFigure", figure: figureId, patch: at },
        { gesture: true },
      ),
    [dispatch],
  );

  async function share() {
    const link = await studio.shareUrl();
    const ok = await copyText(link.url);
    setCopied(ok ? "copied" : "failed");
    studio.notify(
      !ok
        ? "Couldn't copy. Copy the address bar instead."
        : link.animated
          ? "Share link copied — it opens this animation."
          : link.tooLong
            ? "Share link copied. The animation is too long for a link, so it opens this frame; save a project file (Ctrl+S) to keep the animation."
            : "Share link copied — it opens this exact setup.",
      ok ? "info" : "error",
    );
    setTimeout(() => setCopied("idle"), 2500);
  }

  const saveProject = useCallback(() => {
    const text = serializeProject(studio.name, scene);
    downloadBlob(
      new Blob([text], { type: "application/json" }),
      `${slug(studio.name)}.lighting.json`,
    );
    studio.notify("Project file saved to your downloads.");
  }, [studio, scene]);

  async function openProject(file: File) {
    const r = parseProject(await file.text());
    if (!r.ok) {
      studio.notify(r.error, "error");
      return;
    }
    dispatch({
      type: "loadScene",
      scene: r.project.scene,
      label: `Open ${r.project.name}`,
    });
    studio.setName(r.project.name);
    studio.notify(
      `Opened "${r.project.name}". Undo restores your previous setup.`,
    );
  }

  // Keyboard shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (exportOpen || shortcutsOpen) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && !e.altKey) {
        if (isTextField(e.target)) return; // native undo in text fields
        if (k === "z" && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if ((k === "z" && e.shiftKey) || k === "y") {
          e.preventDefault();
          redo();
        } else if (k === "e") {
          e.preventDefault();
          setExportOpen(true);
        } else if (k === "s") {
          e.preventDefault();
          saveProject();
        } else if (
          k === "d" &&
          validSelection &&
          scene.lights.some((l) => l.id === validSelection)
        ) {
          e.preventDefault();
          dispatch({ type: "duplicateLight", id: validSelection });
        }
        return;
      }
      if (e.altKey || isTextField(e.target)) return;
      if (previewing) {
        if (e.key === "Escape" || e.key === "v" || e.key === "V")
          setPreviewing(false);
        else if (e.key === " " && !isButton(e.target)) {
          e.preventDefault();
          setPlayRequest((n) => n + 1);
        }
        return;
      }
      const keys = scene.animation.keys;
      if (e.key === " " && !isButton(e.target)) {
        e.preventDefault();
        setPlayRequest((n) => n + 1);
        return;
      }
      if (e.key === "k" || e.key === "K") {
        dispatch({
          type: "setKey",
          t: time,
          camera: keyCamera ? viewport.current?.cameraPlacement() : undefined,
        });
        return;
      }
      if (e.key === ",") {
        const prev = [...keys].reverse().find((k) => k.t < time - 0.005);
        if (prev) seek(prev.t);
        return;
      }
      if (e.key === ".") {
        const next = keys.find((k) => k.t > time + 0.005);
        if (next) seek(next.t);
        return;
      }
      if (e.key === "g" || e.key === "G") {
        setGraphOpen((v) => !v);
        return;
      }
      if ((e.key === "v" || e.key === "V") && keys.length > 0) {
        setPreviewing(true);
        return;
      }
      const preset = Number(e.key);
      if (preset >= 1 && preset <= PRESETS.length) {
        dispatch({ type: "applyPreset", presetId: PRESETS[preset - 1].id });
        return;
      }
      const light = scene.lights.find((l) => l.id === validSelection);
      switch (e.key) {
        case "f":
        case "F":
          changeView("face");
          break;
        case "b":
        case "B":
          changeView("full");
          break;
        case "o":
        case "O":
          changeView("studio");
          break;
        case "h":
        case "H":
          setShowHandles((v) => !v);
          break;
        case "m":
        case "M":
          dispatch({
            type: "setModel",
            model: figure.model === "male" ? "female" : "male",
            figure: figure.id,
          });
          break;
        case "t":
        case "T":
          if (light)
            dispatch({
              type: "updateLight",
              id: light.id,
              patch: { on: !light.on },
            });
          break;
        case "l":
        case "L": {
          // Cycle through lights (Shift goes backwards). Selecting is the
          // keyboard route to a handle: arrow keys then move it.
          const ids = scene.lights.map((l) => l.id);
          const i = light ? ids.indexOf(light.id) : -1;
          const next =
            i < 0
              ? e.shiftKey
                ? ids.length - 1
                : 0
              : (i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length;
          setSelection(ids[next]);
          break;
        }
        case "p":
        case "P":
          select("pose");
          break;
        case "[":
          setPanelOpen(!panelOpen);
          break;
        case "?":
          setShortcutsOpen(true);
          break;
        case "Escape":
          setSelection(null);
          break;
        case "Delete":
        case "Backspace":
          if (light && scene.lights.length > 1) {
            e.preventDefault();
            dispatch({ type: "removeLight", id: light.id });
            setSelection(null);
          }
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    select,
    exportOpen,
    shortcutsOpen,
    undo,
    redo,
    saveProject,
    dispatch,
    scene,
    figure,
    validSelection,
    changeView,
    panelOpen,
    previewing,
    time,
    keyCamera,
    seek,
  ]);

  const inspector = (
    <Inspector
      studio={studio}
      figure={figure}
      selection={validSelection}
      onSelect={select}
      viewport={viewport}
      view={view}
      onView={changeView}
      showHandles={showHandles}
      onShowHandles={setShowHandles}
    />
  );
  const panels: Record<Tool, React.ReactNode> = {
    scene: (
      <ScenePanel
        studio={studio}
        figure={figure}
        selection={validSelection}
        onSelect={select}
      />
    ),
    presets: <PresetsPanel studio={studio} />,
    history: <HistoryPanel studio={studio} />,
  };

  const timeline = (
    <Timeline
      studio={studio}
      graphOpen={graphOpen}
      onGraph={setGraphOpen}
      onVideo={() => setVideoOpen(true)}
      viewport={viewport}
      time={time}
      onSeek={seek}
      autoKey={autoKey}
      onAutoKey={setAutoKey}
      keyCamera={keyCamera}
      onKeyCamera={setKeyCamera}
      loop={loop}
      onLoop={setLoop}
      preview={previewing}
      onPreview={setPreviewing}
      playRequest={playRequest}
    />
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ink-950">
      <Toolbar
        studio={studio}
        copied={copied}
        onShare={share}
        onExport={() => setExportOpen(true)}
        onOpen={() => fileInput.current?.click()}
        onSave={saveProject}
        onShortcuts={() => setShortcutsOpen(true)}
        compact={!isDesktop}
      />
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        data-testid="open-file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openProject(f);
          e.target.value = "";
        }}
      />

      <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
        {isDesktop && (
          <nav
            aria-label="Tools"
            className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-ink-800 bg-ink-900 py-2"
          >
            {TOOLS.map((t) => (
              <IconButton
                key={t.id}
                icon={t.icon}
                label={t.label}
                active={panelOpen && tool === t.id}
                aria-pressed={panelOpen && tool === t.id}
                data-testid={`tool-${t.id}`}
                onClick={() => {
                  if (panelOpen && tool === t.id) setPanelOpen(false);
                  else {
                    setTool(t.id);
                    setPanelOpen(true);
                  }
                }}
              />
            ))}
            <div className="mt-auto flex flex-col items-center gap-1">
              <IconButton
                icon={Keyboard}
                label="Keyboard shortcuts"
                shortcut="?"
                onClick={() => setShortcutsOpen(true)}
              />
              <IconButton
                icon={panelOpen ? PanelLeftClose : PanelLeftOpen}
                label={panelOpen ? "Collapse panel" : "Expand panel"}
                shortcut="["
                onClick={() => setPanelOpen(!panelOpen)}
                data-testid="toggle-panel"
              />
            </div>
          </nav>
        )}
        {isDesktop && panelOpen && (
          <aside
            aria-label={TOOLS.find((t) => t.id === tool)?.label}
            className={cx(
              "w-60 shrink-0 overflow-y-auto border-r border-ink-800 bg-ink-900 lg:w-64",
              !isWide &&
                "absolute bottom-0 left-12 top-0 z-30 shadow-2xl shadow-black/60",
            )}
          >
            {panels[tool]}
          </aside>
        )}

        <main
          className={cx(
            "flex flex-col bg-black",
            previewing
              ? "fixed inset-0 z-50 h-dvh"
              : "relative h-[46dvh] shrink-0 md:h-auto md:min-w-0 md:flex-1",
          )}
          data-testid={previewing ? "preview-screen" : undefined}
        >
          <div className="relative min-h-0 flex-1">
            <StudioViewport
              ref={viewport}
              scene={scene}
              view={view}
              viewNonce={viewNonce}
              selection={previewing ? null : validSelection}
              showHandles={showHandles && !previewing}
              onSelect={select}
              onLightDrag={onLightDrag}
              onLightDragEnd={seal}
              onPoseDrag={onPoseDrag}
              onPoseDragEnd={seal}
              activeFigure={figure.id}
              onFigureMove={onFigureMove}
              onFigureMoveEnd={seal}
              onCameraEnd={onCameraEnd}
            />
            {previewing ? (
              <div className="pointer-events-none absolute inset-x-2 top-2 flex items-center justify-between">
                <span className="rounded-md bg-ink-900/80 px-2 py-1 text-xs font-medium text-ink-200 backdrop-blur">
                  Preview
                </span>
                <Button
                  size="sm"
                  icon={X}
                  className="pointer-events-auto"
                  onClick={() => setPreviewing(false)}
                  data-testid="preview-exit"
                >
                  Exit preview (Esc)
                </Button>
              </div>
            ) : (
              <ViewportOverlay
                posing={isPoseSelection(validSelection)}
                view={view}
                onView={changeView}
                showHandles={showHandles}
                onShowHandles={setShowHandles}
                studio={studio}
              />
            )}
          </div>
          {previewing && timeline}
        </main>

        {isDesktop ? (
          <aside
            aria-label="Inspector"
            className="w-72 shrink-0 overflow-y-auto border-l border-ink-800 bg-ink-900 lg:w-80"
          >
            {inspector}
          </aside>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col bg-ink-900">
            <div
              role="tablist"
              aria-label="Panels"
              className="flex shrink-0 border-b border-ink-800"
            >
              {(["presets", "scene", "edit", "history"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  type="button"
                  aria-selected={mobileTab === t}
                  data-testid={`tab-${t}`}
                  onClick={() => setMobileTab(t)}
                  className={cx(
                    "h-11 flex-1 text-xs font-medium",
                    mobileTab === t
                      ? "border-b-2 border-accent text-ink-100"
                      : "text-ink-400",
                  )}
                >
                  {t === "edit" ? "Inspect" : t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            {/* Phones: the graph editor takes the panel's place rather
                than squeezing in under it. */}
            {graphOpen && !previewing ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <GraphEditor
                  studio={studio}
                  figure={figure}
                  selection={validSelection}
                  time={time}
                  onSeek={seek}
                  fill
                />
              </div>
            ) : null}
            <div
              role="tabpanel"
              className={cx(
                "min-h-0 flex-1 overflow-y-auto",
                graphOpen && !previewing && "hidden",
              )}
            >
              {mobileTab === "edit" ? inspector : panels[mobileTab]}
            </div>
          </div>
        )}
      </div>

      {!previewing && (
        <div className="shrink-0">
          {graphOpen && isDesktop && (
            <GraphEditor
              studio={studio}
              figure={figure}
              selection={validSelection}
              time={time}
              onSeek={seek}
            />
          )}
          {timeline}
        </div>
      )}
      <Notices studio={studio} />
      <VideoExportDialog
        open={videoOpen}
        onClose={() => setVideoOpen(false)}
        studio={studio}
        viewport={viewport}
        keyCamera={keyCamera}
        onFinished={() => seek(time)}
      />
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        studio={studio}
        viewport={viewport}
      />
      <ShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
}

function Toolbar({
  studio,
  copied,
  onShare,
  onExport,
  onOpen,
  onSave,
  onShortcuts,
  compact,
}: {
  studio: Studio;
  copied: "idle" | "copied" | "failed";
  onShare: () => void;
  onExport: () => void;
  onOpen: () => void;
  onSave: () => void;
  onShortcuts: () => void;
  compact: boolean;
}) {
  const { undo, redo, canUndo, canRedo, dispatch } = studio;
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-ink-800 bg-ink-900 px-2 sm:gap-2 sm:px-3">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent text-xs font-bold text-ink-950"
        >
          L
        </span>
        <div className="hidden min-w-0 sm:block">
          <h1 className="text-sm font-semibold leading-none text-ink-100">
            Lighting Studio
          </h1>
          <nav
            aria-label="Studios"
            className="mt-0.5 text-2xs leading-none text-ink-400"
          >
            <Link
              href="/photography"
              className="hover:text-ink-200 hover:underline"
            >
              Photography →
            </Link>
          </nav>
        </div>
      </div>
      <div className="mx-1 hidden h-6 w-px bg-ink-750 sm:block" />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <label className="sr-only" htmlFor="project-name">
          Project name
        </label>
        <input
          id="project-name"
          value={studio.name}
          maxLength={80}
          data-testid="project-name"
          onChange={(e) => studio.setName(e.target.value)}
          onBlur={(e) => {
            if (!e.target.value.trim())
              studio.setName("Untitled lighting setup");
          }}
          className="h-8 min-w-0 max-w-64 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm text-ink-100 hover:border-ink-700 focus:border-ink-600 focus:bg-ink-850"
        />
        {!compact && (
          <span
            className="hidden shrink-0 text-2xs text-ink-400 lg:inline"
            data-testid="save-status"
            title="Autosaved in this browser. Use Save to keep a file."
          >
            {studio.savedAt
              ? `Saved on this device · ${new Date(studio.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "Not saved yet"}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          icon={Undo2}
          label="Undo"
          shortcut="Ctrl+Z"
          disabled={!canUndo}
          onClick={undo}
          data-testid="undo"
        />
        <IconButton
          icon={Redo2}
          label="Redo"
          shortcut="Ctrl+Shift+Z"
          disabled={!canRedo}
          onClick={redo}
          data-testid="redo"
        />
        {!compact && (
          <>
            <IconButton
              icon={RotateCcw}
              label="Reset scene (undoable)"
              onClick={() => dispatch({ type: "reset" })}
              data-testid="reset-setup"
            />
            <div className="mx-1 h-6 w-px bg-ink-750" />
            <IconButton
              icon={FolderOpen}
              label="Open project file"
              onClick={onOpen}
              data-testid="open-project"
            />
            <IconButton
              icon={Save}
              label="Save project file"
              shortcut="Ctrl+S"
              onClick={onSave}
              data-testid="save-project"
            />
            <IconButton
              icon={Keyboard}
              label="Keyboard shortcuts"
              shortcut="?"
              onClick={onShortcuts}
              className="md:hidden"
            />
          </>
        )}
        <Button
          size="sm"
          variant="secondary"
          icon={Link2}
          onClick={onShare}
          data-testid="copy-link"
          className="ml-1"
        >
          <span className={compact ? "sr-only" : undefined}>
            {copied === "copied"
              ? "Copied"
              : copied === "failed"
                ? "Copy failed"
                : "Share"}
          </span>
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={Download}
          onClick={onExport}
          data-testid="export-open"
        >
          <span className={compact ? "sr-only" : undefined}>Export</span>
        </Button>
      </div>
    </header>
  );
}

function ViewportOverlay({
  posing,
  view,
  onView,
  showHandles,
  onShowHandles,
  studio,
}: {
  posing: boolean;
  view: CameraView;
  onView: (v: CameraView) => void;
  showHandles: boolean;
  onShowHandles: (v: boolean) => void;
  studio: Studio;
}) {
  const preset = PRESETS.find((p) => p.id === studio.scene.preset);
  return (
    <>
      <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2">
        <div
          role="group"
          aria-label="Camera view"
          className="pointer-events-auto flex rounded-lg bg-ink-900/85 p-0.5 shadow backdrop-blur"
        >
          {(["full", "face", "studio"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              data-testid={`view-${v}`}
              onClick={() => onView(v)}
              className={cx(
                "h-7 whitespace-nowrap rounded-md px-2.5 text-xs font-medium",
                view === v
                  ? "bg-ink-600 text-ink-100"
                  : "text-ink-300 hover:text-ink-100",
              )}
            >
              {v === "full" ? "Full body" : v === "face" ? "Face" : "Studio"}
            </button>
          ))}
        </div>
        <div className="pointer-events-auto flex items-center gap-1 rounded-lg bg-ink-900/85 p-0.5 shadow backdrop-blur">
          <span
            className="hidden whitespace-nowrap px-2 text-xs text-ink-200 sm:inline"
            data-testid="active-preset"
          >
            {preset ? preset.name : "Custom"}
          </span>
          <IconButton
            icon={showHandles ? Eye : EyeOff}
            size="sm"
            label={showHandles ? "Hide light handles" : "Show light handles"}
            shortcut="H"
            onClick={() => onShowHandles(!showHandles)}
            data-testid="toggle-handles"
          />
        </div>
      </div>
      <p className="pointer-events-none absolute bottom-2 left-2 hidden rounded-md bg-ink-900/70 px-2 py-1 text-2xs text-ink-300 backdrop-blur sm:block">
        {posing
          ? "Drag a body part to pose it · drag around the figure to orbit · scroll or pinch to zoom"
          : "Drag to orbit · scroll or pinch to zoom · drag a light handle to move it"}
      </p>
    </>
  );
}

function Notices({ studio }: { studio: Studio }) {
  const { notice } = studio;
  const [visible, setVisible] = useState<typeof notice>(null);
  // Info notices fade on their own; errors stay until dismissed, so a
  // message raised while the 3D view is still loading isn't missed.
  useEffect(() => {
    if (!notice) return;
    setVisible(notice);
    if (notice.tone === "error") return;
    const t = setTimeout(
      () => setVisible((v) => (v?.id === notice.id ? null : v)),
      3500,
    );
    return () => clearTimeout(t);
  }, [notice]);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
    >
      {visible && (
        <div
          role={visible.tone === "error" ? "alert" : "status"}
          data-testid="notice"
          className={cx(
            "pointer-events-auto max-w-md rounded-lg border px-3 py-2 text-sm shadow-xl",
            visible.tone === "error"
              ? "border-danger/40 bg-ink-850 text-ink-100"
              : "border-ink-700 bg-ink-850 text-ink-100",
          )}
        >
          <span className="flex items-start gap-2">
            <span>{visible.text}</span>
            {visible.tone === "error" && (
              <IconButton
                icon={X}
                size="sm"
                label="Dismiss"
                className="-my-1 -mr-1"
                onClick={() => setVisible(null)}
              />
            )}
          </span>
        </div>
      )}
    </div>
  );
}
