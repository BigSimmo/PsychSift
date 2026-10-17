"use client";

import Image from "next/image";
import { memo, useEffect, useRef, useState } from "react";
import { CircleAlert, Maximize2 } from "lucide-react";

import { controlDisabled, cn, Skeleton } from "@/components/ui-primitives";
import { Button } from "@/components/ui/button";
import { getCachedSignedUrl } from "@/lib/signed-url-cache";
import { type SignedImageFailure, useSignedImageUrl } from "@/components/clinical-dashboard/use-signed-image-url";
import { ImageLightbox } from "@/components/clinical-dashboard/image-lightbox";

const AUTOMATIC_RETRY_DELAYS_MS = [250, 1_000] as const;

type SharedAutomaticRetry = {
  timeoutId: number;
  callbacks: Set<() => void>;
};

const sharedAutomaticRetries = new Map<string, SharedAutomaticRetry>();

function automaticRetryDelay(failure: SignedImageFailure | null, attempt: number) {
  const baseDelay = AUTOMATIC_RETRY_DELAYS_MS[attempt];
  if (!failure?.retryable || baseDelay === undefined) return null;
  // A 429 without a server cooldown is unsafe to guess at: another immediate
  // request can only deepen the rate limit. When supplied, Retry-After is the
  // earliest permissible retry, never an optional hint.
  if (failure.status === 429 && failure.retryAfterMs === null) return null;
  return Math.max(baseDelay, failure.retryAfterMs ?? 0);
}

/**
 * One timer per endpoint so sibling `SignedImage` mounts retry in the same
 * macrotask. Separate per-instance timeouts let the first retry settle and
 * drop the in-flight map before the second timeout fires, which then starts a
 * second fetch (and exhausts one-shot test mocks).
 */
function scheduleSharedAutomaticRetry(endpoint: string, delayMs: number, callback: () => void): () => void {
  const existing = sharedAutomaticRetries.get(endpoint);
  if (existing) {
    existing.callbacks.add(callback);
    return () => {
      existing.callbacks.delete(callback);
      if (existing.callbacks.size === 0) {
        window.clearTimeout(existing.timeoutId);
        sharedAutomaticRetries.delete(endpoint);
      }
    };
  }

  const callbacks = new Set<() => void>([callback]);
  const entry: SharedAutomaticRetry = { callbacks, timeoutId: 0 };
  entry.timeoutId = window.setTimeout(() => {
    sharedAutomaticRetries.delete(endpoint);
    for (const run of callbacks) run();
  }, delayMs);
  sharedAutomaticRetries.set(endpoint, entry);
  return () => {
    callbacks.delete(callback);
    if (callbacks.size === 0) {
      window.clearTimeout(entry.timeoutId);
      sharedAutomaticRetries.delete(endpoint);
    }
  };
}

/**
 * Shared renderer for a private image served through a signed-URL endpoint.
 *
 * Consolidates the loading/retry/aspect-frame behaviour that `DocumentImage`
 * (document viewer) and `SourceImage` (answer/evidence surfaces) previously
 * duplicated. Both now delegate here so the behaviour cannot drift again.
 *
 * The network request is deferred behind an `IntersectionObserver` so a long
 * evidence gallery does not fire every signed-URL request — and download every
 * full-resolution image — on mount. The image lives in a fixed 4:3 frame so it
 * never resizes the layout when it decodes (no content shift on load). When
 * `zoomable`, clicking opens a fullscreen lightbox with zoom/pan/rotate.
 */
export const SignedImage = memo(function SignedImage({
  endpoint,
  alt,
  className = "max-h-52",
  failureLabel = "Image preview could not load.",
  retryLabel = "Retry image",
  rootMargin = "640px 0px",
  zoomable = false,
  caption,
  aspectRatio,
  priority = false,
  expandLabel,
  failurePresentation = "message",
  onSettledFailure,
}: {
  /** Signed-URL API route, e.g. `/api/images/{id}/signed-url`. */
  endpoint: string;
  /** Accessible description of the image. */
  alt: string;
  /** Extra classes merged onto the fixed-aspect frame (e.g. `max-h-52`). */
  className?: string;
  /** Message shown when the signed URL or image fails to load. */
  failureLabel?: string;
  /** Label for the retry button in the failed state. */
  retryLabel?: string;
  /**
   * IntersectionObserver root margin that gates the network request.
   *
   * The default is a wide lookahead, which suits a surface whose images are the
   * point of the page. A long secondary list should pass something tighter: the
   * margin is what decides how many signed URLs are in flight at once, and with
   * no cross-surface scheduler it is also what decides which surface's requests
   * go first.
   */
  rootMargin?: string;
  /** When true, the loaded image is clickable and opens a fullscreen lightbox. */
  zoomable?: boolean;
  /** Lightbox title; falls back to `alt`. */
  caption?: string;
  /** Optional intrinsic width/height ratio for document crops that are not 4:3. */
  aspectRatio?: number | null;
  /**
   * When true, skip IntersectionObserver deferral and mark the image as
   * above-the-fold for next/image (`priority`) — for hero/evidence figures.
   */
  priority?: boolean;
  /**
   * Renders a labelled control beneath the frame that opens the same lightbox,
   * for crops the inline card cannot show legibly. Requires `zoomable`. Opt-in:
   * ordinary figures stay uncluttered, and every existing caller's DOM is
   * unchanged.
   */
  expandLabel?: string;
  /** Settled failures remain visible by default; optional decoration may hide them. */
  failurePresentation?: "message" | "hidden";
  /** Called once when a failure remains after the bounded automatic retry cycle. */
  onSettledFailure?: (failure: SignedImageFailure) => void;
}) {
  const [shouldLoad, setShouldLoad] = useState(() => priority || Boolean(getCachedSignedUrl(endpoint)));
  const [loaded, setLoaded] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [retryDisabled, setRetryDisabled] = useState(false);
  const [automaticRetryCount, setAutomaticRetryCount] = useState(0);
  const notifiedSettledFailureRef = useRef<SignedImageFailure | null>(null);
  const [seenEndpoint, setSeenEndpoint] = useState(endpoint);
  if (endpoint !== seenEndpoint) {
    setSeenEndpoint(endpoint);
    setAutomaticRetryCount(0);
    setLoaded(false);
    notifiedSettledFailureRef.current = null;
  }
  const { url, failed, failure, retry, markFailed } = useSignedImageUrl(endpoint, shouldLoad);
  const nextAutomaticRetryDelay = automaticRetryDelay(failure, automaticRetryCount);
  const automaticRetryPending = nextAutomaticRetryDelay !== null;
  const settledFailure = failed && !automaticRetryPending ? failure : null;

  // Defer the request until the frame is near the viewport. A cached URL seeds
  // `shouldLoad` synchronously, so already-fetched images skip the observer.
  useEffect(() => {
    if (shouldLoad) return () => undefined;

    const element = frameRef.current;
    if (!element || !("IntersectionObserver" in window)) {
      setShouldLoad(true);
      return () => undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin, shouldLoad]);

  // A signed-URL request or the image download can fail transiently while a
  // reader scrolls through a long evidence rail. Recover nearby images without
  // requiring a click, but cap the retries so a missing or unsupported asset
  // still settles on the existing explicit failure action.
  useEffect(() => {
    if (nextAutomaticRetryDelay === null) return () => undefined;

    return scheduleSharedAutomaticRetry(endpoint, nextAutomaticRetryDelay, () => {
      setLoaded(false);
      setShouldLoad(true);
      setAutomaticRetryCount((current) => current + 1);
      retry();
    });
  }, [endpoint, nextAutomaticRetryDelay, retry]);

  useEffect(() => {
    if (!settledFailure || notifiedSettledFailureRef.current === settledFailure) return;
    notifiedSettledFailureRef.current = settledFailure;
    onSettledFailure?.(settledFailure);
  }, [onSettledFailure, settledFailure]);

  function retryImage() {
    if (retryDisabled) return;
    setRetryDisabled(true);
    setAutomaticRetryCount(0);
    notifiedSettledFailureRef.current = null;
    setLoaded(false);
    setShouldLoad(true);
    retry();
    setTimeout(() => setRetryDisabled(false), 2000);
  }

  function handleImageError() {
    setLoaded(false);
    markFailed();
  }

  if (settledFailure) {
    if (failurePresentation === "hidden") return null;
    return (
      <div
        ref={frameRef}
        role="status"
        aria-live="polite"
        className={cn(
          className,
          "grid aspect-[4/3] w-full place-items-center rounded-lg border border-[color:var(--warning)]/30 bg-[color:var(--warning-soft)] p-4 text-center text-xs font-semibold text-[color:var(--warning)]",
        )}
      >
        <div>
          <CircleAlert aria-hidden="true" className="mx-auto mb-2 h-5 w-5" />
          {failureLabel}
          <button
            type="button"
            onClick={retryImage}
            disabled={retryDisabled}
            className={cn(
              controlDisabled,
              "mt-3 inline-flex min-h-tap items-center rounded-lg border border-[color:var(--warning)]/30 bg-[color:var(--surface)] px-3 text-[color:var(--warning)] disabled:cursor-not-allowed transition",
            )}
          >
            {retryDisabled ? "Retrying…" : retryLabel}
          </button>
        </div>
      </div>
    );
  }

  // A fixed-aspect frame reserves the image's box up front so the loaded image
  // never resizes the layout (the placeholder and the image share one box). The
  // image object-contains within it and fades in on decode, so nothing below
  // shifts when it arrives.
  const frame = (
    <div
      ref={frameRef}
      style={
        typeof aspectRatio === "number" && Number.isFinite(aspectRatio) && aspectRatio > 0
          ? { aspectRatio: String(Math.min(Math.max(aspectRatio, 0.35), 8)) }
          : undefined
      }
      className={cn(
        className,
        "group/signed-image relative w-full overflow-hidden rounded-lg bg-[color:var(--surface-inset)]",
        !(typeof aspectRatio === "number" && Number.isFinite(aspectRatio) && aspectRatio > 0) && "aspect-[4/3]",
      )}
    >
      {url ? (
        // Keep next/image for fill/layout/sizes, but mark private signed previews
        // `unoptimized` so bearer URLs never enter the unauthenticated
        // `/_next/image` optimizer cache (stale-while-revalidate can outlive the
        // signed token). Authorization stays on `/api/.../signed-url` issuance.
        // Do not append Storage transform query params here: createSignedUrl()
        // returns object/sign URLs, and client-side width/height/resize mutation
        // is a silent no-op (or can invalidate the token) without render/image.
        <Image
          src={url}
          alt={alt}
          fill
          sizes="(max-width: 768px) 92vw, 320px"
          unoptimized
          priority={priority}
          // Decode priority, not just fetch order. An above-the-fold evidence
          // figure competes for the main thread with the page it is part of;
          // a deferred rail crop does not need to, and saying so explicitly is
          // what keeps a long figure rail from contending with whatever the
          // reader is actually looking at. next/image already emits
          // `decoding="async"`, so this is the missing half of that pair.
          fetchPriority={priority ? "high" : "low"}
          onLoad={() => {
            setLoaded(true);
            setAutomaticRetryCount(0);
            notifiedSettledFailureRef.current = null;
          }}
          onError={handleImageError}
          className={cn(
            "rounded-lg object-contain transition-opacity duration-[var(--duration-deliberate)] motion-reduce:transition-none",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
      {zoomable && url && loaded ? (
        <>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setLightboxOpen(true)}
            aria-label={`Expand image: ${caption?.trim() || alt}`}
            className="absolute inset-0 z-10 flex cursor-zoom-in items-start justify-end p-2 focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]"
          >
            <span
              aria-hidden="true"
              // Reveal-on-hover leaves the affordance permanently invisible on a
              // phone, where there is no hover to reveal it — so the one cue that
              // a clipped clinical table opens full screen never appeared on the
              // devices that need it most. `hover:none` is the precise predicate:
              // it targets exactly the pointers that cannot trigger the reveal.
              // Hover-capable pointers keep the quiet, uncluttered original.
              className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface)]/85 p-1 text-[color:var(--text-muted)] opacity-0 shadow-[var(--e1)] backdrop-blur-md transition group-hover/signed-image:opacity-100 group-focus-within/signed-image:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100"
            >
              <Maximize2 aria-hidden="true" className="h-3.5 w-3.5" />
            </span>
          </button>
          <ImageLightbox
            open={lightboxOpen}
            onClose={() => setLightboxOpen(false)}
            endpoint={endpoint}
            alt={alt}
            caption={caption}
            returnFocusRef={triggerRef}
          />
        </>
      ) : null}
      {!url || !loaded ? (
        <div className="absolute inset-0 flex items-center justify-center text-center text-xs font-semibold text-[color:var(--text-muted)]">
          {shouldLoad ? (
            <Skeleton className="absolute inset-0 h-full w-full rounded-none" />
          ) : (
            <div className="grid place-items-center gap-1">Image preview will load when visible</div>
          )}
        </div>
      ) : null}
    </div>
  );

  if (!expandLabel || !zoomable) return frame;

  // A wide clinical table cannot be made legible inside a phone card — the
  // contained fit is already the largest faithful rendering — so the card's job
  // is to be an unclipped thumbnail with an unmissable route to the full-screen
  // viewer. This mirrors "Expand table" (AccessibleTable) and "View immersive"
  // (NonPdfSourcePreview) rather than inventing a fourth affordance.
  return (
    <div className="min-w-0">
      {frame}
      <Button
        variant="secondary"
        size="sm"
        block
        trailingIcon={Maximize2}
        testId="signed-image-expand"
        disabled={!url || !loaded}
        aria-haspopup="dialog"
        aria-expanded={lightboxOpen}
        onClick={() => setLightboxOpen(true)}
        className="mt-2"
      >
        {expandLabel}
      </Button>
    </div>
  );
});
