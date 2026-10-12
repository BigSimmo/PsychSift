"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { announce } from "@/components/ui/live-announcer";
import { cn } from "@/components/ui-primitives";

/**
 * Filters highlight, never hide (October 2026, owner-approved).
 *
 * On Clinical lists a filter no longer removes the rows that do not match. The
 * matching rows come first, a plain note says how many are highlighted, and
 * every other row stays below under a "Not …" heading in muted text. A
 * clinician filtering to Emergent can still see, and open, everything else.
 *
 * The note is plain visible text. Turning a filter on, changing it, or clearing
 * it is spoken through the app's shared announcer rather than a live region on
 * the note itself, so a screen reader hears each change once.
 */
export function FilterHighlightNote({
  active,
  highlighted,
  total,
  onClear,
  testId = "filter-highlight-note",
  className,
}: {
  /** False renders nothing. */
  active: boolean;
  highlighted: number;
  total: number;
  /** Clears only the highlighting filters. */
  onClear: () => void;
  testId?: string;
  className?: string;
}) {
  const message = active ? `${highlighted} of ${total} highlighted, all rows stay` : "";
  useEffect(() => {
    if (message) announce(message);
  }, [message]);
  if (!active) return null;
  return (
    <div data-testid={testId} className={cn("flex flex-wrap items-center gap-x-2", className)}>
      <p className="m-0 text-sm text-[color:var(--text-muted)]">
        <span data-testid={`${testId}-count`} className="nums font-bold text-[color:var(--text-heading)]">
          {highlighted} of {total}
        </span>{" "}
        highlighted, all rows stay
      </p>
      {/* The shared Button keeps the 48px tap height and the focus ring. */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onClear}
        testId={`${testId}-clear`}
        className="min-w-tap justify-center px-2 text-sm font-bold text-[color:var(--clinical-accent)] hover:text-[color:var(--clinical-accent)]"
      >
        Clear
      </Button>
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
