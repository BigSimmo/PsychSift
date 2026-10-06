"use client";

import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Ellipsis,
  Eye,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RefreshCw,
  RotateCw,
  UnfoldHorizontal,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { VIEWER_MAX_ZOOM, VIEWER_MIN_ZOOM, VIEWER_ZOOM_STEP } from "@/components/document-viewer/viewer-zoom";
import { cn, controlDisabled, textMuted } from "@/components/ui-primitives";

export type DocumentFrameSource =
  | { kind: "pdf-page"; url?: string; page: number; pageCount?: number }
  | { kind: "image"; url?: string }
  | { kind: "document"; url?: string };

export type DocumentFrameControls = {
  fitWidth: boolean;
  onFitWidth: () => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  viewingAid: boolean;
  onViewingAidChange: (active: boolean) => void;
  minZoom?: number;
  maxZoom?: number;
  zoomStep?: number;
  disabled?: boolean;
  /**
   * Page navigation. Supplied only by paged sources; when absent the toolbar
   * renders viewing controls alone. There is exactly one page readout in the
   * viewer and it lives here — source renderers own pixels, not chrome.
   */
  page?: number;
  pageCount?: number;
  onPageChange?: (page: number) => void;
  /** Rotation in degrees; the frame only ever advances it by 90. */
  rotation?: number;
  onRotate?: () => void;
  /**
   * Fullscreen is owned here rather than by the source renderer so the chrome
   * goes fullscreen with the document instead of leaving a bare canvas.
   */
  fullscreen?: boolean;
  onFullscreenChange?: (fullscreen: boolean) => void;
};

type DocumentFrameBaseProps = {
  /** Required accessible name for the source page, figure, or document. */
  alt: string;
  /** The URL may be absent while the owning preview state machine obtains it. */
  src: DocumentFrameSource;
  controls?: DocumentFrameControls;
  statusDetail?: ReactNode;
  statusActions?: ReactNode;
  children?: ReactNode;
  className?: string;
};

type DocumentFrameStateProps =
  | {
      state: "loading";
      loadingLabel: string;
      errorMessage?: never;
      onRetry?: never;
      retryLabel?: never;
    }
  | {
      state: "error";
      errorMessage: string;
      onRetry: () => void;
      retryLabel?: string;
      loadingLabel?: never;
    }
  | {
      state: "ready";
      loadingLabel?: never;
      errorMessage?: never;
      onRetry?: never;
      retryLabel?: never;
    };

export type DocumentFrameProps = DocumentFrameBaseProps & DocumentFrameStateProps;

const frameControl = `inline-flex min-h-tap min-w-tap shrink-0 items-center justify-center gap-1.5 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-2 text-xs font-semibold text-[color:var(--text-muted)] shadow-[var(--shadow-inset)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] ${controlDisabled}`;

const frameControlActive =
  "border-[color:var(--clinical-accent)]/35 bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]";

/** Overflow-menu row: full width, left-aligned, same tap target as the toolbar. */
const overflowItem = `inline-flex min-h-tap w-full items-center gap-2.5 rounded-md px-3 text-left text-sm font-semibold text-[color:var(--text)] transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--focus)] ${controlDisabled}`;

function boundedZoom(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Native fullscreen where the browser supports it on a plain element, and a
 * fixed in-app surface where it does not (notably iOS Safari, which only
 * fullscreens video). Both paths report through the same controlled prop.
 */
function useFrameFullscreen(controls: DocumentFrameControls | undefined) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [nativeFallback, setNativeFallback] = useState(false);
  const active = Boolean(controls?.fullscreen);
  const onFullscreenChange = controls?.onFullscreenChange;

  useEffect(() => {
    function syncFromDocument() {
      if (document.fullscreenElement === rootRef.current) return;
      // The browser left fullscreen on its own (Esc, gesture, tab switch).
      // Only correct the owner when we are not on the in-app fallback.
      setNativeFallback((fallback) => {
        if (!fallback) onFullscreenChange?.(false);
        return fallback;
      });
    }

    document.addEventListener("fullscreenchange", syncFromDocument);
    return () => document.removeEventListener("fullscreenchange", syncFromDocument);
  }, [onFullscreenChange]);

  // Parent can clear the controlled flag on document switch without going
  // through exit(). Leave native fullscreen too, or the chrome thinks it is
  // not fullscreen while the browser still is.
  if (!active && nativeFallback) {
    setNativeFallback(false);
  }
  useEffect(() => {
    if (active) return;
    if (document.fullscreenElement === rootRef.current && document.exitFullscreen) {
      void document.exitFullscreen();
    }
  }, [active]);

  // Escape leaves the in-app fallback, which the browser does not own.
  useEffect(() => {
    if (!active || !nativeFallback) return;
    function exitOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setNativeFallback(false);
      onFullscreenChange?.(false);
    }
    window.addEventListener("keydown", exitOnEscape);
    return () => window.removeEventListener("keydown", exitOnEscape);
  }, [active, nativeFallback, onFullscreenChange]);

  const enter = useCallback(async () => {
    const element = rootRef.current;
    onFullscreenChange?.(true);
    if (!element) return;
    try {
      if (document.fullscreenElement === element) return;
      if (element.requestFullscreen) {
        await element.requestFullscreen();
        setNativeFallback(false);
        return;
      }
    } catch {
      // Fall through to the in-app surface below.
    }
    setNativeFallback(true);
  }, [onFullscreenChange]);

  const exit = useCallback(async () => {
    if (document.fullscreenElement === rootRef.current && document.exitFullscreen) {
      await document.exitFullscreen();
    }
    setNativeFallback(false);
    onFullscreenChange?.(false);
  }, [onFullscreenChange]);

  return { rootRef, active, fallback: nativeFallback, enter, exit };
}

function PageControls({
  controls,
  page,
  pageCount,
}: {
  controls: DocumentFrameControls;
  page: number;
  pageCount?: number;
}) {
  const disabled = Boolean(controls.disabled) || typeof controls.onPageChange !== "function";
  const finalPage = pageCount && pageCount > 0 ? pageCount : undefined;
  // A deep link or stale indexed page_count can leave `page` past the real end
  // until the canvas reconciles the route. Bound navigation against that so
  // Previous from 999/10 lands on 9, not 998.
  const currentPage = finalPage ? Math.min(Math.max(page, 1), finalPage) : Math.max(page, 1);

  // Re-sync the input when the route page or the known bounds change — React's
  // supported adjust-state-during-render pattern. Keying off a boolean "editing"
  // flag instead would clobber a half-typed page number on any unrelated
  // re-render of the parent. Bounds matter too: a stale low page_count can clamp
  // the draft until pdf.js reports a higher real count while `page` stays put.
  const [draft, setDraft] = useState(String(currentPage));
  const [syncedPage, setSyncedPage] = useState(page);
  const [syncedPageCount, setSyncedPageCount] = useState(finalPage);
  if (syncedPage !== page || syncedPageCount !== finalPage) {
    setSyncedPage(page);
    setSyncedPageCount(finalPage);
    setDraft(String(currentPage));
  }

  const commit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    const next = Number.isFinite(parsed) ? Math.max(1, finalPage ? Math.min(parsed, finalPage) : parsed) : currentPage;
    setDraft(String(next));
    if (next !== page) controls.onPageChange?.(next);
  };

  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        className={frameControl}
        aria-label="Previous page"
        disabled={disabled || currentPage <= 1}
        onClick={() => controls.onPageChange?.(currentPage - 1)}
      >
        <ChevronLeft aria-hidden="true" className="size-icon-sm" />
      </button>
      <span className="flex shrink-0 items-center gap-1">
        <input
          aria-label="Page number"
          value={draft}
          disabled={disabled}
          inputMode="numeric"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          className="nums h-tap w-10 shrink-0 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] text-center text-xs font-semibold text-[color:var(--text)] outline-none transition focus:border-[color:var(--focus)] disabled:cursor-not-allowed disabled:bg-[color:var(--surface-subtle)] disabled:text-[color:var(--disabled)]"
        />
        <span className={cn("nums shrink-0 whitespace-nowrap text-xs font-semibold", textMuted)}>
          {finalPage ? `/ ${finalPage}` : "/ ?"}
        </span>
      </span>
      <button
        type="button"
        className={frameControl}
        aria-label="Next page"
        disabled={disabled || (finalPage ? currentPage >= finalPage : false)}
        onClick={() => controls.onPageChange?.(currentPage + 1)}
      >
        <ChevronRight aria-hidden="true" className="size-icon-sm" />
      </button>
    </div>
  );
}

/**
 * The viewer's one toolbar. Page navigation, zoom, fit, rotation, the viewing
 * aid and fullscreen all live here; on phones the lower-frequency actions move
 * into an inline overflow menu so the row still fits a 320px viewport.
 *
 * This is not viewport chrome — it scrolls with the frame, so the universal
 * phone header remains the single scroll-hide owner.
 */
function DocumentControls({
  controls,
  page,
  pageCount,
  fullscreen,
  onEnterFullscreen,
  onExitFullscreen,
}: {
  controls: DocumentFrameControls;
  page?: number;
  pageCount?: number;
  fullscreen: boolean;
  onEnterFullscreen: () => void;
  onExitFullscreen: () => void;
}) {
  const minimum = controls.minZoom ?? VIEWER_MIN_ZOOM;
  const maximum = controls.maxZoom ?? VIEWER_MAX_ZOOM;
  const step = controls.zoomStep ?? VIEWER_ZOOM_STEP;
  const zoom = boundedZoom(controls.zoom, minimum, maximum);
  const zoomed = !controls.fitWidth;
  const viewingAidActive = controls.viewingAid && !zoomed;
  const controlsDisabled = Boolean(controls.disabled);
  const canRotate = typeof controls.onRotate === "function";
  const canFullscreen = typeof controls.onFullscreenChange === "function";
  const overflowId = useId();
  const overflowRef = useRef<HTMLDetailsElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const closeOverflow = () => overflowRef.current?.removeAttribute("open");

  // Phone fullscreen is entered from the overflow menu. Once that menu closes,
  // put focus on the now-visible Exit control so the user is never trapped in a
  // canvas with the only escape action hidden in a second menu.
  useEffect(() => {
    if (fullscreen) fullscreenButtonRef.current?.focus({ preventScroll: true });
  }, [fullscreen]);

  const zoomTo = (next: number) => controls.onZoomChange(Number(boundedZoom(next, minimum, maximum).toFixed(3)));

  const fitButton = (className?: string) => (
    <button
      type="button"
      className={cn(frameControl, controls.fitWidth && frameControlActive, className)}
      aria-label="Fit document to width"
      aria-pressed={controls.fitWidth}
      disabled={controlsDisabled}
      onClick={controls.onFitWidth}
    >
      <UnfoldHorizontal aria-hidden="true" className="size-icon-sm" />
      <span className="hidden sm:inline">Fit width</span>
    </button>
  );

  const viewingAidButton = (className?: string) => (
    <button
      type="button"
      className={cn(frameControl, viewingAidActive && frameControlActive, className)}
      aria-label={zoomed ? "Viewing aid unavailable while zoomed" : "Reduce document surround glare"}
      aria-pressed={viewingAidActive}
      disabled={controlsDisabled || zoomed}
      onClick={() => controls.onViewingAidChange(!viewingAidActive)}
    >
      <Eye aria-hidden="true" className="size-icon-sm" />
      <span className="hidden sm:inline">Viewing aid</span>
    </button>
  );

  return (
    <div
      role="toolbar"
      aria-label="Document viewing controls"
      data-testid="document-frame-controls"
      data-print-hide
      className="flex min-w-0 items-center justify-between gap-1.5 sm:flex-wrap sm:justify-end sm:gap-2"
    >
      {typeof page === "number" ? <PageControls controls={controls} page={page} pageCount={pageCount} /> : <span />}

      <div className="flex shrink-0 items-center gap-1.5">
        {/* Six tap targets do not fit a 320px row alongside page navigation, so
            the narrowest phones reach zoom through the overflow (and, once P3
            lands, through pinch). Everything above 380px keeps it inline. */}
        <button
          type="button"
          className={cn(frameControl, "hidden min-[380px]:inline-flex")}
          aria-label="Zoom out"
          disabled={controlsDisabled || zoom <= minimum}
          onClick={() => zoomTo(zoom - step)}
        >
          <Minus aria-hidden="true" className="size-icon-sm" />
        </button>
        <output
          aria-label="Document zoom"
          className={cn("nums hidden min-w-14 text-center text-xs font-semibold sm:block", textMuted)}
        >
          {Math.round(zoom * 100)}%
        </output>
        <button
          type="button"
          className={cn(frameControl, "hidden min-[380px]:inline-flex")}
          aria-label="Zoom in"
          disabled={controlsDisabled || zoom >= maximum}
          onClick={() => zoomTo(zoom + step)}
        >
          <Plus aria-hidden="true" className="size-icon-sm" />
        </button>

        {/* sm+ shows every action inline; phones reach these through the menu. */}
        {fitButton("hidden sm:inline-flex")}
        {canRotate ? (
          <button
            type="button"
            className={cn(frameControl, "hidden sm:inline-flex")}
            aria-label="Rotate page 90 degrees"
            disabled={controlsDisabled}
            onClick={controls.onRotate}
          >
            <RotateCw aria-hidden="true" className="size-icon-sm" />
          </button>
        ) : null}
        {viewingAidButton("hidden sm:inline-flex")}
        {canFullscreen ? (
          <button
            ref={fullscreenButtonRef}
            type="button"
            className={cn(frameControl, fullscreen ? "inline-flex" : "hidden sm:inline-flex")}
            aria-label={fullscreen ? "Exit fullscreen document view" : "Enter fullscreen document view"}
            disabled={controlsDisabled}
            onClick={fullscreen ? onExitFullscreen : onEnterFullscreen}
          >
            {fullscreen ? (
              <Minimize2 aria-hidden="true" className="size-icon-sm" />
            ) : (
              <Maximize2 aria-hidden="true" className="size-icon-sm" />
            )}
          </button>
        ) : null}

        <details ref={overflowRef} className="relative sm:hidden" data-testid="document-frame-overflow">
          {/* role="button" is deliberate: nested under role="toolbar", Chromium
              exposes a bare <summary> as generic, so getByRole('button') and
              assistive tech miss it (Production UI flake on tip 23dfb955). */}
          <summary
            role="button"
            aria-label="More viewing options"
            className={cn(frameControl, "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}
          >
            <Ellipsis aria-hidden="true" className="size-icon-sm" />
          </summary>
          <div
            id={overflowId}
            className="absolute right-0 top-[calc(100%+0.5rem)] z-20 grid w-56 gap-1 rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] p-1.5 shadow-[var(--shadow-inset)]"
          >
            <p className={cn("nums px-3 pt-1 text-xs font-semibold", textMuted)}>Zoom {Math.round(zoom * 100)}%</p>
            <div className="grid grid-cols-2 gap-1 min-[380px]:hidden">
              <button
                type="button"
                className={cn(overflowItem, "justify-center")}
                aria-label="Zoom out"
                disabled={controlsDisabled || zoom <= minimum}
                onClick={() => zoomTo(zoom - step)}
              >
                <Minus aria-hidden="true" className="size-icon-sm" />
              </button>
              <button
                type="button"
                className={cn(overflowItem, "justify-center")}
                aria-label="Zoom in"
                disabled={controlsDisabled || zoom >= maximum}
                onClick={() => zoomTo(zoom + step)}
              >
                <Plus aria-hidden="true" className="size-icon-sm" />
              </button>
            </div>
            <button
              type="button"
              className={cn(overflowItem, controls.fitWidth && "text-[color:var(--clinical-accent)]")}
              aria-pressed={controls.fitWidth}
              disabled={controlsDisabled}
              onClick={() => {
                controls.onFitWidth();
                closeOverflow();
              }}
            >
              <UnfoldHorizontal aria-hidden="true" className="size-icon-sm" />
              Fit width
            </button>
            {canRotate ? (
              <button
                type="button"
                className={overflowItem}
                disabled={controlsDisabled}
                onClick={() => {
                  controls.onRotate?.();
                  closeOverflow();
                }}
              >
                <RotateCw aria-hidden="true" className="size-icon-sm" />
                Rotate 90°
              </button>
            ) : null}
            <button
              type="button"
              className={cn(overflowItem, viewingAidActive && "text-[color:var(--clinical-accent)]")}
              aria-pressed={viewingAidActive}
              disabled={controlsDisabled || zoomed}
              onClick={() => {
                controls.onViewingAidChange(!viewingAidActive);
                closeOverflow();
              }}
            >
              <Eye aria-hidden="true" className="size-icon-sm" />
              Viewing aid
            </button>
            {canFullscreen && !fullscreen ? (
              <button
                type="button"
                className={overflowItem}
                disabled={controlsDisabled}
                onClick={() => {
                  closeOverflow();
                  onEnterFullscreen();
                }}
              >
                <Maximize2 aria-hidden="true" className="size-icon-sm" />
                Fullscreen
              </button>
            ) : null}
          </div>
        </details>
      </div>
    </div>
  );
}

/**
 * A pixel-faithful frame for source documents. The component owns the semantic
 * loading/error/ready shell and, when supplied, the viewer's single viewing
 * toolbar — page navigation, zoom, fit, rotation, viewing aid and fullscreen.
 * Source renderers keep their existing fetch, page, raster, and gesture logic
 * and render no chrome of their own.
 */
export function DocumentFrame({
  alt,
  src,
  state,
  controls,
  statusDetail,
  statusActions,
  children,
  className,
  ...stateProps
}: DocumentFrameProps) {
  const sourcePage = src.kind === "pdf-page" ? Math.max(1, Math.trunc(src.page)) : undefined;
  const sourcePageCount =
    src.kind === "pdf-page" && typeof src.pageCount === "number"
      ? Math.max(sourcePage ?? 1, Math.trunc(src.pageCount))
      : undefined;
  const viewingAidActive = Boolean(controls?.viewingAid && controls.fitWidth && !controls.disabled);
  const { rootRef, active: fullscreenActive, fallback: fullscreenFallback, enter, exit } = useFrameFullscreen(controls);
  // Page navigation belongs to the toolbar only when the source is paged and the
  // owner supplied a handler; the readout otherwise stays out of the row.
  const toolbarPage = typeof controls?.page === "number" ? controls.page : sourcePage;
  const toolbarPageCount = controls?.pageCount ?? sourcePageCount;

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={alt}
      aria-busy={state === "loading" || undefined}
      data-testid="document-frame"
      data-document-frame
      data-source-kind={src.kind}
      data-state={state}
      data-viewing-aid={viewingAidActive ? "on" : "off"}
      data-fullscreen={fullscreenActive ? "on" : undefined}
      data-fullscreen-fallback={fullscreenFallback ? "on" : undefined}
      className={cn(
        "min-w-0 overflow-hidden bg-[color:var(--surface-raised)]",
        fullscreenActive && "fixed inset-0 z-[80] flex flex-col bg-[color:var(--surface)]",
        className,
      )}
    >
      {controls ? (
        <div
          data-print-hide
          className={cn(
            "flex min-w-0 shrink-0 flex-col gap-2 border-b border-[color:var(--border-lux)] bg-[color:var(--surface-glass)] p-2 shadow-[var(--e1)] sm:flex-row sm:items-center sm:justify-between sm:p-3",
            fullscreenActive &&
              "pt-[max(0.5rem,var(--safe-area-top))] pr-[max(0.5rem,var(--safe-area-right))] pl-[max(0.5rem,var(--safe-area-left))]",
          )}
        >
          <DocumentControls
            controls={controls}
            page={typeof controls.onPageChange === "function" ? toolbarPage : undefined}
            pageCount={toolbarPageCount}
            fullscreen={fullscreenActive}
            onEnterFullscreen={() => void enter()}
            onExitFullscreen={() => void exit()}
          />
        </div>
      ) : null}

      <div
        data-testid="document-frame-surround"
        data-print-keep-together
        className={cn(
          "relative grid min-h-64 place-items-center break-inside-avoid bg-[color:var(--surface-inset)] p-3 shadow-[var(--shadow-inset)] sm:min-h-72 sm:p-4 print:min-h-0 print:break-inside-avoid print:bg-transparent print:p-0 print:shadow-none",
          viewingAidActive && "bg-[color:var(--background)]",
          fullscreenActive && "min-h-0 flex-1 items-stretch overflow-hidden",
        )}
      >
        {state === "loading" ? (
          <div role="status" className="grid min-h-56 place-items-center p-5 text-center sm:min-h-64">
            <div>
              <Loader2
                aria-hidden="true"
                className="mx-auto mb-3 size-icon-md animate-spin text-[color:var(--clinical-accent)] motion-reduce:animate-none"
              />
              <p className="text-sm font-semibold text-[color:var(--text)]">{stateProps.loadingLabel}</p>
              {statusDetail}
              {statusActions ? <div className="mt-3 flex flex-wrap justify-center gap-2">{statusActions}</div> : null}
            </div>
          </div>
        ) : state === "error" ? (
          <div role="alert" className="grid min-h-56 place-items-center p-5 text-center sm:min-h-64">
            <div className="max-w-md">
              <CircleAlert aria-hidden="true" className="mx-auto mb-2 size-icon-lg text-[color:var(--danger)]" />
              <p className="font-semibold text-[color:var(--text)]">Preview unavailable</p>
              <p className="mt-1 text-sm text-[color:var(--danger)]">{stateProps.errorMessage}</p>
              {statusDetail}
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <button type="button" onClick={stateProps.onRetry} className={frameControl}>
                  <RefreshCw aria-hidden="true" className="size-icon-sm" />
                  {stateProps.retryLabel ?? "Retry preview"}
                </button>
                {statusActions}
              </div>
            </div>
          </div>
        ) : (
          <div
            data-testid="document-frame-content"
            className={cn(
              "relative w-full min-w-0 max-w-full break-inside-avoid print:break-inside-avoid",
              fullscreenActive && "flex min-h-0 flex-1 flex-col",
            )}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
