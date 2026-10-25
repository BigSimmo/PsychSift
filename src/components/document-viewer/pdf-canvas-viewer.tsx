"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ExternalLink, FileText, Loader2, RefreshCw } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";

import { cn, floatingControl } from "@/components/ui-primitives";
import {
  resolveCanvasRasterPlan,
  resolveLiveCanvasWindow,
  resolveRenderAheadPages,
} from "@/components/document-viewer/canvas-raster-budget";
import { resolveBboxFrameGeometry, resolveBboxOverlayStyle } from "@/components/document-viewer/bbox-overlay";
import { announce } from "@/components/ui/live-announcer";
import { useViewerGestures } from "@/components/document-viewer/use-viewer-gestures";
import {
  resolveViewerZoomUpdate,
  VIEWER_DEFAULT_ZOOM,
  VIEWER_MAX_ZOOM,
  VIEWER_MIN_ZOOM,
  VIEWER_ZOOM_STEP,
} from "@/components/document-viewer/viewer-zoom";

const secondaryButton = floatingControl;

const MAX_FIT_SCALE = 2.8;

/** Page geometry at pdf.js scale 1, after rotation. */
type PageGeometry = { width: number; height: number };

/**
 * The angle to draw a page at: its own stored /Rotate plus the reader's turn.
 *
 * pdf.js only defaults `getViewport`'s rotation to the page's /Rotate; any value
 * passed replaces it. Passing the reader's rotation alone drew every page stored
 * as rotated landscape (dosing tables, scanned guidelines) sideways at 0°.
 */
function resolvePageRotation(pageRotate: number | undefined, readerRotation: number): number {
  const total = (Number.isFinite(pageRotate) ? Number(pageRotate) : 0) + readerRotation;
  return ((total % 360) + 360) % 360;
}

// A signed URL that has passed its (10-min) TTL fails pdf.js with an auth/HTTP
// error rather than a parse error. Detect those so the parent can re-issue a
// fresh URL, without mistaking a genuinely corrupt PDF for an expiry.
function isLikelyExpiredUrl(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as { status?: number }).status;
  if (status === 400 || status === 401 || status === 403) return true;
  return (
    error.name === "UnexpectedResponseException" ||
    /\b(400|401|403)\b/.test(error.message) ||
    /unexpected server response|forbidden|expired/i.test(error.message)
  );
}

/**
 * The layout scale one page is drawn at — fit-to-width, or the reader's zoom.
 *
 * Three things must agree on this number or the column jitters: the raster
 * itself, the memory budget that decides how many pages may be retained, and the
 * box each slot reserves for a page it has not rendered yet. A slot that
 * reserves a different height than its page renders at moves every page below it
 * the moment that page paints.
 *
 * `contentWidth` is the holder's content box — its padding already removed. The
 * previous single-page viewer subtracted a fixed 16px from `clientWidth`, which
 * is right at `p-2` and 16px short at `sm:p-4`, so the fit scale ran slightly
 * wide and `max-width: 100%` clamped the canvas back. That was invisible with
 * one canvas and an explicit height; with reserved boxes it is a layout shift.
 */
function resolveViewportScale({
  fitWidth,
  contentWidth,
  baseWidth,
  renderZoom,
}: {
  fitWidth: boolean;
  contentWidth: number;
  baseWidth: number;
  renderZoom: number;
}): number {
  const availableWidth = Math.max(220, contentWidth);
  const requested = fitWidth
    ? Math.min(MAX_FIT_SCALE, Math.max(VIEWER_MIN_ZOOM, availableWidth / Math.max(baseWidth, 1)))
    : renderZoom;
  return Math.min(VIEWER_MAX_ZOOM, Math.max(VIEWER_MIN_ZOOM, requested));
}

/** Save-Data / effective connection type, when the browser reports them. */
function readConnectionHints(): { saveData: boolean; effectiveType?: string } {
  if (typeof navigator === "undefined") return { saveData: false };
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  return { saveData: Boolean(connection?.saveData), effectiveType: connection?.effectiveType };
}

/**
 * One page of the reading column.
 *
 * The slot always occupies its page's box, whether or not a canvas is currently
 * rendered into it, so the scroll geometry a reader navigates by does not change
 * when a far page is disposed. Pages outside the render window keep their box
 * and drop their backing store — that is the whole trade virtualization makes.
 *
 * Memoised because the owner re-renders on every scroll-derived page change: a
 * slot whose inputs did not change must not re-rasterise just because the reader
 * moved somewhere else in the document.
 */
const PdfPageSlot = memo(function PdfPageSlot({
  pdf,
  pageNumber,
  title,
  render,
  fitWidth,
  renderZoom,
  rotation,
  contentWidth,
  fallbackGeometry,
  highlightedBbox,
  registerSlot,
  onGeometry,
  onRenderStateChange,
  onRenderError,
}: {
  pdf: PDFDocumentProxy | null;
  pageNumber: number;
  title: string;
  /** True when this page is inside the current render window. */
  render: boolean;
  fitWidth: boolean;
  renderZoom: number;
  rotation: number;
  /** The holder's content-box width, padding already removed. */
  contentWidth: number;
  /** The first measured page's geometry, reserving a box for pages not yet loaded. */
  fallbackGeometry: PageGeometry | null;
  highlightedBbox?: [number, number, number, number] | null;
  registerSlot: (pageNumber: number, element: HTMLDivElement | null) => void;
  onGeometry: (pageNumber: number, geometry: PageGeometry) => void;
  onRenderStateChange: (pageNumber: number, rendering: boolean) => void;
  onRenderError: (pageNumber: number, error: Error) => void;
}) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [geometry, setGeometry] = useState<PageGeometry | null>(null);
  const [painted, setPainted] = useState(false);
  // A page that fails to render shows its error in its own slot, so the rest of
  // the column stays mounted and readable. Bumping `renderAttempt` retries this
  // page alone; leaving the render window clears the failure for a fresh try.
  const [renderFailed, setRenderFailed] = useState(false);
  const [renderAttempt, setRenderAttempt] = useState(0);

  useEffect(() => {
    registerSlot(pageNumber, slotRef.current);
    return () => registerSlot(pageNumber, null);
  }, [pageNumber, registerSlot]);

  useEffect(() => {
    if (!render || !pdf) return () => undefined;
    const activePdf = pdf;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    // Local to this effect run so a rapid page change cannot clean up the next
    // page via a shared ref (Sentry 15801413).
    let pageToCleanup: PDFPageProxy | null = null;

    async function renderPage() {
      onRenderStateChange(pageNumber, true);
      try {
        const pdfPage = await activePdf.getPage(pageNumber);
        if (cancelled) {
          // getPage resolved after we left this page — release it here so the
          // next effect's page is never touched by this run's cleanup.
          pdfPage.cleanup();
          return;
        }
        pageToCleanup = pdfPage;
        const canvas = canvasRef.current;
        if (!canvas) return;
        // Rotation is applied in the viewport so width/height already reflect the
        // 90°/270° swap — the fit calculation and canvas sizing follow for free.
        const pageRotation = resolvePageRotation(pdfPage.rotate, rotation);
        const baseViewport = pdfPage.getViewport({ scale: 1, rotation: pageRotation });
        const measured = { width: baseViewport.width, height: baseViewport.height };
        setGeometry(measured);
        onGeometry(pageNumber, measured);

        const viewportScale = resolveViewportScale({
          fitWidth,
          contentWidth,
          baseWidth: baseViewport.width,
          renderZoom,
        });
        // WebKit paints nothing at all above ~2^24 canvas pixels, and this page
        // at full device density can ask for three times that. Give up raster
        // density before layout size — a soft page reads, a blank one does not.
        const { outputScale } = resolveCanvasRasterPlan({
          baseWidth: baseViewport.width,
          baseHeight: baseViewport.height,
          viewportScale,
          devicePixelRatio: window.devicePixelRatio,
        });
        const viewport = pdfPage.getViewport({ scale: viewportScale * outputScale, rotation: pageRotation });
        const context = canvas.getContext("2d");
        if (!context) {
          setRenderFailed(true);
          onRenderError(pageNumber, new Error("Could not initialize the PDF canvas."));
          return;
        }
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.imageSmoothingEnabled = true;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(baseViewport.width * viewportScale)}px`;
        canvas.style.height = `${Math.floor(baseViewport.height * viewportScale)}px`;
        canvas.style.maxWidth = fitWidth ? "100%" : "none";

        renderTask = pdfPage.render({
          canvasContext: context,
          canvas,
          viewport,
        });
        await renderTask.promise;
        if (!cancelled) {
          setPainted(true);
          setRenderFailed(false);
        }
      } catch (renderError) {
        if (!cancelled && renderError instanceof Error && renderError.name !== "RenderingCancelledException") {
          setRenderFailed(true);
          onRenderError(pageNumber, renderError);
        }
      } finally {
        if (!cancelled) onRenderStateChange(pageNumber, false);
      }
    }

    renderPage();
    return () => {
      cancelled = true;
      onRenderStateChange(pageNumber, false);
      renderTask?.cancel();
      // Release this run's page only. pdf.js declines while a render is still
      // live, so cancel above cannot be cut short by cleanup.
      pageToCleanup?.cleanup();
    };
  }, [
    contentWidth,
    fitWidth,
    onGeometry,
    onRenderError,
    onRenderStateChange,
    pageNumber,
    pdf,
    render,
    renderAttempt,
    renderZoom,
    rotation,
  ]);

  // A canvas keeps its backing store until the element is collected, which on a
  // phone is memory held for a page the reader has already scrolled past — and
  // in a virtualized column, for every page they have ever visited. Zeroing the
  // dimensions releases it when the page leaves the window, not at some later
  // collection.
  //
  // Capture the concrete node while `render` is true so that when the effect
  // re-runs with `render === false` the canvas has already been removed from the
  // DOM and `canvasRef.current` is null — using the captured reference ensures
  // the cleanup always has access to the element.
  useEffect(() => {
    if (!render) return;
    const canvas = canvasRef.current;
    return () => {
      if (!canvas) return;
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [render]);

  useEffect(() => {
    if (!render) {
      setPainted(false);
      setRenderFailed(false);
    }
  }, [render]);

  const reservedGeometry = geometry ?? fallbackGeometry;
  const reservedScale = reservedGeometry
    ? resolveViewportScale({ fitWidth, contentWidth, baseWidth: reservedGeometry.width, renderZoom })
    : 1;

  // Stored point-space boxes are in the page's own frame (its /Rotate already
  // applied by extraction), so only the reader's turn is applied on top, against
  // the page's size before that turn.
  const overlayStyle = resolveBboxOverlayStyle({
    bbox: highlightedBbox,
    pageGeometry: resolveBboxFrameGeometry(reservedGeometry, rotation),
    rotation,
  });

  return (
    <div
      ref={slotRef}
      data-page={pageNumber}
      data-testid="pdf-page-slot"
      data-rendered={render ? "true" : "false"}
      className="relative flex w-full shrink-0 justify-center"
      style={
        // Reserve the page's box up front. Without this the column collapses to
        // nothing for unrendered pages, every slot lands on the same scroll
        // offset, and the observer that derives the reader's page has nothing to
        // measure.
        reservedGeometry
          ? {
              height: `${Math.floor(reservedGeometry.height * reservedScale)}px`,
              minHeight: `${Math.floor(reservedGeometry.height * reservedScale)}px`,
            }
          : undefined
      }
    >
      {render ? (
        <div
          className={cn(
            "relative mx-auto max-w-full self-start",
            // A page that failed before it was measured has no reserved box to
            // hold its error card, so give the card room of its own.
            renderFailed && !reservedGeometry && "min-h-72 w-full",
          )}
          style={
            reservedGeometry
              ? {
                  width: `${Math.floor(reservedGeometry.width * reservedScale)}px`,
                  height: `${Math.floor(reservedGeometry.height * reservedScale)}px`,
                  maxWidth: fitWidth ? "100%" : "none",
                }
              : undefined
          }
        >
          <canvas
            ref={canvasRef}
            aria-label={`${title} page ${pageNumber}`}
            className={cn(
              "block h-full w-full max-w-full rounded-lg bg-[color:var(--surface)] shadow-[var(--e1)] transition-opacity duration-[var(--duration-quick)] motion-reduce:transition-none",
              painted ? "opacity-100" : "opacity-0",
            )}
          />
          {overlayStyle && painted ? (
            <div
              data-testid="pdf-bbox-highlight"
              aria-hidden="true"
              className="pointer-events-none absolute z-10 rounded border-2 border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)]/15 shadow-[var(--glow-primary)]"
              style={{
                left: overlayStyle.left,
                top: overlayStyle.top,
                width: overlayStyle.width,
                height: overlayStyle.height,
              }}
            />
          ) : null}
          {renderFailed ? (
            <div
              data-testid="pdf-page-render-error"
              className="absolute inset-0 z-10 grid place-items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-center text-sm text-[color:var(--text-muted)]"
            >
              <div>
                <FileText aria-hidden="true" className="mx-auto mb-2 h-8 w-8" />
                <p>{`Could not display page ${pageNumber} of the PDF.`}</p>
                <button
                  type="button"
                  onClick={() => setRenderAttempt((current) => current + 1)}
                  className={cn(secondaryButton, "mt-3")}
                >
                  <RefreshCw aria-hidden="true" className="h-4 w-4" />
                  Retry page
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div
          aria-hidden="true"
          className="h-full w-full max-w-full rounded-lg bg-[color:var(--surface)] shadow-[var(--shadow-inset)]"
          style={reservedGeometry ? { width: `${Math.floor(reservedGeometry.width * reservedScale)}px` } : undefined}
        />
      )}
    </div>
  );
});

// Memoised: this is the heaviest subtree in the document view (it holds the
// pdf.js document and re-rasters the canvas). With stable props from the parent
// it skips re-render when unrelated parent state (search, composer, connectivity)
// changes, so a keystroke elsewhere never re-rasterises the page.
//
// Every piece of per-page state below — the render window, the scroll-derived
// page, the retained canvases — stays inside this component on purpose. Lifting
// any of it into the parent would defeat that boundary, because the parent
// re-renders for reasons that have nothing to do with the document.
//
// This component renders source pixels and nothing else. Every viewing control —
// page navigation, zoom, fit, rotation, viewing aid, fullscreen — belongs to
// DocumentFrame, so the viewer has exactly one toolbar and one page readout.
export const PdfCanvasViewer = memo(function PdfCanvasViewer({
  url,
  title,
  initialPage,
  onUrlExpired,
  onLoadSuccess,
  onPageChange,
  fitWidth,
  zoom,
  rotation = 0,
  fullscreen = false,
  highlightedBbox,
  highlightedBboxPage,
  onFitWidthChange,
  onZoomChange,
  onRotate,
  onLoadFailedChange,
}: {
  url: string;
  title: string;
  initialPage: number;
  /** Called when a load/render fails in a way consistent with an expired signed URL. */
  onUrlExpired?: () => void;
  /** Called with the document's page count when pdf.js opens it successfully. */
  onLoadSuccess?: (pageCount: number) => void;
  /** Keeps the document route in sync when the reader changes pages. */
  onPageChange?: (page: number) => void;
  /** Controlled viewing state owned by DocumentFrame via DocumentViewer. */
  fitWidth: boolean;
  zoom: number;
  rotation?: number;
  fullscreen?: boolean;
  highlightedBbox?: [number, number, number, number] | null;
  highlightedBboxPage?: number | null;
  onFitWidthChange: (fitWidth: boolean) => void;
  onZoomChange: (zoom: number) => void;
  /**
   * DocumentFrame's rotate action. `rotation` arrives as a controlled prop with
   * no way back, so without this the keyboard could reach every viewing control
   * except rotation. The viewer does not own rotation state — it asks the frame
   * that does, which keeps one toolbar and one source of truth.
   */
  onRotate?: () => void;
  /**
   * Reports whether the document itself failed to open. DocumentFrame's
   * toolbar stays enabled otherwise, so zoom, page and rotate buttons sat live
   * over the "Could not load PDF preview" card and did nothing (audit VUX-07c).
   * A single page failing to render is not reported: its error stays in its
   * own slot and the rest of the column still works.
   */
  onLoadFailedChange?: (failed: boolean) => void;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(0);
  // Debounced mirror of `zoom`. Zoom steps update `zoom` immediately (an interim
  // CSS transform gives instant visual feedback) but only `renderZoom` drives the
  // pdf.js raster, so rapid +/-, wheel, and pinch input re-rasterise once on
  // settle instead of queueing a RenderTask per delta.
  const [renderZoom, setRenderZoom] = useState(VIEWER_DEFAULT_ZOOM);
  // Eager refs so rapid functional updates (wheel/pinch) compose before React
  // re-renders — the zoom lives in a parent, so a closed-over prop would drop
  // every delta but the last (Sentry 15778840).
  const fitWidthRef = useRef(fitWidth);
  const zoomRef = useRef(zoom);
  useLayoutEffect(() => {
    fitWidthRef.current = fitWidth;
    zoomRef.current = zoom;
  }, [fitWidth, zoom]);
  const setFitWidth = useCallback(
    (next: boolean) => {
      fitWidthRef.current = next;
      onFitWidthChange(next);
    },
    [onFitWidthChange],
  );
  const setZoom = useCallback(
    (next: number | ((current: number) => number)) => {
      const clamped = resolveViewerZoomUpdate(zoomRef.current, next);
      zoomRef.current = clamped;
      onZoomChange(clamped);
    },
    [onZoomChange],
  );
  const [contentWidth, setContentWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [renderingPages, setRenderingPages] = useState<ReadonlySet<number>>(() => new Set<number>());
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [referenceGeometry, setReferenceGeometry] = useState<PageGeometry | null>(null);
  // Largest measured raster cost at the current rotation/zoom inputs. A mixed-size
  // PDF can seed referenceGeometry from a cheap page while neighbours are much
  // larger; budgeting only against the cheap seed would let retained canvases
  // exceed MAX_LIVE_CANVAS_PIXELS.
  const [maxObservedCanvasPixels, setMaxObservedCanvasPixels] = useState(0);

  const onUrlExpiredRef = useRef(onUrlExpired);
  const onLoadSuccessRef = useRef(onLoadSuccess);
  const onPageChangeRef = useRef(onPageChange);
  const urlRef = useRef(url);
  const reportedExpiredUrlRef = useRef<string | null>(null);
  useEffect(() => {
    onUrlExpiredRef.current = onUrlExpired;
  }, [onUrlExpired]);
  useEffect(() => {
    onLoadSuccessRef.current = onLoadSuccess;
  }, [onLoadSuccess]);
  useEffect(() => {
    onPageChangeRef.current = onPageChange;
  }, [onPageChange]);
  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  // Announce canvas-level failures that happen while DocumentFrame is already
  // "ready" (signed URL issued) — otherwise a post-load render failure is silent
  // for screen-reader users (#219).
  useEffect(() => {
    if (!error) return;
    announce(error, {
      priority: "assertive",
      eventId: `pdf-canvas-preview:${url}:${error}`,
    });
  }, [error, url]);

  const loadFailed = Boolean(error) && !pdf;
  const onLoadFailedChangeRef = useRef(onLoadFailedChange);
  useEffect(() => {
    onLoadFailedChangeRef.current = onLoadFailedChange;
  }, [onLoadFailedChange]);
  useEffect(() => {
    onLoadFailedChangeRef.current?.(loadFailed);
  }, [loadFailed]);
  useEffect(() => () => onLoadFailedChangeRef.current?.(false), []);

  // Report an expired URL at most once per URL, so a load failure and a
  // subsequent render failure don't both fire a refresh for the same URL.
  const reportUrlExpired = useCallback(() => {
    const current = urlRef.current;
    if (reportedExpiredUrlRef.current === current) return;
    reportedExpiredUrlRef.current = current;
    onUrlExpiredRef.current?.();
  }, []);

  useEffect(() => {
    let active = true;
    let loadTask: PDFDocumentLoadingTask | null = null;

    async function loadPdf() {
      setLoading(true);
      setError(null);
      setPdf(null);
      setTotalPages(0);
      setReferenceGeometry(null);
      try {
        // The legacy build, not the default one. The default build of pdf.js 6
        // calls `Map.prototype.getOrInsertComputed`, which only recent browsers
        // have (Chromium 151+), so on an older phone or a hospital-managed
        // desktop every page failed with "Could not display this page of the
        // PDF". The legacy build carries its own polyfills and draws the same
        // pages. The worker must come from the same build.
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        // Range-fetch on demand instead of pulling the whole file down. pdf.js
        // otherwise keeps fetching the rest of the document in the background
        // even when the reader only ever looks at one page — the wrong default
        // for a long guideline opened on a phone, on cellular. `disableAutoFetch`
        // does not take effect without `disableStream`; the installed types say
        // so explicitly.
        //
        // Virtualization renders ahead, which pulls bytes this flag exists to
        // hold back — so the render-ahead policy is bounded to ±1 page, deferred
        // to idle, and switched off entirely under Save-Data or a 2g connection
        // (`resolveRenderAheadPages`). Resident pages top out at three; the
        // document is still never fetched whole.
        //
        // The trade is that later bytes are requested later, so a signed URL can
        // expire mid-read. That path already exists and recovers: a range failure
        // is an auth/HTTP error, `isLikelyExpiredUrl` catches it, and the parent
        // re-issues the URL. Its refresh budget resets on every successful load,
        // so a long reading session is not capped at two recoveries.
        loadTask = pdfjs.getDocument({ url, disableAutoFetch: true, disableStream: true });
        const loadedPdf = await loadTask.promise;
        if (!active) return;
        setPdf(loadedPdf);
        setTotalPages(loadedPdf.numPages);
        setPage((current) => Math.min(Math.max(current, 1), loadedPdf?.numPages ?? current));
        // A valid load means any prior expiry was genuinely recovered — let the
        // parent restore the refresh budget so a long session isn't dead-ended.
        onLoadSuccessRef.current?.(loadedPdf.numPages);
      } catch (loadError) {
        if (active) {
          if (isLikelyExpiredUrl(loadError)) reportUrlExpired();
          // A library's own message ("...getOrInsertComputed is not a function") tells
          // the reader nothing about whether the document is missing, the link expired,
          // or the browser is too old — and `error` is also announced assertively, so a
          // minified internal would be read aloud. Keep the detail in the console.
          console.error("[pdf-canvas-viewer] PDF load failed", loadError);
          setError("Could not load PDF preview.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadPdf();
    return () => {
      active = false;
      setPdf(null);
      void loadTask?.destroy();
    };
  }, [loadAttempt, reportUrlExpired, url]);

  // ---------------------------------------------------------------------------
  // Page ↔ scroll ↔ route synchronisation
  //
  // Three things can move the reader: the route (deep link, toolbar, rail
  // filmstrip), the keyboard, and their own scrolling. Flow is deliberately
  // one-way to stop those fighting each other: intent scrolls the column, the
  // column's scroll position derives the displayed page, and the derived page
  // only writes back to the route when it did NOT come from a programmatic
  // scroll. Without that gate a route-driven jump derives its own page, writes
  // it back to the route, and re-enters this loop on every frame of the scroll.
  // ---------------------------------------------------------------------------
  const slotElementsRef = useRef(new Map<number, HTMLDivElement>());
  const intersectionRef = useRef(new Map<number, number>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const pendingScrollTargetRef = useRef<number | null>(null);
  const pendingScrollTimerRef = useRef<number | null>(null);
  const lastRoutePageRef = useRef(initialPage);
  const pageRef = useRef(page);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  const registerSlot = useCallback((pageNumber: number, element: HTMLDivElement | null) => {
    const previous = slotElementsRef.current.get(pageNumber);
    if (previous && observerRef.current) observerRef.current.unobserve(previous);
    if (element) {
      slotElementsRef.current.set(pageNumber, element);
      observerRef.current?.observe(element);
      return;
    }
    slotElementsRef.current.delete(pageNumber);
    intersectionRef.current.delete(pageNumber);
  }, []);

  const clearPendingScroll = useCallback(() => {
    pendingScrollTargetRef.current = null;
    if (pendingScrollTimerRef.current !== null) {
      window.clearTimeout(pendingScrollTimerRef.current);
      pendingScrollTimerRef.current = null;
    }
  }, []);

  /**
   * Declare that a programmatic move to `target` is in flight.
   *
   * Armed the moment the intent is known rather than when the scroll executes.
   * The scroll itself has to wait a frame for the target slot to exist, and any
   * intersection that lands in that gap would otherwise be read as the reader
   * choosing a page — writing it to the route and cancelling the jump they
   * actually asked for.
   */
  const armPendingScroll = useCallback((target: number) => {
    pendingScrollTargetRef.current = target;
    if (pendingScrollTimerRef.current !== null) window.clearTimeout(pendingScrollTimerRef.current);
    // The observer releases this the moment the scroll settles on the target;
    // the timer is only the backstop for a scroll that never gets there.
    pendingScrollTimerRef.current = window.setTimeout(() => {
      pendingScrollTargetRef.current = null;
      pendingScrollTimerRef.current = null;
    }, 600);
  }, []);

  /** Move the column to a page without letting the move write back to the route. */
  const scrollToPage = useCallback(
    (target: number) => {
      const holder = holderRef.current;
      const slot = slotElementsRef.current.get(target);
      // Scroll the holder itself rather than `scrollIntoView`, which would also
      // scroll every ancestor and drag the whole document route with it.
      const delta = holder && slot ? slot.getBoundingClientRect().top - holder.getBoundingClientRect().top : 0;

      // Nothing moved, so there is no echo to swallow — and holding the gate open
      // anyway would deafen the viewer to the reader's own scrolling for as long
      // as the timeout lasts, which is exactly the page-tracking bug it exists to
      // prevent in the other direction.
      if (!holder || !slot || Math.abs(delta) < 1) {
        clearPendingScroll();
        return;
      }

      armPendingScroll(target);
      holder.scrollTop += delta;
    },
    [armPendingScroll, clearPendingScroll],
  );

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || typeof IntersectionObserver === "undefined") return () => undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const slotPage = Number(entry.target.getAttribute("data-page"));
          if (!Number.isFinite(slotPage) || slotPage < 1) continue;
          intersectionRef.current.set(slotPage, entry.intersectionRatio);
        }

        let best = 0;
        let bestRatio = -1;
        for (const [slotPage, ratio] of intersectionRef.current) {
          if (ratio > bestRatio || (ratio === bestRatio && best !== 0 && slotPage < best)) {
            best = slotPage;
            bestRatio = ratio;
          }
        }
        if (best < 1 || bestRatio <= 0) return;

        // A programmatic jump is still settling: adopt its target and stay quiet
        // until the reader's own scrolling takes over again.
        if (pendingScrollTargetRef.current !== null) {
          if (best === pendingScrollTargetRef.current) clearPendingScroll();
          return;
        }
        if (best === pageRef.current) return;
        pageRef.current = best;
        setPage(best);
        // Only a reader-driven change writes the route.
        if (best !== lastRoutePageRef.current) {
          lastRoutePageRef.current = best;
          onPageChangeRef.current?.(best);
        }
      },
      { root: holder, threshold: [0, 0.15, 0.35, 0.6, 0.85, 1] },
    );

    observerRef.current = observer;
    for (const element of slotElementsRef.current.values()) observer.observe(element);
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [clearPendingScroll, totalPages]);

  useEffect(() => clearPendingScroll, [clearPendingScroll]);

  // Route-driven page changes (deep link, toolbar, rail filmstrip, keyboard).
  //
  // This effect re-runs whenever the page count lands, which is always AFTER the
  // reader can have started scrolling. It must therefore act only when the route
  // is asking for somewhere the reader is not — an unconditional "go to
  // initialPage" would drag them back to page 1 every time pdf.js reported its
  // page count, and again on every later correction to it.
  useEffect(() => {
    const nextPage = Math.max(1, initialPage || 1);
    const boundedPage = totalPages > 0 ? Math.min(nextPage, totalPages) : nextPage;
    lastRoutePageRef.current = boundedPage;

    // pdf.js is authoritative for page count. A deep link or stale indexed
    // page_count can leave the frame toolbar on an out-of-range route value
    // while the canvas shows the clamped page — reconcile the parent route. This
    // is independent of where the reader is, so it happens either way.
    if (totalPages > 0 && boundedPage !== nextPage) {
      onPageChangeRef.current?.(boundedPage);
    }

    if (boundedPage === pageRef.current) return () => undefined;
    pageRef.current = boundedPage;
    setPage(boundedPage);
    armPendingScroll(boundedPage);
    // Scroll on the next frame so the slot for the target page exists to measure.
    // If it still does not (a deep link that lands before the first raster), the
    // re-anchor effect below picks it up when the geometry arrives.
    const frame = window.requestAnimationFrame(() => scrollToPage(boundedPage));
    return () => window.cancelAnimationFrame(frame);
  }, [armPendingScroll, initialPage, scrollToPage, totalPages]);

  // Re-anchor the column on its current page whenever every slot's box changes
  // size underneath the reader.
  //
  // Reserved boxes are computed from a scale, so a zoom step, a fit toggle, a
  // rotation, a resize, or the arrival of the first measured geometry all resize
  // every slot at once — and a scroll offset that meant "page 12" before means
  // some arbitrary point in the document afterwards. Re-anchoring is what makes
  // those actions feel like they operate on the page the reader is looking at.
  // It cannot fight the reader's own scrolling because none of these inputs
  // change while they scroll.
  useEffect(() => {
    if (!pdf || totalPages < 1) return () => undefined;
    const frame = window.requestAnimationFrame(() => scrollToPage(pageRef.current));
    return () => window.cancelAnimationFrame(frame);
  }, [contentWidth, fitWidth, pdf, referenceGeometry, renderZoom, rotation, scrollToPage, totalPages]);

  useEffect(() => {
    if (!holderRef.current) return;
    let timeout: number | undefined;
    const observer = new ResizeObserver((entries) => {
      // The content box, so the fit scale and the reserved slot boxes are both
      // computed from the width a page can actually occupy.
      const width = Math.round(entries[0]?.contentRect.width ?? 0);
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => setContentWidth(width), 120);
    });

    observer.observe(holderRef.current);
    return () => {
      window.clearTimeout(timeout);
      observer.disconnect();
    };
  }, []);

  // Settle rapid zoom deltas into a single raster. The interim CSS transform on
  // the column keeps the view visually correct during this window.
  useEffect(() => {
    if (renderZoom === zoom) return () => undefined;
    const timeout = window.setTimeout(() => setRenderZoom(zoom), 140);
    return () => window.clearTimeout(timeout);
  }, [renderZoom, zoom]);

  // ---------------------------------------------------------------------------
  // Render window
  // ---------------------------------------------------------------------------
  const perCanvasPixels = useMemo(() => {
    if (!referenceGeometry) return maxObservedCanvasPixels;
    const viewportScale = resolveViewportScale({
      fitWidth,
      contentWidth,
      baseWidth: referenceGeometry.width,
      renderZoom,
    });
    const plan = resolveCanvasRasterPlan({
      baseWidth: referenceGeometry.width,
      baseHeight: referenceGeometry.height,
      viewportScale,
      devicePixelRatio: typeof window === "undefined" ? 1 : window.devicePixelRatio,
    });
    return Math.max(plan.width * plan.height, maxObservedCanvasPixels);
  }, [contentWidth, fitWidth, maxObservedCanvasPixels, referenceGeometry, renderZoom]);

  const liveCanvasLimit = useMemo(() => resolveLiveCanvasWindow({ perCanvasPixels }), [perCanvasPixels]);

  // Neighbour pages wait for idle. A reader flipping quickly through a document
  // never reaches idle, so they never pay for the pages they are passing.
  const [renderAheadReady, setRenderAheadReady] = useState(false);
  useEffect(() => {
    setRenderAheadReady(false);
    if (!pdf || totalPages <= 1 || liveCanvasLimit <= 1) return () => undefined;

    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(() => setRenderAheadReady(true), { timeout: 1500 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(() => setRenderAheadReady(true), 400);
    return () => window.clearTimeout(timer);
  }, [fitWidth, liveCanvasLimit, page, pdf, renderZoom, rotation, totalPages]);

  const renderPages = useMemo(() => {
    const { saveData, effectiveType } = readConnectionHints();
    return new Set(
      resolveRenderAheadPages({
        activePage: page,
        totalPages,
        liveCanvasLimit,
        renderAhead: renderAheadReady,
        saveData,
        effectiveType,
      }),
    );
  }, [liveCanvasLimit, page, renderAheadReady, totalPages]);

  // The first page that renders seeds the reserved box for every page that has
  // not loaded yet — deliberately the first to render rather than page 1, so a
  // deep link straight to page 50 still gets a sized column. Measuring every page
  // up front would mean fetching every page, which is the cost virtualization
  // exists to avoid; mixed-size documents correct each slot as it renders.
  const handleGeometry = useCallback(
    (_pageNumber: number, geometry: PageGeometry) => {
      setReferenceGeometry((current) => current ?? geometry);
      const viewportScale = resolveViewportScale({
        fitWidth,
        contentWidth,
        baseWidth: geometry.width,
        renderZoom,
      });
      const plan = resolveCanvasRasterPlan({
        baseWidth: geometry.width,
        baseHeight: geometry.height,
        viewportScale,
        devicePixelRatio: typeof window === "undefined" ? 1 : window.devicePixelRatio,
      });
      const cost = plan.width * plan.height;
      setMaxObservedCanvasPixels((current) => Math.max(current, cost));
    },
    [contentWidth, fitWidth, renderZoom],
  );

  // Rotation changes the page's physical dimensions (portrait ↔ landscape). The
  // reference geometry must be discarded so the first page to render after the
  // rotation seeds a fresh, correct fallback — otherwise unrendered slots keep
  // the pre-rotation dimensions and slots jump as they render into their new size.
  const prevRotationRef = useRef(rotation);
  useEffect(() => {
    if (prevRotationRef.current !== rotation) {
      prevRotationRef.current = rotation;
      setReferenceGeometry(null);
      setMaxObservedCanvasPixels(0);
    }
  }, [rotation]);

  const handleRenderStateChange = useCallback((pageNumber: number, rendering: boolean) => {
    setRenderingPages((current) => {
      if (rendering === current.has(pageNumber)) return current;
      const next = new Set(current);
      if (rendering) next.add(pageNumber);
      else next.delete(pageNumber);
      return next;
    });
  }, []);

  const handleRenderError = useCallback(
    (pageNumber: number, renderError: Error) => {
      // A range request for ANY page can 403 once the signed URL expires, so a
      // neighbour's failure is just as much an expiry signal as the reader's own
      // page — report it either way, or a background prefetch failure would sit
      // there un-recovered until the reader flipped into it.
      if (isLikelyExpiredUrl(renderError)) reportUrlExpired();
      // The failed slot shows its own error card and the rest of the column
      // stays readable, so a render failure never takes over the whole frame.
      // Only the page the reader is actually looking at is announced: a
      // neighbour rendered ahead is invisible until the reader reaches it.
      if (pageNumber === pageRef.current) {
        // Same reason as the load path above: never surface the library's own message.
        console.error("[pdf-canvas-viewer] PDF page render failed", renderError);
        announce(`Could not display page ${pageNumber} of the PDF.`, {
          priority: "assertive",
          eventId: `pdf-canvas-preview:${urlRef.current}:page-${pageNumber}`,
        });
      }
    },
    [reportUrlExpired],
  );

  const pagesReady = Boolean(pdf && totalPages > 0 && !loading);
  const rendering = renderingPages.has(page);
  const multiPage = pagesReady && totalPages > 1;
  const pageNumbers = useMemo(
    () => Array.from({ length: Math.max(totalPages, 0) }, (_, index) => index + 1),
    [totalPages],
  );

  const goToPage = useCallback(
    (nextPage: number) => {
      const bounded = Math.min(Math.max(nextPage, 1), totalPages || nextPage);
      if (bounded === pageRef.current) return;
      pageRef.current = bounded;
      setPage(bounded);
      lastRoutePageRef.current = bounded;
      armPendingScroll(bounded);
      scrollToPage(bounded);
      onPageChangeRef.current?.(bounded);
    },
    [armPendingScroll, scrollToPage, totalPages],
  );

  const zoomBy = useCallback(
    (delta: number) => {
      setFitWidth(false);
      setZoom((current) => Number((current + delta).toFixed(2)));
    },
    [setFitWidth, setZoom],
  );

  // While a zoom step waits for its debounced raster, scale the last raster with
  // a CSS transform so the view tracks the target zoom instantly. It resets to 1
  // the moment `renderZoom` catches up and the crisp raster paints. Fit mode is
  // sized by the container, so it never carries an interim scale.
  const interimZoomScale = !fitWidth && renderZoom > 0 && zoom !== renderZoom ? zoom / renderZoom : 1;

  const handleZoomByFactor = useCallback(
    (factor: number) => {
      setFitWidth(false);
      setZoom((current) => Number((current * factor).toFixed(3)));
    },
    [setFitWidth, setZoom],
  );

  const handlePanByDelta = useCallback((dx: number, dy: number) => {
    const holder = holderRef.current;
    if (!holder) return;
    holder.scrollLeft -= dx;
    holder.scrollTop -= dy;
  }, []);

  // Pinch is live in fit mode too, which is the viewer's default state. It used
  // to be gated on `!fitWidth`, so a two-finger pinch on a freshly opened
  // document did nothing at all: the holder's `touch-action: pan-y` suppressed
  // the browser's own pinch-zoom, and this hook declined to handle it. That left
  // no way to magnify a page by gesture without first finding a zoom button, and
  // it contradicted the blocking phone clause in docs/design-system/COMPONENTS.md.
  //
  // The first pinch delta drops fit mode (see `handleZoomByFactor`), which
  // switches the holder to `touch-action: none` — so the browser can only
  // contend for the opening moment of the gesture, never the rest of it.
  //
  // Drag-to-pan stays gated on `!fitWidth`: in fit mode the holder is a scroll
  // container and must keep native momentum scrolling.
  const { handlers: gestureHandlers } = useViewerGestures({
    targetRef: holderRef,
    wheelZoom: pagesReady,
    pinchZoom: pagesReady,
    pan: pagesReady && !fitWidth,
    touchPan: true,
    onZoomBy: handleZoomByFactor,
    onPanBy: handlePanByDelta,
  });

  /**
   * Reading-mode key bindings. Documented in `docs/wiring-conventions.md`.
   *
   * | Key                  | Action                |
   * | -------------------- | --------------------- |
   * | Left / Right arrow   | Previous / next page  |
   * | Page Up / Page Down  | Previous / next page  |
   * | Home / End           | First / last page     |
   * | `+` / `=` and `-`    | Zoom in / out         |
   * | `0` or `f`           | Fit to width          |
   * | `r`                  | Rotate 90 degrees     |
   *
   * Modified keystrokes are left alone throughout: Ctrl/Cmd+`0` is the browser's
   * own zoom reset, Cmd+Left is history back on macOS, and a viewer that ate
   * those would be worse than one with no bindings at all.
   */
  function handleHolderKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!pagesReady) return;
    // Only act on keystrokes aimed at the holder itself, so Enter/typing inside
    // child controls (retry button, source links) is never hijacked.
    if (event.target !== event.currentTarget) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    switch (event.key) {
      case "ArrowLeft":
      case "PageUp":
        event.preventDefault();
        // Key-repeat can fire several times before React re-renders; pageRef is
        // updated synchronously inside goToPage, so relative moves must read it.
        goToPage(pageRef.current - 1);
        break;
      case "ArrowRight":
      case "PageDown":
        event.preventDefault();
        goToPage(pageRef.current + 1);
        break;
      case "Home":
        event.preventDefault();
        goToPage(1);
        break;
      case "End":
        event.preventDefault();
        goToPage(totalPages);
        break;
      case "+":
      case "=":
        event.preventDefault();
        zoomBy(VIEWER_ZOOM_STEP);
        break;
      case "-":
        event.preventDefault();
        zoomBy(-VIEWER_ZOOM_STEP);
        break;
      case "0":
      case "f":
      case "F":
        event.preventDefault();
        setFitWidth(true);
        break;
      case "r":
      case "R":
        // Silently inert without the callback rather than swallowing the key:
        // an unhandled `r` still reaches whatever else wants it.
        if (!onRotate) break;
        event.preventDefault();
        onRotate();
        break;
      default:
        break;
    }
  }

  return (
    <div
      data-testid="pdf-canvas-owner"
      className={cn("bg-[color:var(--surface-inset)]", fullscreen && "flex min-h-0 flex-1 flex-col")}
    >
      <div
        data-testid="pdf-canvas-scroll"
        data-multi-page={multiPage ? "true" : undefined}
        ref={holderRef}
        tabIndex={0}
        role="group"
        aria-label={`${title} — page view. Arrow keys or Page Up and Page Down change pages, Home and End jump to the first or last page, plus and minus zoom, F fits the width, R rotates.`}
        onKeyDown={handleHolderKeyDown}
        {...gestureHandlers}
        className={cn(
          "polished-scroll relative flex w-full min-w-0 max-w-full justify-center p-2 [-webkit-overflow-scrolling:touch] focus-visible:outline-2 focus-visible:outline-[color:var(--focus)] sm:p-4",
          // Reserve height only before a page has rendered; once it paints, the
          // holder fits the page so short pages don't float in a tall void.
          !pagesReady && !fullscreen && "min-h-[46vh] sm:min-h-[62vh]",
          fullscreen && "min-h-0 flex-1 sm:min-h-0",
          // A multi-page document reads as one continuous column, so the holder
          // needs a bounded height to be the thing that scrolls. Single-page
          // documents keep exactly the geometry they had: the holder wraps the
          // page and the document route scrolls, as before.
          multiPage && !fullscreen && "max-h-[72vh] sm:max-h-[80vh]",
          // Chain out of the reading pane at its ends rather than trapping the
          // reader inside it — the horizontal axis stays contained so a zoomed
          // pan never turns into a browser back-swipe.
          multiPage && !fullscreen ? "overscroll-x-contain" : "overscroll-contain",
          fitWidth
            ? "overflow-x-hidden overflow-y-auto [touch-action:pan-y]"
            : // Zoomed: we own touch, so pinch-zoom and single-finger drag-pan work.
              "cursor-grab select-none overflow-auto [touch-action:none] active:cursor-grabbing",
        )}
      >
        {(loading || rendering) && (
          <div className="absolute left-3 right-3 top-3 z-10 flex min-h-10 flex-wrap items-center justify-between gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs font-semibold text-[color:var(--text-muted)] shadow-[var(--e1)] sm:left-4 sm:right-auto sm:top-4">
            <span className="inline-flex min-h-8 items-center gap-2">
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-[color:var(--clinical-accent)]" />
              {loading ? "Loading PDF" : "Rendering page"}
            </span>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-tap items-center gap-1.5 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 text-[color:var(--clinical-accent)]"
            >
              <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
              Source PDF
            </a>
          </div>
        )}
        {error ? (
          <div
            data-preview-error="true"
            className="grid min-h-72 place-items-center text-center text-sm text-[color:var(--text-muted)]"
          >
            <div>
              <FileText aria-hidden="true" className="mx-auto mb-2 h-8 w-8" />
              <p>{error}</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setLoadAttempt((current) => current + 1)}
                  className={secondaryButton}
                >
                  <RefreshCw aria-hidden="true" className="h-4 w-4" />
                  Retry preview
                </button>
                <a href={url} target="_blank" rel="noreferrer" className={secondaryButton}>
                  <ExternalLink aria-hidden="true" className="h-4 w-4" />
                  Source PDF
                </a>
              </div>
            </div>
          </div>
        ) : (
          <div
            data-testid="pdf-page-column"
            // `min-w-full w-fit` so a zoomed page wider than the holder extends the
            // column's own box: the holder can then scroll to reach it, instead of
            // the page overflowing a full-width column and clipping on the left.
            className="mx-auto flex w-fit min-w-full flex-col items-center gap-3"
            style={
              interimZoomScale === 1
                ? undefined
                : { transform: `scale(${interimZoomScale})`, transformOrigin: "top center" }
            }
          >
            {pageNumbers.map((pageNumber) => (
              <PdfPageSlot
                key={pageNumber}
                pdf={pdf}
                pageNumber={pageNumber}
                title={title}
                render={renderPages.has(pageNumber)}
                fitWidth={fitWidth}
                renderZoom={renderZoom}
                rotation={rotation}
                contentWidth={contentWidth}
                fallbackGeometry={referenceGeometry}
                highlightedBbox={highlightedBboxPage === pageNumber ? highlightedBbox : null}
                registerSlot={registerSlot}
                onGeometry={handleGeometry}
                onRenderStateChange={handleRenderStateChange}
                onRenderError={handleRenderError}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
