"use client";

import type { ReactNode } from "react";

import { cn, ignoreUnavailableActivation } from "@/components/ui-primitives";

export type UnavailableDestinationProps = {
  /** Unique within one render; also names the screen-reader note this control points at. */
  id: string;
  /** Sentence-case destination name, exactly as it will read once built. */
  label: string;
  /** Plain-words statement of what the destination will hold once it is built. */
  reason: string;
  className?: string;
  /** Presentation for the destination; defaults to its label. */
  children?: ReactNode;
};

/**
 * A workspace destination that is declared but not built yet.
 *
 * Ruling 52: the navigation renders its whole destination set now, and an
 * unbuilt destination is an unavailable control with a stated reason — never a
 * link to a route that would 404.
 *
 * `docs/wiring-conventions.md`: such a control carries `aria-disabled="true"`
 * plus an inert handler, never the native `disabled` attribute, because native
 * `disabled` removes the tab stop and the stated reason could then never be
 * reached by keyboard. The two attributes are never used together;
 * `eslint-rules/require-button-wiring.mjs` fails on the pair.
 *
 * This is the only client component the production workspace ships, which is
 * what keeps the route's client payload to a rounding error (Ruling 13).
 */
export function UnavailableDestination({ id, label, reason, className, children }: UnavailableDestinationProps) {
  const noteId = `caring-contacts-unavailable-${id}`;
  return (
    <>
      <button
        type="button"
        aria-disabled="true"
        aria-describedby={noteId}
        title={`${label} — coming soon`}
        onClick={ignoreUnavailableActivation}
        className={cn(
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border",
          className,
        )}
      >
        {children ?? <span className="truncate">{label}</span>}
      </button>
      <span id={noteId} className="sr-only">
        {label} is not built yet. {reason}
      </span>
    </>
  );
}
