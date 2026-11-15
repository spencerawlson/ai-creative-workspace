"use client";

/** The app's navigation, the same on every page:
 * - BrandLink: the logo, home.
 * - WorkspaceRail: the left sidebar's top group, Studio / Sculpt /
 *   Photography with icons and labels (pages with a sidebar).
 * - WorkspaceTabs: the same as tabs in a top bar (pages without one).
 * - WorkspaceMenu: one button with a menu, where there's no room for
 *   either (phones).
 * - RailButton: a labelled sidebar button, for a page's own tools. */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Camera,
  Check,
  ChevronDown,
  Clapperboard,
  Hammer,
  House,
  type LucideIcon,
} from "lucide-react";
import { cx } from "@/components/studio/ui";

export type Workspace = "studio" | "sculpt" | "photography";

export const WORKSPACES: Array<{
  id: Workspace;
  href: string;
  label: string;
  /** A shorter label for the narrow sidebar. */
  short?: string;
  note: string;
  icon: LucideIcon;
}> = [
  {
    id: "studio",
    href: "/studio",
    label: "Studio",
    note: "Light, pose and animate figures",
    icon: Clapperboard,
  },
  {
    id: "sculpt",
    href: "/sculpt",
    label: "Sculpt",
    note: "Shape digital clay with brushes",
    icon: Hammer,
  },
  {
    id: "photography",
    href: "/photography",
    label: "Photography",
    short: "Photo",
    note: "Learn framing, lenses and exposure",
    icon: Camera,
  },
];

/** The logo, linking home; the name beside it on wide screens. */
export function BrandLink() {
  return (
    <Link
      href="/"
      aria-label="I-K-O 3D home"
      title="Home"
      className="flex shrink-0 items-center gap-2 rounded-md p-0.5 hover:bg-ink-800"
      data-testid="nav-home"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a 28 px static logo */}
      <img
        src="/brand/iko-logo-128.png"
        alt=""
        width={28}
        height={28}
        className="h-7 w-7"
      />
      <span className="hidden text-sm font-semibold tracking-tight text-ink-100 lg:inline">
        I-K-O 3D
      </span>
    </Link>
  );
}

/** A sidebar button: an icon with its label under it. A link (`href`)
 * or a button (`onClick`); `active` marks the current one with a bar
 * on the sidebar's edge. */
export function RailButton({
  icon: Icon,
  label,
  active,
  href,
  onClick,
  title,
  testId,
  current,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  href?: string;
  onClick?: () => void;
  title?: string;
  testId?: string;
  /** For a link: this is the page you're on. */
  current?: boolean;
}) {
  const body = (
    <>
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-1.5 left-0 w-0.5 rounded-r bg-accent"
        />
      )}
      <Icon
        aria-hidden
        className={cx("h-[18px] w-[18px]", active && "text-accent")}
      />
      <span className="mt-1 max-w-full truncate px-0.5 text-[10px] font-medium leading-none">
        {label}
      </span>
    </>
  );
  const className = cx(
    "relative flex h-14 w-14 flex-col items-center justify-center rounded-lg transition-colors",
    active
      ? "bg-ink-800 text-ink-100"
      : "text-ink-400 hover:bg-ink-850 hover:text-ink-100",
  );
  return href ? (
    <Link
      href={href}
      title={title}
      aria-current={current ? "page" : undefined}
      data-testid={testId}
      className={className}
    >
      {body}
    </Link>
  ) : (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      className={className}
    >
      {body}
    </button>
  );
}

/** The sidebar: the workspaces on top, then this page's own tools
 * (`children`), then `footer` at the bottom. */
export function Sidebar({
  current,
  children,
  footer,
  label = "Workspaces and tools",
}: {
  current: Workspace;
  children?: ReactNode;
  footer?: ReactNode;
  label?: string;
}) {
  return (
    <div
      className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-ink-800 bg-ink-900 py-2"
      aria-label={label}
      role="group"
    >
      <WorkspaceRail current={current} />
      {children && (
        <>
          <div aria-hidden className="my-1.5 h-px w-9 bg-ink-750" />
          {children}
        </>
      )}
      {footer && (
        <div className="mt-auto flex flex-col items-center gap-1">{footer}</div>
      )}
    </div>
  );
}

/** The workspaces as labelled sidebar links. */
export function WorkspaceRail({ current }: { current: Workspace }) {
  return (
    <nav aria-label="Workspaces" className="flex flex-col items-center gap-1">
      {WORKSPACES.map((w) => (
        <RailButton
          key={w.id}
          icon={w.icon}
          label={w.short ?? w.label}
          href={w.href}
          title={`${w.label}: ${w.note}`}
          active={w.id === current}
          current={w.id === current}
          testId={`nav-${w.id}`}
        />
      ))}
    </nav>
  );
}

/** The workspaces as tabs in a top bar. */
export function WorkspaceTabs({
  current,
  className,
}: {
  current: Workspace;
  className?: string;
}) {
  return (
    <nav
      aria-label="Workspaces"
      className={cx(
        "items-center gap-0.5 rounded-lg bg-ink-850 p-0.5",
        className,
      )}
    >
      {WORKSPACES.map((w) => {
        const Icon = w.icon;
        const active = w.id === current;
        return (
          <Link
            key={w.id}
            href={w.href}
            title={w.note}
            aria-current={active ? "page" : undefined}
            data-testid={`nav-${w.id}`}
            className={cx(
              "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
              active
                ? "bg-ink-700 text-ink-100 shadow-sm"
                : "text-ink-300 hover:bg-ink-800 hover:text-ink-100",
            )}
          >
            <Icon
              aria-hidden
              className={cx("h-3.5 w-3.5", active && "text-accent")}
            />
            {w.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** One button naming the current workspace, opening a menu of all of
 * them (with what each is for) and Home. */
export function WorkspaceMenu({
  current,
  className,
}: {
  current: Workspace;
  className?: string;
}) {
  const here = WORKSPACES.find((w) => w.id === current)!;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const Here = here.icon;
  return (
    <div ref={root} className={cx("relative shrink-0", className)}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        data-testid="nav-menu"
        className="flex h-8 items-center gap-1.5 rounded-md bg-ink-850 px-2 text-xs font-medium text-ink-100 hover:bg-ink-800"
      >
        <Here aria-hidden className="h-3.5 w-3.5 text-accent" />
        <span>{here.label}</span>
        <span className="sr-only">: switch workspace</span>
        <ChevronDown aria-hidden className="h-3.5 w-3.5 text-ink-400" />
      </button>
      {open && (
        <nav
          id={menuId}
          aria-label="Workspaces"
          className="absolute left-0 top-full z-50 mt-2 w-72 rounded-lg border border-ink-700 bg-ink-900 p-1.5 shadow-xl"
          data-testid="nav-menu-list"
        >
          <ul className="space-y-0.5">
            {WORKSPACES.map((w) => {
              const Icon = w.icon;
              const active = w.id === current;
              return (
                <li key={w.id}>
                  <Link
                    href={w.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    data-testid={`nav-menu-${w.id}`}
                    className={cx(
                      "flex items-start gap-3 rounded-md px-2.5 py-2 hover:bg-ink-800",
                      active && "bg-ink-850",
                    )}
                  >
                    <Icon
                      aria-hidden
                      className={cx(
                        "mt-0.5 h-4 w-4 shrink-0",
                        active ? "text-accent" : "text-ink-300",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink-100">
                        {w.label}
                      </span>
                      <span className="block text-2xs text-ink-400">
                        {w.note}
                      </span>
                    </span>
                    {active && (
                      <Check
                        aria-hidden
                        className="mt-0.5 h-4 w-4 text-accent"
                      />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="my-1 h-px bg-ink-800" />
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 rounded-md px-2.5 py-2 text-sm text-ink-200 hover:bg-ink-800"
          >
            <House aria-hidden className="h-4 w-4 text-ink-300" />
            Home
          </Link>
        </nav>
      )}
    </div>
  );
}
