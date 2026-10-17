"use client";

/* eslint-disable @next/next/no-img-element */

import { memo, useEffect, useId, useRef, useState } from "react";
import { CircleAlert, Download, ExternalLink, FileText, Maximize2, RefreshCw } from "lucide-react";

import { ImageLightbox } from "@/components/clinical-dashboard/image-lightbox";
import { Skeleton, cn, floatingControl } from "@/components/ui-primitives";
import { announce } from "@/components/ui/live-announcer";

const secondaryButton = floatingControl;

const placeholderSurface =
  "grid min-h-64 place-items-center bg-[radial-gradient(circle_at_50%_0%,color-mix(in_srgb,var(--clinical-accent-soft)_40%,transparent),transparent_22rem),var(--surface-inset)] p-5 text-center text-sm text-[color:var(--text-muted)] sm:min-h-72";

/**
 * Inline preview for non-PDF source documents.
 *
 * PDFs render in PdfCanvasViewer; everything else lands here:
 * - image/* → inline stage + shared ImageLightbox (same gestures as rail crops),
 * - text/* → a pointer to the already-extracted indexed text below,
 * - other (DOCX/XLSX/…) → an honest "download to view" affordance,
 * - no signed URL yet → the original placeholder.
 */
export const NonPdfSourcePreview = memo(function NonPdfSourcePreview({
  fileType,
  title,
  signedUrl,
  downloadSignedUrl,
  onRetry,
}: {
  fileType: string | undefined;
  title: string;
  signedUrl: string | null;
  downloadSignedUrl: string | null;
  onRetry?: () => void | Promise<void>;
}) {
  const type = fileType ?? "";

  if (!signedUrl) {
    return (
      <div className={placeholderSurface}>
        <div>
          <FileText aria-hidden="true" className="mx-auto mb-2 h-8 w-8" />
          Source preview is available after a signed URL is generated.
        </div>
      </div>
    );
  }

  if (type.startsWith("image/")) {
    // Keyed by signedUrl so a freshly issued URL remounts with a clean failed state.
    return (
      <InlineImagePreview
        key={signedUrl}
        signedUrl={signedUrl}
        downloadSignedUrl={downloadSignedUrl}
        title={title}
        onRetry={onRetry}
      />
    );
  }

  const isText = type.startsWith("text/");

  return (
    <div className={placeholderSurface}>
      <div className="max-w-md">
        <FileText aria-hidden="true" className="mx-auto mb-2 h-8 w-8" />
        <p className="font-semibold text-[color:var(--text)]">
          {isText ? "Text document" : "Inline preview isn't available for this file type"}
        </p>
        <p className="mt-1">
          {isText
            ? "The extracted text is shown in the indexed page text below."
            : "Open the file in a new tab or download it to view the original."}
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <a href={signedUrl} target="_blank" rel="noreferrer" className={cn(secondaryButton, "min-h-tap")}>
            <ExternalLink aria-hidden="true" className="h-4 w-4" />
            Open
          </a>
          {downloadSignedUrl ? (
            <a
              href={downloadSignedUrl}
              target="_blank"
              rel="noreferrer"
              download
              className={cn(secondaryButton, "min-h-tap")}
            >
              <Download aria-hidden="true" className="h-4 w-4" />
              Download
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
});

/**
 * Inline image with a failure fallback. The source is a direct signed URL owned
 * by the parent (not a re-fetchable endpoint). Primary viewing opens the shared
 * ImageLightbox in URL mode; Open/Download remain secondary recovery affordances.
 */
function InlineImagePreview({
  signedUrl,
  downloadSignedUrl,
  title,
  onRetry,
}: {
  signedUrl: string;
  downloadSignedUrl: string | null;
  title: string;
  onRetry?: () => void | Promise<void>;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const announcementSourceId = useId();
  const failureTransition = useRef(0);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!failed) return;
    failureTransition.current += 1;
    announce("Image preview could not load", {
      priority: "assertive",
      eventId: `non-pdf-image-preview:${announcementSourceId}:${failureTransition.current}`,
    });
  }, [announcementSourceId, failed]);

  if (failed) {
    return (
      <div data-preview-error="true" className={placeholderSurface}>
        <div className="max-w-md">
          <CircleAlert aria-hidden="true" className="mx-auto mb-2 h-8 w-8 text-[color:var(--warning)]" />
          <p className="font-semibold text-[color:var(--text)]">Image preview could not load</p>
          <p className="mt-1">The preview link may have expired. Open the image in a new tab or download it.</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                setLoaded(false);
                setFailed(false);
                setRetryCount((c) => c + 1);
                void onRetry?.();
              }}
              className={cn(secondaryButton, "min-h-tap")}
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              Retry image preview
            </button>
            <a href={signedUrl} target="_blank" rel="noreferrer" className={cn(secondaryButton, "min-h-tap")}>
              <ExternalLink aria-hidden="true" className="h-4 w-4" />
              Open
            </a>
            {downloadSignedUrl ? (
              <a
                href={downloadSignedUrl}
                target="_blank"
                rel="noreferrer"
                download
                className={cn(secondaryButton, "min-h-tap")}
              >
                <Download aria-hidden="true" className="h-4 w-4" />
                Download
              </a>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 bg-[color:var(--surface-inset)] p-2 sm:p-3">
      <div
        data-testid="non-pdf-image-stage"
        className="relative h-[clamp(16rem,60vh,36rem)] w-full overflow-hidden bg-[color:var(--surface-inset)] sm:h-[clamp(18rem,60vh,36rem)]"
      >
        {!loaded ? (
          <Skeleton
            aria-hidden="true"
            data-testid="non-pdf-image-skeleton"
            className="pointer-events-none absolute inset-0 h-full w-full rounded-none"
          />
        ) : null}
        {/* Eager, not lazy: for an image-source document this *is* the document,
            and it sits above the fold. Lazy-loading it puts the largest element
            on the page behind the browser's own lazy threshold and delays LCP
            (performance-image-cwv-audit-2026-08-02, LCP-1/LL-1). `fetchPriority`
            says the same thing to the preload scanner. */}
        <img
          key={`${signedUrl}:${retryCount}`}
          src={signedUrl}
          alt={title}
          decoding="async"
          fetchPriority="high"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false);
            setFailed(true);
          }}
          className={cn("h-full w-full object-contain", !loaded && "sr-only")}
        />
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setLightboxOpen(true)}
          aria-label={`Expand image: ${title}`}
          className="absolute inset-0 z-10 flex cursor-zoom-in items-start justify-end p-2 focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]"
        >
          <span
            aria-hidden="true"
            className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface)]/85 p-1 text-[color:var(--text-muted)] shadow-[var(--e1)] backdrop-blur-md"
          >
            <Maximize2 aria-hidden="true" className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={() => setLightboxOpen(true)} className={cn(secondaryButton, "min-h-tap")}>
          <Maximize2 aria-hidden="true" className="h-4 w-4" />
          View immersive
        </button>
        <a href={signedUrl} target="_blank" rel="noreferrer" className={cn(secondaryButton, "min-h-tap")}>
          <ExternalLink aria-hidden="true" className="h-4 w-4" />
          Open
        </a>
        {downloadSignedUrl ? (
          <a
            href={downloadSignedUrl}
            target="_blank"
            rel="noreferrer"
            download
            className={cn(secondaryButton, "min-h-tap")}
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            Download
          </a>
        ) : null}
      </div>
      <ImageLightbox
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        url={signedUrl}
        alt={title}
        returnFocusRef={triggerRef}
      />
    </div>
  );
}
