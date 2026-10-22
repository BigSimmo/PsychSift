"use client";

import { startTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert, RefreshCw, ClipboardCopy, Check } from "lucide-react";

import { cn, commandControl } from "@/components/ui-primitives";
import { useCopyDiagnostics } from "@/lib/use-copy-diagnostics";

export type RouteErrorBoundaryProps = {
  /** The error thrown by the segment, forwarded by Next.js. */
  error: Error & { digest?: string };
  /** Re-renders the segment from scratch, forwarded by Next.js. */
  reset: () => void;
  /** Heading shown above the recovery actions. */
  title?: string;
  /** Explanatory copy under the heading. */
  description?: string;
  /** Prefix used when logging the error to the console. */
  logLabel?: string;
  /** Whether to offer a full page reload in addition to `reset()`. */
  showReload?: boolean;
  /** Minimum-height utility so route segments and the app shell can size differently. */
  minHeightClass?: string;
  /**
   * Render as the page's `<main id="main-content">` landmark. Only the root boundary owns it;
   * nested segment boundaries render inside a shell that already provides that landmark.
   */
  landmark?: boolean;
};

const CHUNK_LOAD_MESSAGE =
  /Loading (?:CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

/**
 * True for a failure to download part of the app's own code — a dropped connection, or a
 * deploy that replaced the file mid-session (audit F11). "Try again" re-renders from the same
 * missing file and fails again; only a full reload fetches it, so such errors get their own copy.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "ChunkLoadError" || CHUNK_LOAD_MESSAGE.test(error.message);
}

function useOptionalRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

/**
 * Shared recovery panel for App Router `error.tsx` boundaries. Centralising the
 * markup keeps every segment boundary visually and behaviourally consistent and
 * removes the copy-paste friction that previously left new routes without a
 * boundary at all. Individual `error.tsx` files stay as the thin default exports
 * Next.js requires and delegate here.
 */
export function RouteErrorBoundary({
  error,
  reset,
  title = "Something went wrong",
  description = "An unexpected error occurred. You can try to reset the current view or refresh the browser.",
  logLabel = "Unhandled runtime error captured by boundary:",
  showReload = false,
  minHeightClass = "min-h-[50vh]",
  landmark = false,
}: RouteErrorBoundaryProps) {
  const router = useOptionalRouter();
  const Container = landmark ? "main" : "div";
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { copied, copyFailed, copyDiagnostics } = useCopyDiagnostics(error);
  const chunkLoad = isChunkLoadError(error);
  const heading = chunkLoad ? "This page didn't finish loading" : title;
  const explanation = chunkLoad
    ? "Part of the page couldn't be downloaded, usually because the connection dropped or PsychSift was just updated. Reload the page to fetch it again."
    : description;

  useEffect(() => {
    console.error(logLabel, error);
    headingRef.current?.focus({ preventScroll: true });
  }, [error, logLabel]);

  return (
    <Container
      id={landmark ? "main-content" : undefined}
      className={cn(
        "flex flex-col items-center justify-center bg-[color:var(--surface-lux)] px-4 font-sans text-[color:var(--text)] select-none",
        minHeightClass,
      )}
    >
      <div className="w-full max-w-md rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-6 text-center shadow-[var(--shadow-elevated)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--danger-soft)] text-[color:var(--danger)]">
          <TriangleAlert aria-hidden="true" className="h-6 w-6" />
        </div>

        <h1
          ref={headingRef}
          tabIndex={-1}
          className="mt-4 text-lg font-semibold tracking-tight text-[color:var(--text-heading)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        >
          {heading}
        </h1>

        <p role="alert" className="mt-2 text-sm leading-relaxed text-[color:var(--text-muted)]">
          {explanation}
        </p>

        {error.digest && (
          <div className="mt-4 rounded-lg bg-[color:var(--surface-subtle)] p-2 font-mono text-xs text-[color:var(--text-muted)]">
            Digest: {error.digest}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2">
          {chunkLoad ? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={cn(
                commandControl,
                "flex min-h-12 items-center justify-center gap-2 px-4 py-2 text-sm font-medium",
              )}
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              Reload page
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                startTransition(() => {
                  router?.refresh();
                  reset();
                });
              }}
              className={cn(
                commandControl,
                "flex min-h-12 items-center justify-center gap-2 px-4 py-2 text-sm font-medium",
              )}
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              Try again
            </button>
          )}

          {showReload && !chunkLoad && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-sm font-medium text-[color:var(--text)] transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            >
              Reload page
            </button>
          )}

          <button
            type="button"
            onClick={copyDiagnostics}
            className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-sm font-medium text-[color:var(--text)] transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          >
            {copied ? (
              <Check aria-hidden="true" className="h-4 w-4 text-[color:var(--success)]" />
            ) : (
              <ClipboardCopy aria-hidden="true" className="h-4 w-4" />
            )}
            {copied ? "Copied diagnostics" : copyFailed ? "Copy failed — try again" : "Copy diagnostics"}
          </button>
        </div>
      </div>
    </Container>
  );
}
