import { Check, ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";

import { cn } from "@/components/ui-primitives";
import { modeSideLabels, modeSides, type ModeSide } from "@/lib/phone-mode-groups";

/**
 * One row of the mode pill's menu: the phone sheet's "Choose mode" level, the
 * desktop popover, and the "All modes" exit at the foot of a mode's pages.
 *
 * Polish pass (Mode picker polish, 7 Oct 2026), same structure as before:
 *   - Each mode row carries its own `data-mode-identity`, so its tile, tick and
 *     selected tint wear that area's colour. Modes with no identity resolve to
 *     the product accent through the `:root` alias, so clinical modes look as
 *     they did.
 *   - Tiles are a flat tint of that colour at rest, not a grey raised box.
 *   - Flat: no inset shadow on the selected row and no lift on the tick disc.
 *   - The phone line under the name is a one-line hint, never a clamped
 *     sentence. The caller keeps the full description as the accessible name.
 *
 * Sizes are unchanged on purpose: 40px tiles and 56px rows on the phone are
 * pinned in a browser by `tests/ui-smoke.spec.ts`.
 */
/**
 * The product accent, restated on every row. Inside a work area the area's
 * palette rides on <body> (mode band), so a clinical mode's row would otherwise
 * inherit, say, CPD copper. A row whose mode has its own identity still wins:
 * the `[data-mode-identity]` blocks in `globals.css` are unlayered, and beat
 * this utility-layer reset.
 */
const productAccentReset =
  "[--clinical-accent:var(--primary)] [--clinical-accent-soft:var(--primary-soft)] [--clinical-accent-border:var(--product-accent-border,color-mix(in_oklab,var(--primary)_22%,var(--surface)))] [--clinical-accent-contrast:var(--primary-contrast)]";

export function modePickerRowClass(active: boolean, phone: boolean): string {
  return cn(
    productAccentReset,
    "relative grid w-full items-center text-left transition-[background-color,color] duration-[var(--duration-fast)] ease-[var(--ease-out-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none",
    phone
      ? "min-h-14 grid-cols-[2.5rem_minmax(0,1fr)_1.5rem] gap-3 rounded-xl px-2 py-2"
      : "min-h-12 grid-cols-[2rem_minmax(0,1fr)_auto] gap-2.5 rounded-md px-2.5 py-1.5",
    active
      ? phone
        ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--text)] ring-1 ring-inset ring-[color:var(--clinical-accent-border)]"
        : "bg-[color:var(--clinical-accent-soft)] text-[color:var(--text)]"
      : "text-[color:var(--text)] hover:bg-[color:var(--surface-subtle)]",
  );
}

export function ModePickerRowContent({
  icon: Icon,
  label,
  hint,
  active,
  phone,
  modeIconId,
  neutral = false,
}: {
  icon: LucideIcon;
  label: string;
  /** Phone only: one short line under the name. */
  hint?: string;
  active: boolean;
  phone: boolean;
  /** Only the mode list stamps this; the section list has no per-mode hook to offer. */
  modeIconId?: string;
  /** A row that is not a mode ("All modes"): grey tile, no area colour to claim. */
  neutral?: boolean;
}) {
  return (
    <>
      {active && !phone ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-1.5 left-0 w-0.5 rounded-r-full bg-[color:var(--clinical-accent)]"
        />
      ) : null}
      <span
        data-mode-icon={modeIconId}
        className={cn(
          "grid place-items-center border text-[color:var(--clinical-accent)] transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none",
          phone ? "h-10 w-10 rounded-xl" : "h-8 w-8 rounded-lg",
          neutral
            ? "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text-muted)]"
            : active
              ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--surface)]"
              : "border-transparent bg-[color:var(--clinical-accent-soft)]",
        )}
      >
        <Icon aria-hidden="true" className={phone ? "size-icon-lg" : "size-icon-md"} strokeWidth={phone ? 1.8 : 2} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold tracking-[var(--tracking-display)] text-[color:var(--text-heading)]">
          {label}
        </span>
        {phone && hint ? (
          <span className="mt-0.5 block truncate text-xs font-medium leading-4 text-[color:var(--text-muted)]">
            {hint}
          </span>
        ) : null}
      </span>
      {active && phone ? (
        <span className="grid h-6 w-6 place-items-center rounded-full bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]">
          <Check aria-hidden="true" className="size-icon-sm" strokeWidth={2.5} />
        </span>
      ) : active ? (
        <Check
          aria-hidden="true"
          className="size-icon-md shrink-0 text-[color:var(--clinical-accent)]"
          strokeWidth={2.5}
        />
      ) : (
        <span aria-hidden="true" className={phone ? "h-6 w-6" : "size-icon-md"} />
      )}
    </>
  );
}

const keyCapClass =
  "inline-grid h-5 min-w-5 place-items-center rounded-sm border font-sans border-[color:var(--border)] bg-[color:var(--surface)] px-1 text-2xs font-semibold text-[color:var(--text)]";

/**
 * The desktop popover's footer: real key caps instead of "↑↓ Navigate" text,
 * which leaned on arrow glyphs the copy rules keep out. Decorative only; the
 * caller marks the footer `aria-hidden`, because the menu's own roles already
 * tell assistive technology how to move.
 */
export function ModePickerKeyHints() {
  return (
    <>
      <span className="inline-flex items-center gap-1">
        <kbd className={keyCapClass}>
          <ChevronUp aria-hidden="true" className="size-icon-xs" strokeWidth={2.4} />
        </kbd>
        <kbd className={keyCapClass}>
          <ChevronDown aria-hidden="true" className="size-icon-xs" strokeWidth={2.4} />
        </kbd>
        Move
      </span>
      <span className="inline-flex items-center gap-1">
        <kbd className={keyCapClass}>Enter</kbd>
        Open
      </span>
      <span className="inline-flex items-center gap-1">
        <kbd className={keyCapClass}>Esc</kbd>
        Close
      </span>
    </>
  );
}

/**
 * The Clinical and Work toggle at the top of the mode list (Josh, 7 Oct 2026).
 * It filters the list below to one side. Two pressed-state buttons rather than
 * tabs: the list it filters is a menu, and a menu cannot sit inside a tab panel.
 * Flat, like the rows: the chosen side is a white segment on a quiet track.
 */
export function ModePickerSideToggle({
  side,
  onChange,
  phone,
}: {
  side: ModeSide;
  onChange: (side: ModeSide) => void;
  phone: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Show modes"
      data-testid="app-mode-side-toggle"
      className={cn(
        "grid grid-cols-2 gap-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-0.5",
        phone ? "h-11" : "h-10",
      )}
    >
      {modeSides.map((option) => {
        const pressed = option === side;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={pressed}
            data-mode-side={option}
            onClick={() => onChange(option)}
            className={cn(
              "rounded-md text-sm font-semibold transition-[background-color,color] duration-[var(--duration-fast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none",
              pressed
                ? "border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-heading)] forced-colors:border-[color:Highlight]"
                : "text-[color:var(--text-muted)] hover:text-[color:var(--text-heading)]",
            )}
          >
            {modeSideLabels[option]}
          </button>
        );
      })}
    </div>
  );
}
