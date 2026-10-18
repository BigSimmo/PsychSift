"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { CircleAlert, Loader2, Minus, Plus, RefreshCw, RotateCw } from "lucide-react";

import { Sheet } from "@/components/ui/sheet";
import { controlDisabled, cn, IconButton, toolbarButton } from "@/components/ui-primitives";
import { useViewerGestures } from "@/components/document-viewer/use-viewer-gestures";
import { useSignedImageUrl } from "@/components/clinical-dashboard/use-signed-image-url";
import {
  clampScale,
  clampTranslate,
  legibleOpenScale,
  rotationFitScale,
  topLeftTranslate,
  zoomAboutPoint,
  type LightboxGeometry,
  type Point,
} from "@/components/clinical-dashboard/image-lightbox-geometry";

type ImageLightboxBaseProps = {
  open: boolean;
  onClose: () => void;
  alt: string;
  caption?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * Endpoint mode: fetch a private image through `/api/.../signed-url` (rail crops).
 * URL mode: parent already owns a document signed URL (whole-document images).
 * Exactly one source must be provided — URL mode must never touch the signed-URL LRU.
 */
export type ImageLightboxProps = ImageLightboxBaseProps &
  ({ endpoint: string; url?: never } | { url: string; endpoint?: never });

/**
 * Fullscreen, zoomable viewer for a single private image (diagram / table crop /
 * whole-document photo).
 *
 * Built on the shared Sheet (focus trap, Escape, scroll-lock, focus return) and
 * the shared useViewerGestures hook, so wheel/pinch zoom and drag-to-pan match
 * the PDF canvas. Zoom/pan/rotate are pure CSS transforms on the <img>.
 */
export function ImageLightbox(props: ImageLightboxProps) {
  const { open, onClose, alt, caption, returnFocusRef } = props;
  const endpoint = "endpoint" in props ? props.endpoint : undefined;
  const directUrl = "url" in props ? props.url : undefined;
  const endpointMode = typeof endpoint === "string" && endpoint.length > 0;

  const {
    url: fetchedUrl,
    failed: fetchFailed,
    retry: retryFetch,
    markFailed: markFetchFailed,
  } = useSignedImageUrl(endpoint ?? "", open && endpointMode);

  const [directFailed, setDirectFailed] = useState(false);
  const [retryDisabled, setRetryDisabled] = useState(false);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [geometry, setGeometry] = useState<LightboxGeometry | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const scaleRef = useRef(1);
  const rotationRef = useRef(0);
  const translateRef = useRef<Point>({ x: 0, y: 0 });
  const geometryRef = useRef<LightboxGeometry | null>(null);
  // Fresh direct URL after parent re-issue clears a prior load failure during render
  // (same identity-adjust pattern as useSignedImageUrl — no set-state-in-effect).
  const [seenDirectUrl, setSeenDirectUrl] = useState(directUrl ?? null);
  if (!endpointMode && (directUrl ?? null) !== seenDirectUrl) {
    setSeenDirectUrl(directUrl ?? null);
    setDirectFailed(false);
  }

  // URL mode: blank when the parent clears the signed URL (auth identity change).
  // Never seed from the module LRU — that would revive a prior identity's image.
  // Hide the <img> once a load failure is recorded so role=alert can surface.
  const url = endpointMode ? fetchedUrl : open && directUrl && !directFailed ? directUrl : null;
  const failed = endpointMode ? fetchFailed : directFailed;

  // Mirrors of the live view state. The gesture callbacks are stable across
  // renders (the wheel listener is registered once, non-passive), so they read
  // these refs instead of closing over one render's values. Synced in an effect,
  // not during render: a ref write during render is the pattern React's own
  // `react-hooks/refs` rule rejects, and every reader here runs after commit.
  useEffect(() => {
    scaleRef.current = scale;
    rotationRef.current = rotation;
    translateRef.current = translate;
    geometryRef.current = geometry;
  }, [scale, rotation, translate, geometry]);

  // Orientation changes and Safari's collapsing toolbars both resize the stage
  // mid-read; without this the pan bounds stay pinned to the old geometry and
  // the image can be left stranded outside its own clamp.
  useEffect(() => {
    if (!open || typeof ResizeObserver === "undefined") return () => undefined;
    const element = stageRef.current;
    if (!element) return () => undefined;
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      const image = imageRef.current;
      if (!image || rect.width <= 0 || rect.height <= 0) return;
      // offsetWidth/Height ignore CSS transforms, so they report the untransformed
      // object-contain box even while the reader is zoomed.
      if (!image.naturalWidth || !image.naturalHeight) return;
      const nextGeometry: LightboxGeometry = {
        stage: { width: rect.width, height: rect.height },
        natural: { width: image.naturalWidth, height: image.naturalHeight },
      };
      setGeometry(nextGeometry);
      // Re-clamp against the new stage so a landscape→portrait resize (or Safari
      // collapsing the chrome) cannot leave a prior pan past the new bounds with
      // a blank edge until the next drag happens to snap it back.
      setTranslate((current) => clampTranslate(nextGeometry, rotationRef.current, scaleRef.current, current));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);

  const handleRetry = useCallback(() => {
    if (retryDisabled) return;
    setRetryDisabled(true);
    if (endpointMode) {
      retryFetch();
    } else {
      setDirectFailed(false);
    }
    setTimeout(() => setRetryDisabled(false), 2000);
  }, [endpointMode, retryDisabled, retryFetch]);

  const markFailed = useCallback(() => {
    if (endpointMode) {
      markFetchFailed();
      return;
    }
    setDirectFailed(true);
  }, [endpointMode, markFetchFailed]);

  // Reset the view on close so the next open never inherits a prior image's zoom
  // or a stale stage measurement.
  const handleClose = useCallback(() => {
    setScale(1);
    setRotation(0);
    setTranslate({ x: 0, y: 0 });
    setGeometry(null);
    setDirectFailed(false);
    onClose();
  }, [onClose]);

  /** Apply a new scale, keeping `point` (stage coordinates) under the finger. */
  const zoomTo = useCallback((nextScale: number, point: Point | null) => {
    const next = zoomAboutPoint({
      geometry: geometryRef.current,
      rotation: rotationRef.current,
      scale: scaleRef.current,
      translate: translateRef.current,
      nextScale,
      point,
    });
    setScale(next.scale);
    setTranslate(next.translate);
  }, []);

  const zoomByFactor = useCallback(
    (factor: number) => {
      zoomTo(clampScale(scaleRef.current * factor), null);
    },
    [zoomTo],
  );

  const panByDelta = useCallback((dx: number, dy: number) => {
    // No `scale <= 1` early return: clampTranslate already collapses to {0,0}
    // when the content fits, so "nothing to pan" and "panned to the edge" stay
    // one code path instead of two that can disagree.
    setTranslate((current) =>
      clampTranslate(geometryRef.current, rotationRef.current, scaleRef.current, {
        x: current.x + dx,
        y: current.y + dy,
      }),
    );
  }, []);

  const handleDoubleTap = useCallback(
    (point: Point) => {
      const legible = legibleOpenScale(geometryRef.current, rotationRef.current);
      // Toggle against the legible scale, falling back to a plain 2x when the
      // crop is well matched to the stage and has no "legible" state to reach.
      const target = scaleRef.current > 1 ? 1 : Math.max(legible, 2);
      // Gesture points are viewport-relative (clientX/clientY). zoomAboutPoint
      // interprets the anchor relative to the stage's top-left, so subtract the
      // stage origin — otherwise a stage below the sheet header (or inside the
      // centered desktop dialog) anchors tens/hundreds of pixels away from the
      // touched content and the image jumps while zooming.
      const stageRect = stageRef.current?.getBoundingClientRect();
      const stagePoint = stageRect ? { x: point.x - stageRect.left, y: point.y - stageRect.top } : point;
      zoomTo(target, target > 1 ? stagePoint : null);
    },
    [zoomTo],
  );

  const { handlers } = useViewerGestures({
    targetRef: stageRef,
    wheelZoom: open,
    wheelNeedsModifier: false,
    pinchZoom: open,
    pan: open,
    touchPan: true,
    onZoomBy: zoomByFactor,
    onPanBy: panByDelta,
    onDoubleTap: handleDoubleTap,
  });

  /**
   * Measured once per image. Opening a wide table at the contained fit shows it
   * at the same unreadable size the inline card already did, so the viewer opens
   * at the source's own pixel density and anchored top-left — at the first
   * column and first row, not the middle of the table.
   */
  const handleImageLoad = useCallback(() => {
    const image = imageRef.current;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!image?.naturalWidth || !image.naturalHeight || !rect || rect.width <= 0 || rect.height <= 0) return;
    const measured: LightboxGeometry = {
      stage: { width: rect.width, height: rect.height },
      natural: { width: image.naturalWidth, height: image.naturalHeight },
    };
    setGeometry(measured);
    const opening = legibleOpenScale(measured, 0);
    setScale(opening);
    setTranslate(topLeftTranslate(measured, 0, opening));
  }, []);

  const rotateQuarterTurn = useCallback(() => {
    // Rotation changes which axis is constrained, so carrying the old scale
    // across is meaningless — re-fit and re-open at the legible scale for the
    // new orientation. This is what turns "rotate" into the gesture that makes a
    // wide table readable down the length of a phone.
    // Derived from the ref, not inside a setState updater: React may double-invoke
    // updaters, and an updater that also sets other state is exactly the pattern
    // that misbehaves there.
    const next = (rotationRef.current + 90) % 360;
    const opening = legibleOpenScale(geometryRef.current, next);
    setRotation(next);
    setScale(opening);
    setTranslate(topLeftTranslate(geometryRef.current, next, opening));
  }, []);

  const resetView = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const zoomed = scale > 1;
  const appliedScale = scale * rotationFitScale(geometry, rotation);

  return (
    <Sheet
      open={open}
      onClose={handleClose}
      title={caption?.trim() || alt}
      mobilePlacement="fullscreen"
      mobileSize="viewport"
      portal
      returnFocusRef={returnFocusRef}
      bodyClassName="p-0 sm:p-0 overflow-hidden"
      testId="image-lightbox"
      // The controls live in the Sheet's footer rather than floating over the
      // stage. The panel already carries `pb-safe`, so the footer clears the home
      // indicator with no `env()` arithmetic (and no double-counting it), the
      // controls stop occluding the bottom rows of a table, and the
      // pointer-events/stopPropagation juggling that only existed because the bar
      // sat on the gesture surface goes away.
      footer={
        <div className="flex items-center justify-center gap-1">
          <IconButton
            icon={Minus}
            label="Zoom out"
            onClick={() => zoomByFactor(1 / 1.25)}
            disabled={!url}
            className={toolbarButton}
          />
          <button
            type="button"
            onClick={resetView}
            disabled={!url}
            className={cn(
              controlDisabled,
              "inline-flex min-h-tap min-w-14 items-center justify-center rounded-md px-2 text-xs font-semibold tabular-nums text-[color:var(--text)] transition hover:bg-[color:var(--surface-subtle)]",
            )}
            aria-label="Reset zoom"
            // 100% means "the whole image, fitted" — in whatever orientation is
            // current. A 300% readout on open is otherwise unexplained.
            title="Reset to whole-image fit"
          >
            {Math.round(scale * 100)}%
          </button>
          <IconButton
            icon={Plus}
            label="Zoom in"
            onClick={() => zoomByFactor(1.25)}
            disabled={!url}
            className={toolbarButton}
          />
          <IconButton
            icon={RotateCw}
            label="Rotate image 90 degrees"
            onClick={rotateQuarterTurn}
            disabled={!url}
            className={toolbarButton}
          />
        </div>
      }
    >
      <div
        ref={stageRef}
        {...handlers}
        data-testid="image-lightbox-stage"
        data-source-mode={endpointMode ? "endpoint" : "url"}
        className={cn(
          "relative flex h-full min-h-[62vh] w-full select-none items-center justify-center overflow-hidden bg-[color:var(--surface-inset)] [touch-action:none] lg:min-h-[70vh]",
          zoomed && "cursor-grab active:cursor-grabbing",
        )}
      >
        {url ? (
          <img
            ref={imageRef}
            src={url}
            alt={alt}
            draggable={false}
            decoding="async"
            onLoad={handleImageLoad}
            onError={markFailed}
            className="max-h-full max-w-full object-contain"
            style={{
              // `appliedScale` folds in the rotation re-fit. `object-contain`
              // sizes the layout box before rotation, so without it a wide table
              // rotated upright overflowed the stage instead of fitting it.
              // Uniform scale commutes with rotation, so the order is safe.
              transform: `translate(${translate.x}px, ${translate.y}px) scale(${appliedScale}) rotate(${rotation}deg)`,
              transformOrigin: "center",
            }}
          />
        ) : failed ? (
          // role=alert so a load failure that happens after the lightbox has
          // already opened (e.g. an expired signed URL) is announced, not just
          // silently swapped in beneath the still-open dialog.
          <div
            role="alert"
            className="grid place-items-center gap-2 p-6 text-center text-sm font-semibold text-[color:var(--warning)]"
          >
            <CircleAlert aria-hidden="true" className="h-6 w-6" />
            Image could not load.
            <button
              type="button"
              onClick={handleRetry}
              disabled={retryDisabled}
              className={cn(
                controlDisabled,
                "inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-[color:var(--warning)]/30 bg-[color:var(--surface)] px-3 text-[color:var(--warning)] disabled:cursor-not-allowed transition",
              )}
            >
              <RefreshCw aria-hidden="true" className={cn("h-4 w-4", retryDisabled && "animate-spin")} />
              {retryDisabled ? "Retrying…" : "Retry"}
            </button>
          </div>
        ) : (
          <div
            role="status"
            className="grid place-items-center gap-2 text-xs font-semibold text-[color:var(--text-muted)]"
          >
            <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
            Loading image
          </div>
        )}
      </div>
    </Sheet>
  );
}
