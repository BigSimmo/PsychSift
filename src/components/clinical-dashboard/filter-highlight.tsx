"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui-primitives";

/**
 * Filters highlight, never hide (October 2026, owner-approved).
 *
 * On Clinical lists a filter no longer removes the rows that do not match. The
 * matching rows come first, a plain note says how many are highlighted, and
 * every other row stays below under a "Not …" heading in muted text. A
 * clinician filtering to Emergent can still see, and open, everything else.
 *
 * The note's wrapper is a polite live region that stays mounted whether or not
 * a filter is on, so turning a filter on, changing it, or clearing it is heard
 * by a screen reader (content inserted into an already-present region is
 * announced; a region mounted with its content often is not).
 */
export function FilterHighlightNote({
  active,
  highlighted,
  total,
  onClear,
  testId = "filter-highlight-note",
  className,
}: {
  /** False renders the empty live region only. */
  active: boolean;
  highlighted: number;
  total: number;
  /** Clears only the highlighting filters. */
  onClear: () => void;
  testId?: string;
  className?: string;
}) {
  return (
    <div data-testid={testId} className={cn(active ? "flex flex-wrap items-center gap-x-2" : "contents", className)}>
      <p role="status" aria-live="polite" className={active ? "m-0 text-sm text-[color:var(--text-muted)]" : "sr-only"}>
        {active ? (
          <>
            <span data-testid={`${testId}-count`} className="nums font-bold text-[color:var(--text-heading)]">
              {highlighted} of {total}
            </span>{" "}
            highlighted, all rows stay
          </>
        ) : null}
      </p>
      {active ? (
        // The shared Button keeps the 48px tap height and the focus ring.
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          testId={`${testId}-clear`}
          className="min-w-tap justify-center px-2 text-sm font-bold text-[color:var(--clinical-accent)] hover:text-[color:var(--clinical-accent)]"
        >
          Clear
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The heading over the rows a filter does not match. Muted by colour token
 * (`--text-muted`), never by opacity, so the rows below it keep full contrast
 * in light and dark.
 */
export function FilterNotMatchingHeading({
  label,
  count,
  level = 3,
  testId = "filter-not-matching-heading",
}: {
  /** "Not emergent" for a single urgency filter, otherwise "Not matching". */
  label: string;
  count: number;
  level?: 2 | 3;
  testId?: string;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <Heading data-testid={testId} className="m-0 pt-3 text-sm font-extrabold text-[color:var(--text-muted)]">
      {label}
      <span className="nums font-semibold"> · {count}</span>
    </Heading>
  );
}

/** Class for a row title outside the active filter: muted by token, not opacity. */
export const filterOutsideTitleClass = "text-[color:var(--text-muted)]";
