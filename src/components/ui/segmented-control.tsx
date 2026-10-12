"use client";

import type { LucideIcon } from "lucide-react";
import { useCallback, useId, useRef } from "react";

import { cn } from "@/components/ui-primitives";

export type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
  icon?: LucideIcon;
  /**
   * Genuinely unavailable: skipped by the arrow keys and natively `disabled`,
   * the standard radiogroup treatment for an option that is not on offer.
   */
  disabled?: boolean;
  /**
   * Offered, but empty under the reader's current narrowing — a dead end rather
   * than an unavailable option, and a different thing from `disabled`.
   *
   * It stays on the arrow path and takes `aria-disabled`, because
   * `docs/filter-contract.md` section 3 requires the option a reader just
   * emptied to remain focusable and to explain itself. Native `disabled` would
   * drop it out of the tab order, hiding the explanation from the one person
   * who needs it. Selection is withheld; focus is not.
   */
  deadEnd?: boolean;
  /**
   * Trailing detail, almost always a count — "Presentations 41".
   *
   * Exists because the one-of-N rails this control replaces across the modes all
   * carry a count, and baking it into `label` would fold the number into the
   * truncating span and lose the tabular alignment. Never the only thing
   * distinguishing two options: it joins the accessible name, so an option whose
   * label is not unique without its hint reads as a near-duplicate to a screen
   * reader. Mirrors `ResultFilterOption.hint`, so a mode can build one option
   * array and hand it to both the desktop rail and the phone sheet.
   */
  hint?: string;
  /**
   * Short display form of `hint`, mirroring `ResultFilterOption.hintLabel`.
   *
   * The announced name keeps `hint`'s unit ("1 loaded source"); the visible
   * column shows only this ("1"). Without the split, a lens whose counts carry
   * a unit had to choose between an unreadable segment and a name that dropped
   * the unit — so it stayed on chips instead. Omit to display `hint` verbatim.
   */
  hintLabel?: string;
};

type AccessibleName = { label: string; ariaLabelledBy?: never } | { label?: never; ariaLabelledBy: string };

export type SegmentedControlProps<T extends string> = AccessibleName & {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedControlOption<T>>;
  ariaDescribedBy?: string;
  /**
   * The region this rail filters. Set it when the control governs a panel
   * elsewhere in the page — the launcher's category rail pointed each of its
   * buttons at `#launcher-results-panel`, and converging on this primitive must
   * not silently drop that association. One group-level reference, because the
   * radiogroup is the control; the individual radios are its options.
   */
  ariaControls?: string;
  layout?: "fit" | "equal";
  className?: string;
};

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  ariaLabelledBy,
  ariaDescribedBy,
  ariaControls,
  layout = "fit",
  className,
}: SegmentedControlProps<T>) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  // Scopes the dead-end explanation ids, so two rails on one page cannot collide.
  const idPrefix = useId();
  // `disabled` leaves the arrow path entirely; `deadEnd` stays on it. See the
  // two fields on SegmentedControlOption for why they are not the same thing.
  const reachable = options.filter((option) => !option.disabled);
  const selectable = options.filter((option) => !option.disabled && !option.deadEnd);
  // Keep the controlled value honest: an unavailable matching option stays the
  // checked radio. Never silently remap to the first selectable option — that
  // would show a selection the owner state does not hold.
  const valueMatchesOption = options.some((option) => option.value === value);
  const valueIsSelectable = selectable.some((option) => option.value === value);
  const selectedValue = valueMatchesOption ? value : undefined;
  const tabStopValue = valueIsSelectable ? value : selectable[0]?.value;

  // Focus always moves; selection only follows for an option that can hold it.
  // Arrowing onto a dead end is how its explanation gets announced, so it must
  // not commit the option before it and must not leave focus behind either.
  const moveTo = useCallback(
    (next: SegmentedControlOption<T> | undefined) => {
      if (!next) return;
      refs.current.get(next.value)?.focus();
      if (next.deadEnd) return;
      onChange(next.value);
    },
    [onChange],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!reachable.length) return;
      const currentValue = (event.target as HTMLElement).dataset.segmentValue as T | undefined;
      const current = Math.max(
        reachable.findIndex((option) => option.value === currentValue),
        0,
      );
      let next: number | null = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % reachable.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
        next = (current - 1 + reachable.length) % reachable.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = reachable.length - 1;
      if (next == null) return;
      event.preventDefault();
      moveTo(reachable[next]);
    },
    [reachable, moveTo],
  );

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-controls={ariaControls}
      onKeyDown={onKeyDown}
      data-layout={layout}
      className={cn(
        "flex w-full min-w-0 gap-0.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-inset)] shadow-[var(--shadow-inset)]",
        layout === "equal" ? "flex-nowrap" : "flex-wrap",
        className,
      )}
    >
      {options.map((option) => {
        const checked = option.value === selectedValue;
        const deadEnd = Boolean(option.deadEnd) && !checked;
        const deadEndDescId = `${idPrefix}-${option.value.replace(/[^A-Za-z0-9_-]/g, "-")}-note`;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node) refs.current.set(option.value, node);
              else refs.current.delete(option.value);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            // Without this the label and hint spans concatenate to "All62" in
            // the accessible name — inter-element whitespace is normalised away
            // by the name computation, so a text-node separator cannot fix it.
            // Matches the `${label} (${count})` shape the mode rails used.
            aria-label={option.hint ? `${option.label} (${option.hint})` : undefined}
            tabIndex={option.value === tabStopValue ? 0 : -1}
            // One or the other, never both — the two states are exclusive and
            // `require-button-wiring` rejects an element carrying both, because
            // the native attribute wins on focus and would silently defeat the
            // aria one. A dead end must stay reachable to state its reason; an
            // unavailable option must not.
            {...(deadEnd
              ? { "aria-disabled": true as const, "aria-describedby": deadEndDescId }
              : { disabled: option.disabled })}
            data-segment-value={option.value}
            onClick={() => {
              if (deadEnd) return;
              onChange(option.value);
            }}
            className={cn(
              "relative isolate flex min-h-tap min-w-0 items-center justify-center whitespace-nowrap rounded-lg font-semibold leading-none transition focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus)] disabled:cursor-not-allowed disabled:text-[color:var(--disabled)]",
              layout === "equal"
                ? "flex-1 gap-1 px-0 text-3xs tracking-tight min-[360px]:px-1 min-[360px]:text-xs sm:gap-1.5 sm:px-3 sm:tracking-normal"
                : "flex-none gap-1.5 px-3 text-xs",
              checked
                ? "text-[color:var(--text-heading)]"
                : deadEnd
                  ? // Not `opacity`: it multiplies against an already-muted
                    // foreground and does not survive forced-colors, where
                    // border-style is preserved. A muted pair plus a dashed
                    // edge reads as a different KIND of option, not a faded
                    // one — the same treatment the chip renderer uses.
                    "cursor-default border border-dashed border-[color:var(--border-strong)] text-[color:var(--text-muted)]"
                  : "text-[color:var(--text-muted)] hover:bg-[color:var(--surface-highlight)] hover:text-[color:var(--text-heading)]",
            )}
          >
            {checked ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-lux)] shadow-sm forced-colors:outline forced-colors:outline-2 forced-colors:[outline-color:Highlight]"
              />
            ) : null}
            {Icon ? <Icon aria-hidden="true" className="relative size-icon-sm shrink-0" /> : null}
            <span className="relative min-w-0 truncate">{option.label}</span>
            {option.hint ? (
              // Reserve a three-digit count column as well as using tabular figures so live
              // result updates do not move the segment bounds — tabular figures keep digit
              // widths equal but do not stop the span growing at 9 -> 10. The hint inherits
              // the button's opaque semantic foreground rather than carrying its own colour:
              // the decoration-only text alias is barred from production by
              // check:design-system-contract, and any second token here would have to stay
              // legible against both the checked and unchecked backgrounds.
              <span className="nums relative min-w-6 shrink-0 text-right tabular-nums">
                {option.hintLabel ?? option.hint}
              </span>
            ) : null}
            {deadEnd ? (
              <span id={deadEndDescId} className="sr-only">
                Not selectable from here.
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
