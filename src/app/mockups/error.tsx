"use client";

import { useEffect, useRef } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

import { cn, primaryControl } from "@/components/ui-primitives";

/**
 * THE MOCKUPS BOUNDARY — one segment above every design-scratch route.
 *
 * ⚠️ **THE GAP THIS CLOSES.** Per Next 16's `file-conventions/error.md`: "It does **not** wrap the
 * `layout.js`... above it in the same segment." A route folder's own `error.tsx` and `layout.tsx`
 * are siblings in the same segment, so nothing placed inside that folder could ever catch a throw
 * out of its `layout.tsx` itself — `DeveloperAreaGate`, a provider, or a reducer initialiser.
 * Because this file lives one segment further up, at `mockups/`, every route's `layout.tsx` is a
 * NESTED layout relative to it and IS wrapped ("error.js wraps... nested layout.js files"). A throw
 * from any of those now lands here instead of replacing the whole document via `src/app/error.tsx`.
 * That closed the gap for the gate-then-provider layouts of the retired Ward Flow and Care Plan
 * prototypes, which had no nearer boundary, and still covers any route layout added here.
 *
 * ⚠️ **WHAT IT STILL CANNOT COVER — read this before assuming the gap is fully closed.**
 *   - A module that builds seeded data at MODULE scope can throw during module evaluation, before
 *     React has rendered anything for any boundary to wrap. No error boundary anywhere in the tree —
 *     not this one, not one nearer, not one further out — can catch a throw that happens before
 *     rendering starts.
 *   - This file sits INSIDE `mockups/layout.tsx`'s own segment, so — by the identical same-segment
 *     rule that created the original gap — it does NOT wrap `mockups/layout.tsx` or the
 *     `MockupsLayoutClient` component that layout renders. A throw from either of those (for example
 *     out of the `mockupsEnabled()` / `headers()` gate) still escapes to `src/app/error.tsx`, the
 *     application shell's boundary.
 *   - It does not wrap `src/app/layout.tsx` or anything above it. Only a root `global-error.tsx`
 *     could catch that, and this task does not add one.
 *
 * ⚠️ **THIS BOUNDARY IS INHERITED BY EVERY ROUTE UNDER `mockups/`.** Nothing else in this folder
 * declares a nearer `error.tsx`, so a render throw in any design-scratch route (`document-search`,
 * `calculators-*`, `favourites-*`, and the rest) is caught here, where it previously fell through to
 * `src/app/error.tsx`. That is a deliberate, reported consequence of placing the boundary at this
 * level, not a scoping decision made unilaterally. The copy below is therefore written for a
 * design-scratch route in general, and the panel is independent of any one prototype's code.
 */
export default function MockupsErrorBoundary({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  /** Next 16's current recovery prop, not the older function it superseded. `retry()` re-fetches
   *  and re-renders the segment; the older one only cleared the error state without re-fetching, so
   *  a button reading "Try again" must be wired to `retry`. */
  retry: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // The whole error object, not `error.message`: the console entry is where the stack is
    // reachable in production as well as development.
    console.error("Unhandled runtime error captured by the mockups boundary:", error);
    headingRef.current?.focus({ preventScroll: true });
  }, [error]);

  // Evaluated at build time by the bundler, so the stack disclosure is not shipped to a production
  // client at all. Every route under `mockups/` 404s in production regardless; this is belt and
  // braces.
  const showStack = process.env.NODE_ENV !== "production";

  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[color:var(--surface-lux)] px-4 py-8 font-sans text-[color:var(--text)]"
      data-testid="mockups-error-boundary"
    >
      <p
        className="w-full max-w-2xl rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3 text-center text-xs text-[color:var(--text-muted)]"
        data-testid="mockups-error-scratch-notice"
      >
        This is a design-scratch preview route. It never ships to production, and nothing was changed by this failure.
      </p>

      <div className="w-full max-w-2xl rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-6 text-center shadow-[var(--shadow-elevated)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--danger-soft)] text-[color:var(--danger)]">
          <TriangleAlert aria-hidden="true" className="h-6 w-6" />
        </div>

        <h1
          ref={headingRef}
          tabIndex={-1}
          className="mt-4 text-lg font-semibold tracking-tight text-[color:var(--text-heading)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        >
          This preview could not be shown
        </h1>

        <p role="alert" className="mt-2 text-sm leading-relaxed text-[color:var(--text-muted)]">
          Nothing was changed and no data was lost. Trying again re-renders this part of the page against the same
          state, so a failure caused by the current state will happen again — reloading starts this prototype fresh
          instead.
        </p>

        {/* The message itself, never a stand-in for it. A boundary that hides what threw is the
            defect this file exists to remove. */}
        <pre
          className="mt-4 overflow-x-auto rounded-lg bg-[color:var(--surface-subtle)] p-3 text-left font-mono text-xs whitespace-pre-wrap text-[color:var(--text)]"
          data-testid="mockups-error-message"
        >
          {error.message || "The error carried no message."}
        </pre>

        {error.digest && (
          <p className="mt-2 font-mono text-xs text-[color:var(--text-muted)]" data-testid="mockups-error-digest">
            Digest: {error.digest}
          </p>
        )}

        {showStack && error.stack && (
          <details className="mt-3 text-left" data-testid="mockups-error-stack">
            <summary className="cursor-pointer text-xs text-[color:var(--text-muted)]">
              Stack trace (development only)
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-[color:var(--surface-subtle)] p-3 font-mono text-xs whitespace-pre-wrap text-[color:var(--text-muted)]">
              {error.stack}
            </pre>
          </details>
        )}

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => retry()}
            className={cn(primaryControl, "flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium")}
            data-testid="mockups-error-retry"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            Try again
          </button>

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex items-center justify-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-sm font-medium text-[color:var(--text)] transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            data-testid="mockups-error-reload"
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}
