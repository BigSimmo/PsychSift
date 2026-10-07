import { BriefcaseMedical, Check, ChevronDown, ChevronUp, Stethoscope, type LucideIcon } from "lucide-react";

import { cn } from "@/components/ui-primitives";
import { modeMenuSides, type ModeMenuSideId } from "@/lib/phone-mode-groups";

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
  showHint = false,
  active,
  phone,
  modeIconId,
  neutral = false,
}: {
  icon: LucideIcon;
  label: string;
  /** One short line under the name: always on the phone, on the desktop only with `showHint`. */
  hint?: string;
  /** Work's short list shows the line on the desktop too (#3351). Clinical stays compact. */
  showHint?: boolean;
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
          phone ? "h-10 w-10 rounded-full" : "h-8 w-8 rounded-lg",
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
        {(phone || showHint) && hint ? (
          <span className="mt-0.5 block truncate text-xs font-medium leading-4 text-[color:var(--text-muted)]">
            {hint}
          </span>
        ) : null}
      </span>
      {active ? (
        <Check
          aria-hidden="true"
          className="size-icon-md shrink-0 text-[color:var(--clinical-accent)]"
          strokeWidth={phone ? 2.6 : 2.5}
        />
      ) : (
        <span aria-hidden="true" className="size-icon-md" />
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
 * Glass, the one recipe for floating controls (work-mode.css): a see-through
 * fill, a hairline and a blur, no shadow. The work tokens only exist inside a
 * work frame, so each carries a fallback for the sheet's portal.
 */
export const modePickerGlassClass =
  "border border-[color:var(--work-glass-line,var(--border))] bg-[color:var(--work-glass-fill,color-mix(in_srgb,var(--surface)_72%,transparent))] backdrop-blur-[18px] backdrop-saturate-[1.8]";

/**
 * Direction B (Josh, 7 Oct 2026): on the phone each group's modes sit in one
 * white card, with hairline dividers that start past the icon.
 */
export const modePickerCardClass =
  "overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]";

/** Added to a phone row inside that card: square edges, no ring, an inset divider above every row but the first. */
export const modePickerCardRowClass =
  "rounded-none px-3 ring-0 not-first:before:absolute not-first:before:inset-x-0 not-first:before:left-16 not-first:before:top-0 not-first:before:h-px not-first:before:bg-[color:var(--border)]";

/**
 * The phone sheet's header band, drawn behind the title in the current mode's
 * colour: the work band's pale fill, its dot texture and a faint line drawing of
 * the mode's icon. The caller makes the header `relative isolate`, so this sits
 * under the title and close button. It reaches up over the sheet's drag grip
 * (which still takes the drag, because the band ignores the pointer) and draws
 * the grip again on top, so the colour runs to the sheet's rounded top edge.
 */
export function ModePickerSheetBand({ modeId, icon: Icon }: { modeId: string; icon: LucideIcon }) {
  return (
    <span
      aria-hidden="true"
      data-mode-identity={modeId}
      data-testid="app-mode-sheet-band"
      className="pointer-events-none absolute inset-x-0 -top-4 bottom-0 -z-10 overflow-hidden border-b border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-band)] sm:top-0"
    >
      <span className="absolute inset-0 bg-[radial-gradient(var(--mode-identity-border)_0.7px,transparent_0.8px)] bg-[length:12px_12px] opacity-55" />
      <Icon
        aria-hidden="true"
        className="absolute -bottom-11 -right-5 h-40 w-40 text-[color:var(--mode-identity)] opacity-[0.12]"
        strokeWidth={1.25}
      />
      <span className="absolute left-1/2 top-2 h-1 w-9 -translate-x-1/2 rounded-full bg-[color:var(--border-strong)] sm:hidden" />
    </span>
  );
}

/**
 * "Currently <mode>" under the sheet title, with a small badge in the mode's
 * colour: its two-stop gradient, which is flat for a mode with no work palette.
 */
export function ModePickerCurrentMode({
  modeId,
  label,
  icon: Icon,
}: {
  modeId: string;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2 text-sm leading-5 text-[color:var(--text-muted)]">
      <span
        data-mode-identity={modeId}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[linear-gradient(160deg,var(--mode-identity-2),var(--mode-identity)_70%)] text-[color:var(--mode-identity-contrast)] forced-colors:border"
      >
        <Icon aria-hidden="true" className="size-icon-xs" strokeWidth={2} />
      </span>
      <span className="min-w-0 truncate">
        Currently <span className="font-semibold text-[color:var(--text-heading)]">{label}</span>
      </span>
    </span>
  );
}

const modeSideIcons: Record<ModeMenuSideId, LucideIcon> = {
  clinical: Stethoscope,
  work: BriefcaseMedical,
};

/**
 * The Clinical and Work toggle at the top of the mode list (Josh, 7 Oct 2026).
 * It filters the list below to one side. Two pressed-state buttons rather than
 * tabs: the list it filters is a menu, and a menu cannot sit inside a tab panel.
 * On the phone it is a glass pill in the header band (direction B); on the
 * desktop popover it stays a quiet flat track. The chosen side is a white
 * segment with a hairline in both.
 */
export function ModePickerSideToggle({
  side,
  onChange,
  phone,
}: {
  side: ModeMenuSideId;
  onChange: (side: ModeMenuSideId) => void;
  phone: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Show modes"
      data-testid="app-mode-side-toggle"
      className={cn(
        "grid grid-cols-2 gap-1 p-0.5",
        phone
          ? cn("h-11 rounded-full", modePickerGlassClass)
          : "h-10 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)]",
      )}
    >
      {modeMenuSides.map(({ id: option, label }) => {
        const pressed = option === side;
        const Icon = modeSideIcons[option];
        return (
          <button
            key={option}
            type="button"
            aria-pressed={pressed}
            data-mode-side={option}
            onClick={() => onChange(option)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 border text-sm font-semibold transition-[background-color,color] duration-[var(--duration-fast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none",
              phone ? "rounded-full" : "rounded-md",
              pressed
                ? "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-heading)] forced-colors:border-[color:Highlight]"
                : "border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-heading)]",
            )}
          >
            <Icon aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
