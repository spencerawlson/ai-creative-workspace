"use client";

/** The app's menu bar (File / Edit / View / Help), shared by the pages.
 *
 * It works the way a 3D package's menus do:
 * - once a menu is open, moving across the bar opens the others;
 * - menus are grouped under labelled dividers, with cascading submenus
 *   (▸) for longer choices;
 * - an item can carry an option box (□) at its end, opening that
 *   item's settings rather than doing it straight away;
 * - the dashed strip at the top of a menu tears it off into a floating
 *   panel that stays open (drag it by its title; × puts it away), for
 *   the menus you keep going back to.
 *
 * On a phone the bar doesn't fit, so `compact` shows one "Menu" button
 * with every menu as a group in it (submenus inline, no tear-offs).
 *
 * Built to the ARIA menu pattern: the buttons have aria-haspopup and
 * aria-expanded; items are menuitem (or menuitemcheckbox, with
 * aria-checked); Up/Down move between items, Home/End to the ends,
 * Right opens a submenu (Left or Escape closes it), Left/Right at the
 * top level move between menus, Escape closes and returns focus to the
 * button; a click outside closes. */

import {
  Check,
  ChevronDown,
  ChevronRight,
  Menu as MenuIcon,
  Square,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "@/components/studio/ui";

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  shortcut?: string;
  disabled?: boolean;
  /** A toggle: shown with a tick, announced as checked or not. */
  checked?: boolean;
  icon?: LucideIcon;
  testId?: string;
  /** An option box (□) at the row's end: this item's settings. */
  options?: () => void;
  /** A cascading submenu, opening to the side. */
  submenu?: MenuEntry[];
}
/** A labelled divider between groups of items. */
export interface MenuHeading {
  heading: string;
}
export type MenuEntry = MenuItem | MenuHeading | "separator";
export interface Menu {
  id: string;
  label: string;
  items: MenuEntry[];
}

const isItem = (e: MenuEntry): e is MenuItem =>
  typeof e === "object" && "label" in e;
const isHeading = (e: MenuEntry): e is MenuHeading =>
  typeof e === "object" && "heading" in e;

/** Submenus inline, under their own heading (phones). */
function flatten(entries: MenuEntry[]): MenuEntry[] {
  return entries.flatMap((e) =>
    isItem(e) && e.submenu
      ? [{ heading: e.label } as MenuEntry, ...flatten(e.submenu)]
      : [e],
  );
}

/** True on phone-width screens (below Tailwind's md), where the bar
 * folds into one "Menu" button. False until mounted (server render). */
export function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 767px)");
    const update = () => setNarrow(q.matches);
    update();
    q.addEventListener("change", update);
    return () => q.removeEventListener("change", update);
  }, []);
  return narrow;
}

interface Torn {
  id: string;
  x: number;
  y: number;
}

export function MenuBar({
  menus,
  compact = false,
  className,
}: {
  menus: Menu[];
  compact?: boolean;
  className?: string;
}) {
  // Phones: one menu holding every group.
  const shown: Menu[] = compact
    ? [
        {
          id: "all",
          label: "Menu",
          items: menus.flatMap((m, i) => [
            ...(i ? (["separator"] as MenuEntry[]) : []),
            ...flatten(m.items),
          ]),
        },
      ]
    : menus;
  const [open, setOpen] = useState<string | null>(null);
  const [torn, setTorn] = useState<Torn[]>([]);
  const bar = useRef<HTMLDivElement>(null);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const base = useId();

  const close = useCallback((focusButton?: string) => {
    setOpen(null);
    if (focusButton) buttons.current[focusButton]?.focus();
  }, []);

  // A click or tap outside closes.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  const tearOff = (id: string) => {
    const r = buttons.current[id]?.getBoundingClientRect();
    setOpen(null);
    setTorn((list) =>
      list.some((t) => t.id === id)
        ? list
        : [...list, { id, x: r ? r.left : 80, y: r ? r.bottom + 8 : 80 }],
    );
  };

  return (
    <>
      <div
        ref={bar}
        role="menubar"
        aria-label="Main menu"
        className={cx("flex items-center gap-0.5", className)}
      >
        {shown.map((m, mi) => (
          <MenuButton
            key={m.id}
            menu={m}
            compact={compact}
            popupId={`${base}-${m.id}`}
            open={open === m.id}
            anyOpen={open !== null}
            setRef={(el) => {
              buttons.current[m.id] = el;
            }}
            onToggle={() => setOpen(open === m.id ? null : m.id)}
            onOpen={() => setOpen(m.id)}
            onClose={(focus) => close(focus ? m.id : undefined)}
            onSide={(dir) => {
              const next = shown[(mi + dir + shown.length) % shown.length];
              setOpen(next.id);
              buttons.current[next.id]?.focus();
            }}
            onTearOff={compact ? undefined : () => tearOff(m.id)}
          />
        ))}
      </div>
      {!compact &&
        torn.map((t) => {
          const menu = menus.find((m) => m.id === t.id);
          return menu ? (
            <TornMenu
              key={t.id}
              menu={menu}
              at={t}
              onMove={(x, y) =>
                setTorn((list) =>
                  list.map((o) => (o.id === t.id ? { ...o, x, y } : o)),
                )
              }
              onClose={() =>
                setTorn((list) => list.filter((o) => o.id !== t.id))
              }
            />
          ) : null;
        })}
    </>
  );
}

function MenuButton({
  menu,
  compact,
  popupId,
  open,
  anyOpen,
  setRef,
  onToggle,
  onOpen,
  onClose,
  onSide,
  onTearOff,
}: {
  menu: Menu;
  compact: boolean;
  popupId: string;
  open: boolean;
  anyOpen: boolean;
  setRef: (el: HTMLButtonElement | null) => void;
  onToggle: () => void;
  onOpen: () => void;
  onClose: (focusButton: boolean) => void;
  onSide: (dir: 1 | -1) => void;
  onTearOff?: () => void;
}) {
  return (
    <div className="relative">
      <button
        ref={setRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        data-testid={`menu-${menu.id}`}
        onClick={onToggle}
        // With a menu open, moving across the bar opens the others.
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse" && anyOpen && !open) onOpen();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          } else if (e.key === "ArrowRight") onSide(1);
          else if (e.key === "ArrowLeft") onSide(-1);
          else if (open && e.key === "Escape") {
            e.preventDefault();
            onClose(true);
          } else if (open && e.key === "Tab") onClose(false);
        }}
        className={cx(
          "flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors",
          open
            ? "bg-ink-700 text-ink-100"
            : "text-ink-200 hover:bg-ink-800 hover:text-ink-100",
        )}
      >
        {compact && <MenuIcon className="h-4 w-4" aria-hidden />}
        {menu.label}
        {compact && <ChevronDown className="h-3 w-3" aria-hidden />}
      </button>
      {open && (
        <MenuList
          id={popupId}
          label={menu.label}
          entries={menu.items}
          testId={`menu-${menu.id}-list`}
          autoFocus
          onSelected={() => onClose(true)}
          onOuterKey={(e) => {
            if (e.key === "ArrowRight") onSide(1);
            else if (e.key === "ArrowLeft") onSide(-1);
            else if (e.key === "Escape") onClose(true);
            else if (e.key === "Tab") onClose(false);
            else return false;
            return true;
          }}
          onTearOff={onTearOff}
          className="absolute left-0 top-full z-50 mt-1"
        />
      )}
    </div>
  );
}

/** One list of items: a dropdown, a submenu, or a torn-off panel. */
function MenuList({
  id,
  label,
  entries,
  testId,
  autoFocus = false,
  onSelected,
  onOuterKey,
  onBack,
  onTearOff,
  className,
  listRef,
}: {
  id: string;
  label: string;
  entries: MenuEntry[];
  testId?: string;
  autoFocus?: boolean;
  /** After an item ran (a dropdown closes; a torn-off panel stays). */
  onSelected: () => void;
  /** Keys this list doesn't use (top level: other menus, closing). */
  onOuterKey?: (e: ReactKeyboardEvent) => boolean;
  /** A submenu: Left or Escape goes back to its item. */
  onBack?: () => void;
  onTearOff?: () => void;
  className?: string;
  listRef?: RefObject<HTMLDivElement | null>;
}) {
  const own = useRef<HTMLDivElement>(null);
  const list = listRef ?? own;
  const [sub, setSub] = useState<number | null>(null);
  const subItem = useRef<Record<number, HTMLButtonElement | null>>({});
  const items = () =>
    Array.from(
      list.current?.querySelectorAll<HTMLButtonElement>(
        `[data-owner="${id}"]:not([disabled])`,
      ) ?? [],
    );

  // Opening moves focus to the first item; if every item is disabled
  // (Undo and Redo with nothing done), to the menu itself, so Escape and
  // the arrows still work from there.
  useEffect(() => {
    if (autoFocus) (items()[0] ?? list.current)?.focus();
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => all[(i + all.length) % all.length]?.focus();
    const current = all[at];
    const subAt = current?.dataset.sub;
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(all.length - 1);
    else if (e.key === "ArrowRight" && subAt !== undefined)
      setSub(Number(subAt));
    else if (onBack && (e.key === "ArrowLeft" || e.key === "Escape")) onBack();
    else if (!onOuterKey?.(e)) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const row =
    "flex h-7 w-full items-center gap-2 rounded px-2 text-left text-xs text-ink-100 hover:bg-ink-700 focus:bg-ink-700 focus:outline-none disabled:text-ink-500 disabled:hover:bg-transparent";

  return (
    <div
      ref={list}
      id={id}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-testid={testId}
      className={cx(
        "min-w-56 rounded-md border border-ink-700 bg-ink-850 p-1 shadow-2xl shadow-black/60",
        className,
      )}
    >
      {onTearOff && (
        <button
          type="button"
          role="menuitem"
          data-owner={id}
          aria-label={`Tear off ${label} (keep it open as a panel)`}
          title="Tear off: keep this menu open as a panel"
          onClick={onTearOff}
          onPointerEnter={() => setSub(null)}
          data-testid={testId?.replace(/-list$/, "-tearoff")}
          className="mb-1 flex h-3 w-full items-center rounded px-1 hover:bg-ink-700 focus:bg-ink-700 focus:outline-none"
        >
          <span className="h-0 w-full border-t border-dashed border-ink-500" />
        </button>
      )}
      {entries.map((e, i) => {
        if (e === "separator")
          return (
            <div
              key={`sep-${i}`}
              role="separator"
              className="my-1 h-px bg-ink-750"
            />
          );
        if (isHeading(e))
          return (
            <div
              key={`h-${i}`}
              role="separator"
              aria-label={e.heading}
              className="mt-1 flex items-center gap-2 px-2 pb-0.5 pt-1 text-2xs font-semibold uppercase tracking-wider text-ink-400 first:mt-0"
            >
              <span>{e.heading}</span>
              <span className="h-px flex-1 bg-ink-750" aria-hidden />
            </div>
          );
        const lead = (
          <span className="flex w-4 justify-center" aria-hidden>
            {e.checked ? (
              <Check className="h-3.5 w-3.5 text-accent" />
            ) : e.icon ? (
              <e.icon className="h-3.5 w-3.5 text-ink-300" />
            ) : null}
          </span>
        );
        if (e.submenu) {
          const opened = sub === i;
          return (
            <div key={`${e.label}-${i}`} className="relative">
              <button
                ref={(el) => {
                  subItem.current[i] = el;
                }}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={opened}
                data-owner={id}
                data-sub={i}
                disabled={e.disabled}
                data-testid={e.testId}
                onClick={() => setSub(i)} // open (a hover may have already)
                onPointerEnter={(p) => {
                  if (p.pointerType === "mouse") setSub(i);
                }}
                className={cx(row, opened && "bg-ink-700")}
              >
                {lead}
                <span className="flex-1">{e.label}</span>
                <ChevronRight
                  className="h-3.5 w-3.5 text-ink-400"
                  aria-hidden
                />
              </button>
              {opened && (
                <MenuList
                  id={`${id}-${i}`}
                  label={e.label}
                  entries={e.submenu}
                  autoFocus
                  onSelected={onSelected}
                  onBack={() => {
                    setSub(null);
                    subItem.current[i]?.focus();
                  }}
                  testId={e.testId ? `${e.testId}-list` : undefined}
                  className="absolute left-full top-0 z-50 -mt-1 ml-1"
                />
              )}
            </div>
          );
        }
        const run = () => {
          onSelected();
          e.onSelect?.();
        };
        const main = (
          <button
            type="button"
            role={e.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={e.checked === undefined ? undefined : e.checked}
            data-owner={id}
            disabled={e.disabled}
            data-testid={e.testId}
            onClick={run}
            onPointerEnter={() => setSub(null)}
            className={row}
          >
            {lead}
            <span className="flex-1">{e.label}</span>
            {e.shortcut && (
              <span className="pl-4 text-2xs tabular-nums text-ink-400">
                {e.shortcut}
              </span>
            )}
          </button>
        );
        if (!e.options) return <div key={`${e.label}-${i}`}>{main}</div>;
        const options = e.options;
        return (
          <div key={`${e.label}-${i}`} className="flex items-center gap-0.5">
            <div className="min-w-0 flex-1">{main}</div>
            <button
              type="button"
              role="menuitem"
              data-owner={id}
              aria-label={`${e.label}: options`}
              title="Options"
              disabled={e.disabled}
              data-testid={e.testId ? `${e.testId}-options` : undefined}
              onClick={() => {
                onSelected();
                options();
              }}
              onPointerEnter={() => setSub(null)}
              className="grid h-7 w-6 shrink-0 place-items-center rounded text-ink-300 hover:bg-ink-700 hover:text-ink-100 focus:bg-ink-700 focus:outline-none disabled:text-ink-600"
            >
              <Square className="h-3 w-3" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** A torn-off menu: a floating panel that stays open. Its items work
 * as in the menu (toggles show their state live); it moves by its
 * title bar and goes away with ×. */
function TornMenu({
  menu,
  at,
  onMove,
  onClose,
}: {
  menu: Menu;
  at: { x: number; y: number };
  onMove: (x: number, y: number) => void;
  onClose: () => void;
}) {
  const base = useId();
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={`${menu.label} (torn off)`}
      data-testid={`torn-${menu.id}`}
      className="fixed z-40 rounded-md border border-ink-700 bg-ink-850 shadow-2xl shadow-black/60"
      style={{ left: at.x, top: at.y }}
    >
      <div
        className="flex h-7 cursor-move touch-none select-none items-center justify-between gap-2 rounded-t-md border-b border-ink-750 bg-ink-800 pl-2.5 pr-1 text-2xs font-semibold uppercase tracking-wider text-ink-300"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { dx: e.clientX - at.x, dy: e.clientY - at.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const w = panel.current?.offsetWidth ?? 200;
          onMove(
            Math.min(Math.max(0, e.clientX - d.dx), window.innerWidth - w),
            Math.min(Math.max(0, e.clientY - d.dy), window.innerHeight - 28),
          );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        {menu.label}
        <button
          type="button"
          aria-label={`Close the ${menu.label} panel`}
          onClick={onClose}
          data-testid={`torn-${menu.id}-close`}
          className="grid h-5 w-5 place-items-center rounded text-ink-400 hover:bg-ink-700 hover:text-ink-100"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <MenuList
        id={`${base}-torn`}
        label={menu.label}
        entries={menu.items}
        onSelected={() => {}}
        className="border-0 shadow-none"
      />
    </div>,
    document.body,
  );
}
