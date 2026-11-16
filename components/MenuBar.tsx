"use client";

/** The app's menu bar (File / Edit / View / Help), shared by the pages.
 *
 * Desktop and tablet: one button per menu, each opening a dropdown. On
 * a phone the bar doesn't fit, so `compact` shows one "Menu" button
 * with every menu as a group in it.
 *
 * Built to the ARIA menu pattern: the button has aria-haspopup and
 * aria-expanded; items are menuitem (or menuitemcheckbox, with
 * aria-checked); arrow keys move between items, Left/Right between
 * menus, Home/End to the ends, Escape closes and returns focus to the
 * button; a click outside closes. */

import { Check, ChevronDown, Menu as MenuIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cx } from "@/components/studio/ui";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  shortcut?: string;
  disabled?: boolean;
  /** A toggle: shown with a tick, announced as checked or not. */
  checked?: boolean;
  icon?: LucideIcon;
  testId?: string;
}
export type MenuEntry = MenuItem | "separator";
export interface Menu {
  id: string;
  label: string;
  items: MenuEntry[];
}

const isItem = (e: MenuEntry): e is MenuItem => e !== "separator";

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
            ...m.items,
          ]),
        },
      ]
    : menus;
  const [open, setOpen] = useState<string | null>(null);
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

  return (
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
        />
      ))}
    </div>
  );
}

function MenuButton({
  menu,
  compact,
  popupId,
  open,
  setRef,
  onToggle,
  onOpen,
  onClose,
  onSide,
}: {
  menu: Menu;
  compact: boolean;
  popupId: string;
  open: boolean;
  setRef: (el: HTMLButtonElement | null) => void;
  onToggle: () => void;
  onOpen: () => void;
  onClose: (focusButton: boolean) => void;
  onSide: (dir: 1 | -1) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const items = () =>
    Array.from(
      list.current?.querySelectorAll<HTMLButtonElement>(
        "[role^=menuitem]:not([disabled])",
      ) ?? [],
    );

  // Opening moves focus to the first item; if every item is disabled
  // (Undo and Redo with nothing done), to the menu itself, so Escape and
  // the arrows still work from there.
  useEffect(() => {
    if (open) (items()[0] ?? list.current)?.focus();
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => all[(i + all.length) % all.length]?.focus();
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(all.length - 1);
    else if (e.key === "ArrowRight") onSide(1);
    else if (e.key === "ArrowLeft") onSide(-1);
    else if (e.key === "Escape") onClose(true);
    else if (e.key === "Tab") onClose(false);
    else return;
    e.preventDefault();
  };

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
        <div
          ref={list}
          id={popupId}
          role="menu"
          aria-label={menu.label}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          data-testid={`menu-${menu.id}-list`}
          className="absolute left-0 top-full z-50 mt-1 min-w-56 rounded-lg border border-ink-700 bg-ink-850 p-1 shadow-2xl shadow-black/60"
        >
          {menu.items.map((e, i) =>
            isItem(e) ? (
              <button
                key={`${e.label}-${i}`}
                type="button"
                role={e.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                aria-checked={e.checked === undefined ? undefined : e.checked}
                disabled={e.disabled}
                data-testid={e.testId}
                onClick={() => {
                  onClose(true);
                  e.onSelect();
                }}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-ink-100 hover:bg-ink-700 focus:bg-ink-700 focus:outline-none disabled:text-ink-500 disabled:hover:bg-transparent"
              >
                <span className="flex w-4 justify-center" aria-hidden>
                  {e.checked ? (
                    <Check className="h-3.5 w-3.5 text-accent" />
                  ) : e.icon ? (
                    <e.icon className="h-3.5 w-3.5 text-ink-300" />
                  ) : null}
                </span>
                <span className="flex-1">{e.label}</span>
                {e.shortcut && (
                  <span className="text-2xs text-ink-400">{e.shortcut}</span>
                )}
              </button>
            ) : (
              <div
                key={`sep-${i}`}
                role="separator"
                className="my-1 h-px bg-ink-750"
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}
