"use client";

import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";
import { ON_CALL_FILTER_ALL } from "@/lib/on-call/entry-filters";

/**
 * A row of filter chips. Two places mount it today: the Refer page's team
 * filter (`refer/refer-page.tsx`) and the service's "What needs checking"
 * panel (`service-checking-panel.tsx`). Both filters cut ACROSS the groups
 * below them rather than naming them.
 *
 * That is the bar a new caller has to clear. The section boards (Contacts,
 * Referrals, Orientation) once drew a chip row by the same facet the page
 * groups by, so the chips named the same words as the group headings below
 * them AND the same words as the in-page header's jump list: three ways to
 * reach "Wards" on one 390px screen. Worse, a chip HID the other groups, so a
 * mistap cost the reader the list rather than their place, while what they
 * wanted was to GET to a group, which is what the jump list does. That row
 * was removed from the section boards on the owner's instruction; do not
 * wire it back in there.
 *
 * The caller passes the options, and the row disappears entirely when there
 * is nothing to choose between.
 *
 * The chips carry the production 48 px tap floor rather than the drawing's
 * smaller pills. That is a deliberate departure: this is a one-handed surface
 * read at 3am, `min-h-tap` is this repository's floor for a production
 * control, and the drawing's height is not a promise to anyone.
 *
 * `aria-pressed` rather than a radio group, because the row is a filter over
 * a list that is still fully present underneath — a reader who taps nothing
 * sees everything, which a required radio selection would not express.
 */
export function OnCallFilterChips({
  options,
  active,
  onChange,
  label,
  testId,
}: {
  options: readonly string[];
  active: string;
  onChange: (next: string) => void;
  /** What the row filters, for assistive technology: "Filter contacts". */
  label: string;
  testId: string;
}) {
  if (options.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={label}
      data-testid={testId}
      // Scrolls inside its own container so the page body never scrolls
      // sideways, the same treatment the home's ward strip gets.
      data-no-tab-swipe
      className="-mx-4 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 pb-1 [-webkit-overflow-scrolling:touch] sm:mx-0 sm:w-full sm:flex-wrap sm:px-0"
    >
      {options.map((option) => {
        const isActive = option === active;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={isActive}
            data-testid={`${testId}-${option === ON_CALL_FILTER_ALL ? "all" : slugifyOption(option)}`}
            className={cn(
              "inline-flex min-h-tap shrink-0 items-center rounded-full border px-3.5 text-xs font-semibold",
              "transition-colors motion-reduce:transition-none",
              focusRing,
              isActive
                ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-heading)]",
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

/** A stable testid fragment for one option. */
function slugifyOption(option: string): string {
  const slug = option
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "option";
}
