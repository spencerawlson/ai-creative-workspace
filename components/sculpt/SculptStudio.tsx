"use client";

/** Sculpt: shape digital clay with brushes. The page around the 3D view
 * (lib/sculpt/SculptEngine.ts): brushes and their settings, the clay's
 * material, undo, sculptures kept on this device, and export. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Brush,
  Download,
  FolderOpen,
  Hand,
  Keyboard,
  Layers,
  Maximize2,
  Minimize2,
  Move3d,
  Paintbrush,
  Plus,
  Redo2,
  Scan,
  Shield,
  Trash2,
  Undo2,
  Waves,
  Wind,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BRUSHES, BRUSH_INFO, type BrushId } from "@/lib/sculpt/brushes";
import { buildMesh, faceCount, triangles } from "@/lib/sculpt/mesh";
import {
  SHAPES,
  SHAPE_NAMES,
  makeShape,
  type ShapeId,
} from "@/lib/sculpt/shapes";
import {
  deleteSculpt,
  listSculpts,
  loadSculpt,
  newSculptId,
  saveSculpt,
  type SculptEntry,
} from "@/lib/sculpt/store";
import type { SculptEngine, SculptTool } from "@/lib/sculpt/SculptEngine";
import { toStl } from "@/lib/engine/statueExport";
import { MenuBar, useNarrowScreen } from "@/components/MenuBar";
import { BrandLink, Sidebar, WorkspaceMenu } from "@/components/WorkspaceNav";
import { openParam } from "@/lib/sculpt/fromFigure";
import { MATERIAL_PRESETS } from "@/lib/studio/presets";
import { packLayer, unpackLayer } from "@/lib/sculpt/paint";
import { downloadBlob, slug } from "@/components/studio/useStudio";
import { SCULPT_SHORTCUTS, ShortcutsDialog } from "@/components/studio/Dialogs";
import {
  Button,
  Dialog,
  IconButton,
  Section,
  Segmented,
  Slider,
  Tip,
  Toggle,
  cx,
} from "@/components/studio/ui";

const BRUSH_ICONS: Record<BrushId, LucideIcon> = {
  draw: Brush,
  clay: Layers,
  inflate: Maximize2,
  smooth: Waves,
  flatten: Scan,
  pinch: Minimize2,
  grab: Hand,
  paint: Paintbrush,
  mask: Shield,
};

/** Ready colours for the paint brush (any other from the picker). */
const PAINT_COLORS = [
  "#f4f1ea",
  "#1f1f22",
  "#c0392b",
  "#e67e22",
  "#f1c40f",
  "#27ae60",
  "#2980b9",
  "#8e44ad",
  "#d9a98c",
  "#7a5240",
];

/** What Subtract does with each kind of brush. */
const SUBTRACT_HINT: Partial<Record<BrushId, string>> = {
  paint: "Erase paint instead.",
  mask: "Free masked areas instead.",
};

/** Clay looks: the studio's statue materials. */
const LOOKS = [
  "clay",
  "plaster",
  "marble",
  "studio-grey",
  "sandstone",
  "dark-stone",
  "bronze",
  "aged-bronze",
  "gold",
].flatMap((id) => MATERIAL_PRESETS.filter((m) => m.id === id));

const SAVE_DELAY = 1200;

type Status =
  | { kind: "starting" }
  | { kind: "ready" }
  | { kind: "unsupported"; message: string };

export function SculptStudio() {
  const container = useRef<HTMLDivElement>(null);
  const engine = useRef<SculptEngine | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "starting" });
  const [tool, setTool] = useState<SculptTool>({
    brush: "draw",
    sizePx: 60,
    strength: 0.5,
    invert: false,
    symmetry: true,
    turnView: false,
    color: "#c0392b",
  });
  const [look, setLook] = useState("clay");
  const lookRef = useRef(look);
  lookRef.current = look;
  const [entry, setEntry] = useState<SculptEntry | null>(null);
  const [saved, setSaved] = useState<SculptEntry[]>([]);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [steps, setSteps] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    "new" | "open" | "export" | "shortcuts" | null
  >(null);
  const entryRef = useRef<SculptEntry | null>(null);
  const saveTimer = useRef<number>(0);
  /** A change not yet written: shown as "Saving…", written on leaving. */
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  entryRef.current = entry;

  /** Write the sculpture now. What's written is captured at the call, so
   * switching to another sculpture straight after is safe. */
  const save = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    pendingRef.current = false;
    const e = engine.current;
    const current = entryRef.current;
    if (!e?.mesh || !current) {
      setPending(false);
      return;
    }
    const next = {
      ...current,
      updatedAt: Date.now(),
      triangles: faceCount(e.mesh),
    };
    const data = {
      id: next.id,
      positions: e.mesh.positions,
      index: e.mesh.index,
      ...(() => {
        const paint = packLayer(e.mesh.paint, 4, 3);
        const mask = packLayer(e.mesh.mask, 1);
        return { ...(paint ? { paint } : {}), ...(mask ? { mask } : {}) };
      })(),
    };
    const error = await saveSculpt(next, data);
    if (!pendingRef.current) setPending(false);
    if (error) {
      setNote(error);
      return;
    }
    setEntry((cur) =>
      cur?.id === next.id
        ? { ...cur, updatedAt: next.updatedAt, triangles: next.triangles }
        : cur,
    );
    setSaved(await listSculpts());
    setNote(null);
  }, []);

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    pendingRef.current = true;
    setPending(true);
    saveTimer.current = window.setTimeout(() => void save(), SAVE_DELAY);
  }, [save]);

  /** Write a waiting change now (leaving the page, the name, or this
   * sculpture). */
  const flush = useCallback(() => {
    if (pendingRef.current) void save();
  }, [save]);

  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", flush);
    };
  }, [flush]);

  /** Start a new sculpture from a shape (saved after its first stroke). */
  const startNew = useCallback(
    (shape: ShapeId) => {
      const e = engine.current;
      if (!e) return;
      // The one being left: its last change written first.
      flush();
      const mesh = makeShape(shape);
      e.setMesh(mesh);
      setEntry({
        id: newSculptId(),
        name: `${SHAPE_NAMES[shape]} sculpture`,
        // A new sculpture starts in the material you were using.
        look: lookRef.current,
        updatedAt: 0,
        triangles: faceCount(mesh),
      });
      setSteps(0);
    },
    [flush],
  );

  const open = useCallback(
    async (id: string) => {
      const e = engine.current;
      if (!e) return;
      flush();
      const data = await loadSculpt(id);
      const meta = (await listSculpts()).find((s) => s.id === id);
      if (!data || !meta) {
        setNote("That sculpture isn't on this device any more.");
        return;
      }
      e.setMesh(
        buildMesh(data.positions, data.index, {
          paint: unpackLayer(data.paint),
          mask: unpackLayer(data.mask),
        }),
      );
      setEntry(meta);
      setLook(meta.look ?? "clay");
      setSteps(0);
    },
    [flush],
  );

  // The 3D view, once.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let disposed = false;
    let made: SculptEngine | null = null;
    void import("@/lib/sculpt/SculptEngine").then(async ({ SculptEngine }) => {
      if (disposed) return;
      try {
        made = new SculptEngine(el, {
          onChange: (h) => {
            setHistory(h);
            setSteps(made?.history.steps ?? 0);
          },
          onStroke: () => scheduleSave(),
        });
      } catch {
        setStatus({
          kind: "unsupported",
          message:
            "This browser can't show 3D (WebGL is off or unavailable). Try a current Chrome, Edge, Firefox or Safari.",
        });
        return;
      }
      engine.current = made;
      const list = await listSculpts();
      if (disposed) return;
      setSaved(list);
      // Asked for one (from the studio's "Sculpt this figure"), else the
      // latest, else a new sphere.
      const asked = openParam(window.location.search);
      if (asked) {
        const url = new URL(window.location.href);
        url.searchParams.delete("open");
        window.history.replaceState(null, "", url.toString());
      }
      const first = list.find((s) => s.id === asked) ?? list[0];
      if (first) await open(first.id);
      else startNew("sphere");
      setStatus({ kind: "ready" });
    });
    return () => {
      disposed = true;
      // Leaving the page: write a waiting change first (its data is
      // captured before the view goes).
      flush();
      made?.dispose();
      engine.current = null;
    };
  }, [open, startNew, scheduleSave, flush]);

  useEffect(() => {
    engine.current?.setTool(tool);
  }, [tool, status]);

  useEffect(() => {
    const m = LOOKS.find((l) => l.id === look) ?? LOOKS[0];
    engine.current?.setLook(m);
  }, [look, status]);

  // Keys (listed in Help > Keyboard shortcuts: SCULPT_SHORTCUTS).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (dialog || e.altKey) return; // a dialog has the keys
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setDialog("export");
        return;
      }
      if (!mod) {
        const k = e.key.toLowerCase();
        const n = Number(e.key);
        if (Number.isInteger(n) && n >= 1 && n <= BRUSHES.length) {
          setTool((t) => ({ ...t, brush: BRUSHES[n - 1], turnView: false }));
          return;
        }
        if (e.key === "{" || e.key === "}") {
          setTool((t) => ({
            ...t,
            strength:
              Math.round(
                Math.min(
                  1,
                  Math.max(0.05, t.strength + (e.key === "}" ? 0.1 : -0.1)),
                ) * 100,
              ) / 100,
          }));
          return;
        }
        if (k === "i") return setTool((t) => ({ ...t, invert: !t.invert }));
        if (k === "x") return setTool((t) => ({ ...t, symmetry: !t.symmetry }));
        if (k === "v") return setTool((t) => ({ ...t, turnView: !t.turnView }));
        if (k === "f") return engine.current?.frameView();
        if (e.key === "?") return setDialog("shortcuts");
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) engine.current?.redo();
        else engine.current?.undo();
        scheduleSave();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        engine.current?.redo();
        scheduleSave();
      } else if (e.key === "[" || e.key === "]") {
        setTool((t) => ({
          ...t,
          sizePx: Math.min(
            200,
            Math.max(10, t.sizePx + (e.key === "]" ? 10 : -10)),
          ),
        }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scheduleSave, dialog]);

  const set = (patch: Partial<SculptTool>) =>
    setTool((t) => ({ ...t, ...patch }));
  const narrow = useNarrowScreen();
  const info = BRUSH_INFO[tool.brush];

  return (
    <main className="flex h-dvh flex-col bg-ink-950 text-ink-100">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-ink-800 bg-ink-900 px-2 sm:gap-2 sm:px-3">
        <h1 className="sr-only">IKO 3D Sculpt</h1>
        <BrandLink />
        {/* Phones have no sidebar: the workspaces are a menu here. */}
        <WorkspaceMenu current="sculpt" className="md:hidden" />
        <MenuBar
          compact={narrow}
          menus={[
            {
              id: "file",
              label: "File",
              items: [
                {
                  label: "New sculpture…",
                  icon: Plus,
                  onSelect: () => setDialog("new"),
                  testId: "sculpt-new",
                },
                {
                  label: "Open…",
                  icon: FolderOpen,
                  onSelect: () => setDialog("open"),
                  testId: "sculpt-open",
                },
                "separator",
                {
                  label: "Export…",
                  icon: Download,
                  shortcut: "Ctrl+E",
                  onSelect: () => setDialog("export"),
                },
              ],
            },
            {
              id: "edit",
              label: "Edit",
              items: [
                {
                  label: "Undo",
                  shortcut: "Ctrl+Z",
                  disabled: !history.canUndo,
                  onSelect: () => {
                    engine.current?.undo();
                    scheduleSave();
                  },
                },
                {
                  label: "Redo",
                  shortcut: "Ctrl+Shift+Z",
                  disabled: !history.canRedo,
                  onSelect: () => {
                    engine.current?.redo();
                    scheduleSave();
                  },
                },
              ],
            },
            {
              id: "view",
              label: "View",
              items: [
                {
                  label: "Frame the sculpture",
                  icon: Move3d,
                  shortcut: "F",
                  onSelect: () => engine.current?.frameView(),
                },
                "separator",
                {
                  label: "Turn view",
                  shortcut: "V",
                  checked: !!tool.turnView,
                  onSelect: () => set({ turnView: !tool.turnView }),
                },
                {
                  label: "Symmetry",
                  shortcut: "X",
                  checked: tool.symmetry,
                  onSelect: () => set({ symmetry: !tool.symmetry }),
                },
              ],
            },
            {
              id: "help",
              label: "Help",
              items: [
                {
                  label: "Keyboard shortcuts",
                  icon: Keyboard,
                  shortcut: "?",
                  onSelect: () => setDialog("shortcuts"),
                  testId: "sculpt-shortcuts",
                },
              ],
            },
          ]}
        />
        <div className="mx-1 hidden h-6 w-px bg-ink-750 sm:block" />
        <label className="sr-only" htmlFor="sculpt-name">
          Sculpture name
        </label>
        <input
          id="sculpt-name"
          value={entry?.name ?? ""}
          maxLength={60}
          onChange={(e) => {
            const name = e.target.value;
            setEntry((cur) => (cur ? { ...cur, name } : cur));
            // Kept like a stroke: a named sculpture is worth keeping.
            scheduleSave();
          }}
          onBlur={flush}
          className="min-w-0 flex-1 truncate rounded-md bg-transparent px-2 py-1 text-sm text-ink-100 hover:bg-ink-850 focus:bg-ink-850 focus:outline-none"
          data-testid="sculpt-name"
        />
        <IconButton
          icon={Undo2}
          label="Undo"
          shortcut="Ctrl+Z"
          disabled={!history.canUndo}
          onClick={() => {
            engine.current?.undo();
            scheduleSave();
          }}
          data-testid="sculpt-undo"
        />
        <IconButton
          icon={Redo2}
          label="Redo"
          shortcut="Ctrl+Shift+Z"
          disabled={!history.canRedo}
          onClick={() => {
            engine.current?.redo();
            scheduleSave();
          }}
          data-testid="sculpt-redo"
        />
        <Button
          variant="primary"
          size="sm"
          icon={Download}
          aria-label="Export"
          onClick={() => setDialog("export")}
          data-testid="sculpt-export"
        >
          <span className="hidden sm:inline">Export</span>
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="hidden md:flex">
          <Sidebar current="sculpt" />
        </div>
        <div
          ref={container}
          className="relative order-1 min-h-[55dvh] flex-1 md:order-2 md:min-h-0"
          data-testid="sculpt-view"
          data-status={status.kind}
          data-steps={steps}
        >
          {status.kind === "starting" && (
            <p className="absolute inset-0 grid place-items-center text-sm text-ink-400">
              Getting the clay ready…
            </p>
          )}
          {status.kind === "unsupported" && (
            <p
              role="alert"
              className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-ink-300"
            >
              {status.message}
            </p>
          )}
          {status.kind === "ready" && (
            <p className="pointer-events-none absolute bottom-2 left-3 right-3 text-2xs text-ink-400">
              {tool.turnView
                ? "Turning the view: drag to orbit, pinch or scroll to zoom."
                : "Drag on the clay to sculpt · drag off it, right-drag or use two fingers to turn the view · [ ] brush size · ? keys"}
            </p>
          )}
        </div>

        <aside
          className="order-2 max-h-[45dvh] shrink-0 overflow-y-auto border-t border-ink-800 bg-ink-900 px-3 pb-4 md:order-1 md:max-h-none md:w-72 md:border-r md:border-t-0"
          aria-label="Sculpting tools"
        >
          <Section title="Brush" testId="sculpt-section-brush">
            <div
              className="grid grid-cols-5 gap-1 md:grid-cols-3"
              role="group"
              aria-label="Brushes"
            >
              {BRUSHES.map((b, i) => {
                const Icon = BRUSH_ICONS[b];
                return (
                  <button
                    key={b}
                    type="button"
                    aria-pressed={tool.brush === b}
                    title={`${BRUSH_INFO[b].note} (${i + 1})`}
                    onClick={() => set({ brush: b, turnView: false })}
                    data-testid={`brush-${b}`}
                    className={cx(
                      "flex flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-2xs transition-colors",
                      tool.brush === b
                        ? "bg-accent text-ink-950"
                        : "bg-ink-800 text-ink-200 hover:bg-ink-750",
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {BRUSH_INFO[b].name}
                  </button>
                );
              })}
            </div>
            <p
              className="mt-1.5 text-2xs text-ink-400"
              data-testid="brush-note"
            >
              {info.name}: {info.note}
            </p>
            {tool.brush === "paint" && (
              <div className="mt-2" data-testid="paint-options">
                <div className="flex items-center gap-2">
                  <label htmlFor="paint-color" className="text-xs text-ink-300">
                    Colour
                  </label>
                  <input
                    id="paint-color"
                    type="color"
                    value={tool.color}
                    onChange={(e) => set({ color: e.target.value })}
                    className="h-7 w-10 cursor-pointer rounded border border-ink-700 bg-transparent"
                    data-testid="paint-color"
                  />
                  <span className="text-2xs tabular-nums text-ink-400">
                    {tool.color}
                  </span>
                </div>
                <div
                  className="mt-1.5 grid grid-cols-10 gap-1"
                  role="group"
                  aria-label="Paint colours"
                >
                  {PAINT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      title={c}
                      aria-label={`Paint colour ${c}`}
                      aria-pressed={tool.color === c}
                      onClick={() => set({ color: c, invert: false })}
                      data-testid={`paint-swatch-${c.slice(1)}`}
                      className={cx(
                        "aspect-square rounded border-2",
                        tool.color === c
                          ? "border-accent"
                          : "border-transparent hover:border-ink-500",
                      )}
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1.5 w-full"
                  onClick={() => engine.current?.layerOp("clearPaint")}
                  data-testid="paint-clear"
                >
                  Clear all paint
                </Button>
              </div>
            )}
            {tool.brush === "mask" && (
              <div
                className="mt-2 grid grid-cols-2 gap-1"
                data-testid="mask-options"
              >
                <Button
                  size="sm"
                  onClick={() => engine.current?.layerOp("invertMask")}
                  data-testid="mask-invert"
                >
                  Invert mask
                </Button>
                <Button
                  size="sm"
                  onClick={() => engine.current?.layerOp("clearMask")}
                  data-testid="mask-clear"
                >
                  Clear mask
                </Button>
                <p className="col-span-2 text-2xs text-ink-400">
                  Masked areas show darker, and the sculpting brushes leave them
                  as they are.
                </p>
              </div>
            )}
          </Section>
          <Section title="Stroke" testId="sculpt-section-stroke">
            <Slider
              label="Size"
              value={tool.sizePx}
              min={10}
              max={200}
              step={5}
              unit=" px"
              testId="sculpt-size"
              onChange={(sizePx) => set({ sizePx })}
            />
            <Slider
              label="Strength"
              value={Math.round(tool.strength * 100)}
              min={5}
              max={100}
              step={5}
              unit="%"
              testId="sculpt-strength"
              hint="With a pen, pressing harder adds strength."
              onChange={(v) => set({ strength: v / 100 })}
            />
            <Toggle
              label="Subtract"
              checked={tool.invert}
              onChange={(invert) => set({ invert })}
              disabled={
                tool.brush === "smooth" ||
                tool.brush === "flatten" ||
                tool.brush === "grab"
              }
              hint={
                SUBTRACT_HINT[tool.brush] ??
                "Dig in, shrink or push apart instead."
              }
              testId="sculpt-subtract"
            />
          </Section>
          <Section title="Symmetry & view" testId="sculpt-section-view">
            <Toggle
              label="Symmetry"
              checked={tool.symmetry}
              onChange={(symmetry) => set({ symmetry })}
              hint="Every stroke is mirrored left to right."
              testId="sculpt-symmetry"
            />
            <Toggle
              label="Turn view"
              checked={!!tool.turnView}
              onChange={(turnView) => set({ turnView })}
              hint="Every drag turns the view, even on the clay: handy on a phone."
              testId="sculpt-turn-view"
            />
            <Button
              size="sm"
              icon={Move3d}
              className="mt-1 w-full"
              onClick={() => engine.current?.frameView()}
              data-testid="sculpt-frame"
            >
              Frame the sculpture
            </Button>
          </Section>
          <Section title="Material" testId="sculpt-section-material">
            <div
              className="grid grid-cols-9 gap-1 md:grid-cols-6"
              role="group"
              aria-label="Clay material"
            >
              {LOOKS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  title={m.name}
                  aria-label={m.name}
                  aria-pressed={look === m.id}
                  onClick={() => {
                    setLook(m.id);
                    setEntry((cur) => (cur ? { ...cur, look: m.id } : cur));
                    scheduleSave();
                  }}
                  data-testid={`sculpt-material-${m.id}`}
                  className={cx(
                    "aspect-square rounded-md border-2",
                    look === m.id
                      ? "border-accent"
                      : "border-transparent hover:border-ink-500",
                  )}
                  style={{ background: m.color }}
                />
              ))}
            </div>
          </Section>
          <p className="mt-2 text-2xs text-ink-400" data-testid="sculpt-status">
            {note ??
              (pending
                ? "Saving…"
                : entry?.updatedAt
                  ? `Saved on this device · ${(entry.triangles ?? 0).toLocaleString("en")} triangles`
                  : "Saved on this device after your first stroke.")}
          </p>
          <Tip className="mt-2">
            <Wind className="mr-1 inline h-3 w-3" aria-hidden />
            Sculptures stay on this device. Export a copy to keep it safe or to
            print it.
          </Tip>
        </aside>
      </div>

      <ShortcutsDialog
        open={dialog === "shortcuts"}
        onClose={() => setDialog(null)}
        list={SCULPT_SHORTCUTS}
      />
      <NewDialog
        open={dialog === "new"}
        onClose={() => setDialog(null)}
        onPick={(s) => {
          startNew(s);
          setDialog(null);
        }}
      />
      <OpenDialog
        open={dialog === "open"}
        onClose={() => setDialog(null)}
        saved={saved}
        current={entry?.id}
        onOpen={(id) => {
          void open(id);
          setDialog(null);
        }}
        onDelete={async (id) => {
          await deleteSculpt(id);
          setSaved(await listSculpts());
          if (id === entry?.id) startNew("sphere");
        }}
      />
      <ExportDialog
        open={dialog === "export"}
        onClose={() => setDialog(null)}
        engine={engine}
        name={entry?.name ?? "sculpture"}
        onDone={setNote}
      />
    </main>
  );
}

function NewDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (s: ShapeId) => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New sculpture"
      testId="sculpt-new-dialog"
    >
      <p className="text-sm text-ink-200">
        Start from a shape. The sculpture you were working on stays saved on
        this device.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {SHAPES.map((s) => (
          <Button
            key={s}
            onClick={() => onPick(s)}
            data-testid={`sculpt-new-${s}`}
          >
            {SHAPE_NAMES[s]}
          </Button>
        ))}
      </div>
    </Dialog>
  );
}

function OpenDialog({
  open,
  onClose,
  saved,
  current,
  onOpen,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  saved: SculptEntry[];
  current?: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Sculptures on this device"
      testId="sculpt-open-dialog"
    >
      {saved.length === 0 ? (
        <p className="text-sm text-ink-300">
          None saved yet: sculpt something first.
        </p>
      ) : (
        <ul className="space-y-1">
          {saved.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onOpen(s.id)}
                data-testid={`sculpt-open-${s.id}`}
                className={cx(
                  "min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-sm hover:bg-ink-800",
                  s.id === current && "bg-ink-800",
                )}
              >
                <span className="block truncate text-ink-100">{s.name}</span>
                <span className="text-2xs text-ink-400">
                  {new Date(s.updatedAt).toLocaleString()} ·{" "}
                  {s.triangles.toLocaleString("en")} triangles
                </span>
              </button>
              <IconButton
                icon={Trash2}
                size="sm"
                label={`Delete ${s.name}`}
                onClick={() => onDelete(s.id)}
                data-testid={`sculpt-delete-${s.id}`}
              />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function ExportDialog({
  open,
  onClose,
  engine,
  name,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  engine: React.RefObject<SculptEngine | null>;
  name: string;
  onDone: (note: string) => void;
}) {
  const [format, setFormat] = useState<"stl" | "glb" | "blender">("stl");
  const [heightMm, setHeightMm] = useState(100);
  /** GLB: texture maps this size ("0": paint as vertex colours). */
  const [maps, setMaps] = useState<"0" | "1024" | "2048" | "4096">("2048");
  /** Jobs the server's Blender can do (none: no Blender option). */
  const [blenderJobs, setBlenderJobs] = useState<Record<string, boolean>>({});
  const blender = Object.values(blenderJobs).some(Boolean);
  const [job, setJob] = useState<"fbx" | "usd" | "quads" | "render">("fbx");
  const [faces, setFaces] = useState(8000);
  const [renderer, setRenderer] = useState<"eevee" | "cycles">("eevee");
  const [stage, setStage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch("/api/blender")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live) return;
        const jobs = (j?.available && j.jobs) || {};
        setBlenderJobs(jobs);
        // Start on a job this server can do.
        const first = (["fbx", "usd", "quads", "render"] as const).find(
          (k) => jobs[k],
        );
        if (first) setJob((cur) => (jobs[cur] ? cur : first));
      })
      .catch(() => live && setBlenderJobs({}));
    return () => {
      live = false;
    };
  }, [open]);
  const onStage = (st: "unwrap" | "bake" | "write") =>
    setStage(
      st === "unwrap"
        ? "Unfolding the surface…"
        : st === "bake"
          ? "Baking the textures…"
          : "Writing the file…",
    );

  async function runBlender(e: SculptEngine) {
    // The GLB is built here as for a GLB export (clean quads drops the
    // textures: the new surface has none), then Blender does the job.
    const size = job === "quads" ? 0 : Number(maps);
    const glb = await e.exportGlb({ textureSize: size || undefined, onStage });
    setStage(
      job === "render" ? "Rendering in Blender…" : "Blender is working…",
    );
    const path =
      job === "fbx" || job === "usd"
        ? `convert?format=${job}`
        : job === "quads"
          ? `retopo?faces=${faces}`
          : `render?engine=${renderer}&size=1080p`;
    const res = await fetch(`/api/blender/${path}`, {
      method: "POST",
      body: glb,
      headers: { "Content-Type": "model/gltf-binary" },
    });
    if (!res.ok) {
      const why = await res.json().catch(() => null);
      throw new Error(why?.error ?? "Blender couldn't finish that job.");
    }
    const out = await res.blob();
    const [ext, note] = {
      fbx: [".fbx", "Exported an FBX file (Blender)."],
      usd: [".usdc", "Exported a USD file (Blender)."],
      quads: [
        "-quads.glb",
        `Exported a clean quad mesh, about ${faces.toLocaleString()} faces (Blender).`,
      ],
      render: [".png", "Rendered a 1920 × 1080 image (Blender)."],
    }[job];
    downloadBlob(out, `${slug(name)}${ext}`);
    onDone(note);
  }

  async function run() {
    const e = engine.current;
    if (!e?.mesh) return;
    setBusy(true);
    setError(null);
    try {
      if (format === "blender") {
        await runBlender(e);
      } else if (format === "stl") {
        const r = toStl(
          { positions: triangles(e.mesh), triangles: faceCount(e.mesh) },
          heightMm,
        );
        downloadBlob(r.blob, `${slug(name)}.stl`);
        const [w, d, h] = r.sizeMm.map((v) => Math.round(v));
        onDone(`Exported for 3D printing: ${w} × ${d} × ${h} mm.`);
      } else {
        const size = Number(maps);
        const blob = await e.exportGlb({
          textureSize: size || undefined,
          onStage,
        });
        downloadBlob(blob, `${slug(name)}.glb`);
        onDone(
          size
            ? `Exported a GLB with ${size} × ${size} texture maps (${(blob.size / 1e6).toFixed(1)} MB).`
            : "Exported a GLB file.",
        );
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export sculpture"
      testId="sculpt-export-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Download}
            disabled={busy}
            onClick={run}
            data-testid="sculpt-export-confirm"
          >
            {busy
              ? (stage ?? "Exporting…")
              : format === "stl"
                ? "Export STL"
                : format === "glb"
                  ? "Export GLB"
                  : {
                      fbx: "Export FBX",
                      usd: "Export USD",
                      quads: "Export clean quads",
                      render: "Render image",
                    }[job]}
          </Button>
        </>
      }
    >
      <Segmented
        label="Format"
        value={format}
        testIdPrefix="sculpt-export-format"
        options={[
          { value: "stl", label: "STL · 3D printing" },
          { value: "glb", label: "GLB · 3D tools" },
          ...(blender ? [{ value: "blender" as const, label: "Blender" }] : []),
        ]}
        onChange={setFormat}
      />
      {format === "blender" && (
        <>
          <Segmented
            label="Blender"
            value={job}
            testIdPrefix="sculpt-export-job"
            options={(
              [
                { value: "fbx", label: "FBX" },
                { value: "usd", label: "USD" },
                { value: "quads", label: "Clean quads" },
                { value: "render", label: "Render" },
              ] as const
            ).filter((o) => blenderJobs[o.value])}
            onChange={setJob}
          />
          <p className="mt-1 text-2xs leading-relaxed text-ink-300">
            {
              {
                fbx: "For Unity, Unreal and most 3D tools, with its texture maps.",
                usd: "For film pipelines (Omniverse, Houdini, USD viewers), with its texture maps.",
                quads:
                  "The surface rebuilt as even quads: light and ready to rig. Paint and surface detail finer than the new faces are left out.",
                render:
                  "A 1920 × 1080 image in a studio setup: three-point lights, floor and backdrop.",
              }[job]
            }
          </p>
          {job === "quads" && (
            <Slider
              label="Faces"
              value={faces}
              min={1000}
              max={50000}
              step={1000}
              testId="sculpt-export-faces"
              hint="More faces keep more detail"
              onChange={setFaces}
            />
          )}
          {job === "render" && (
            <Segmented
              label="Renderer"
              value={renderer}
              testIdPrefix="sculpt-export-renderer"
              options={[
                { value: "eevee", label: "EEVEE · fast" },
                { value: "cycles", label: "Cycles · realistic" },
              ]}
              onChange={setRenderer}
            />
          )}
        </>
      )}
      {format === "blender" && job !== "quads" && (
        <Segmented
          label="Texture maps"
          value={maps}
          testIdPrefix="sculpt-export-maps"
          options={[
            { value: "0", label: "None" },
            { value: "1024", label: "1K" },
            { value: "2048", label: "2K" },
            { value: "4096", label: "4K" },
          ]}
          onChange={setMaps}
        />
      )}
      {format === "blender" ? null : format === "stl" ? (
        <Slider
          label="Height"
          value={heightMm}
          min={20}
          max={500}
          step={5}
          unit=" mm"
          testId="sculpt-export-height"
          hint="The printed sculpture's height, standing on the bed"
          onChange={setHeightMm}
        />
      ) : (
        <>
          <Segmented
            label="Texture maps"
            value={maps}
            testIdPrefix="sculpt-export-maps"
            options={[
              { value: "0", label: "None" },
              { value: "1024", label: "1K" },
              { value: "2048", label: "2K" },
              { value: "4096", label: "4K" },
            ]}
            onChange={setMaps}
          />
          <p className="mt-1 text-2xs leading-relaxed text-ink-300">
            {maps === "0"
              ? "The sculpture with its material; paint as vertex colours (Blender shows them; many game engines don't)."
              : "The surface is unfolded and its look (material, surface, paint) baked into a colour texture and a roughness/metal texture: what Unity, Unreal, Godot and Blender expect. Bigger is sharper but takes longer."}
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}
