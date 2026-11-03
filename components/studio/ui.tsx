"use client";

/** Studio UI primitives. Small, accessible, token-driven. */

import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  icon?: LucideIcon;
};

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3 text-sm",
        variant === "primary" &&
          "bg-accent text-ink-950 hover:bg-accent-strong",
        variant === "secondary" && "bg-ink-750 text-ink-100 hover:bg-ink-700",
        variant === "ghost" && "text-ink-200 hover:bg-ink-750",
        variant === "danger" && "text-danger hover:bg-danger/10",
        className,
      )}
      {...rest}
    >
      {Icon && <Icon aria-hidden className="h-4 w-4 shrink-0" />}
      {children}
    </button>
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  shortcut?: string;
  size?: "sm" | "md";
};

export function IconButton({
  icon: Icon,
  label,
  active,
  shortcut,
  size = "md",
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-35",
        size === "sm" ? "h-7 w-7" : "h-9 w-9",
        active
          ? "bg-accent-soft text-accent"
          : "text-ink-300 hover:bg-ink-750 hover:text-ink-100",
        className,
      )}
      {...rest}
    >
      <Icon
        aria-hidden
        className={size === "sm" ? "h-3.5 w-3.5" : "h-[18px] w-[18px]"}
      />
    </button>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  unit = "",
  format,
  onChange,
  onCommitEnd,
  disabled,
  hint,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  /** Pointer/key release: ends the undo coalescing run. */
  onCommitEnd?: () => void;
  disabled?: boolean;
  hint?: string;
  testId?: string;
}) {
  const id = useId();
  const shown = format ? format(value) : `${value}${unit}`;
  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs text-ink-300">
          {label}
        </label>
        <span className="text-xs tabular-nums text-ink-200">{shown}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={shown}
        aria-describedby={hint ? `${id}-hint` : undefined}
        data-testid={testId}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommitEnd}
        onKeyUp={onCommitEnd}
      />
      {hint && (
        // Phones: hints stay for screen readers but don't double every
        // slider's height.
        <p
          id={`${id}-hint`}
          className="sr-only mt-1 text-2xs text-ink-400 sm:not-sr-only"
        >
          {hint}
        </p>
      )}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled,
  hint,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className="py-1.5">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <label
          htmlFor={id}
          className={cx("text-xs", disabled ? "text-ink-500" : "text-ink-300")}
        >
          {label}
        </label>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          data-testid={testId}
          onClick={() => onChange(!checked)}
          className={cx(
            "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            checked ? "bg-accent" : "bg-ink-600",
          )}
        >
          <span
            aria-hidden
            className={cx(
              "absolute left-0 top-0.5 h-4 w-4 rounded-full bg-ink-100 shadow transition-transform",
              checked ? "translate-x-[18px]" : "translate-x-0.5",
            )}
          />
        </button>
      </div>
      {hint && <p className="mt-0.5 text-2xs text-ink-400">{hint}</p>}
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel,
  testIdPrefix,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
  hideLabel?: boolean;
  testIdPrefix?: string;
}) {
  return (
    <div className="py-1.5">
      {!hideLabel && <div className="mb-1 text-xs text-ink-300">{label}</div>}
      <div
        role="group"
        aria-label={label}
        className="flex rounded-md bg-ink-800 p-0.5"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            data-testid={
              testIdPrefix ? `${testIdPrefix}-${o.value}` : undefined
            }
            onClick={() => onChange(o.value)}
            className={cx(
              "h-7 flex-1 rounded px-2 text-xs font-medium transition-colors",
              value === o.value
                ? "bg-ink-600 text-ink-100 shadow-sm"
                : "text-ink-300 hover:text-ink-100",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ColorField({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 py-1.5">
      <label htmlFor={id} className="text-xs text-ink-300">
        {label}
      </label>
      <span className="flex items-center gap-2">
        <span className="text-xs uppercase tabular-nums text-ink-400">
          {value}
        </span>
        <input
          id={id}
          type="color"
          value={value}
          data-testid={testId}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="h-7 w-9 cursor-pointer rounded border border-ink-600 bg-transparent p-0.5"
        />
      </span>
    </div>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-1 mt-4 flex items-center justify-between first:mt-0">
      <h3 className="text-2xs font-semibold uppercase tracking-wider text-ink-400">
        {children}
      </h3>
      {action}
    </div>
  );
}

export function PanelHeader({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 flex h-11 shrink-0 items-center justify-between border-b border-ink-750 bg-ink-900/95 px-3 backdrop-blur">
      <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
      <div className="flex items-center gap-0.5">{children}</div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 font-sans text-2xs text-ink-200">
      {children}
    </kbd>
  );
}

/** Native <dialog> for focus trapping, Esc and top-layer stacking. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-testid={testId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="w-[min(92vw,30rem)] rounded-xl border border-ink-700 bg-ink-850 p-0 text-ink-100 shadow-2xl"
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-center justify-between border-b border-ink-750 px-4 py-3">
            <h2 id={titleId} className="text-sm font-semibold">
              {title}
            </h2>
            <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
          </div>
          <div className="overflow-y-auto px-4 py-3">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-ink-750 px-4 py-3">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

/** Help text: shown as is on larger screens; on phones folded into a
 * "Tips" line, so the controls come first on a small screen. */
export function Tip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <>
      <p className={cx("hidden text-2xs text-ink-400 sm:block", className)}>
        {children}
      </p>
      <details className={cx("text-2xs text-ink-400 sm:hidden", className)}>
        <summary className="cursor-pointer select-none py-1 text-ink-300">
          Tips
        </summary>
        <p className="pb-1">{children}</p>
      </details>
    </>
  );
}
