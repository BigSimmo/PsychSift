"use client";

import { controlDisabled, cn, ignoreUnavailableActivation, textMuted } from "@/components/ui-primitives";
import { missingValuePhrase } from "@/components/ui/missing-value";
import type { ImageRow } from "@/components/document-viewer/types";

/**
 * Compact page-linked figure strip for the document rail.
 * Clicks call `onSelectPage` (wired to navigateToPage) — never remount the PDF viewer.
 * Does not fetch signed images; detailed SignedImage cards below keep deferred IO.
 */
export function DocumentImageFilmstrip({
  images,
  activePage,
  onSelectPage,
}: {
  images: ImageRow[];
  activePage: number;
  onSelectPage: (page: number) => void;
}) {
  if (images.length === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label="Jump PDF to figure page"
      data-testid="document-image-filmstrip"
      className="flex min-w-0 gap-1.5 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]"
    >
      {images.map((image, index) => {
        const page = typeof image.page_number === "number" && image.page_number >= 1 ? image.page_number : null;
        const isActive = page !== null && page === activePage;
        const labelSeed =
          [image.tableLabel, image.tableTitle, image.caption].find((value) => Boolean(value?.trim()))?.trim() ??
          image.image_type?.replaceAll("_", " ") ??
          `Figure ${index + 1}`;
        const shortLabel = labelSeed.length > 28 ? `${labelSeed.slice(0, 27)}…` : labelSeed;

        const pageUnavailableId = page === null ? `filmstrip-page-unknown-${image.id}` : undefined;

        return (
          <div key={image.id} className="contents">
            <button
              type="button"
              aria-disabled={page === null ? "true" : undefined}
              onClick={page === null ? ignoreUnavailableActivation : () => onSelectPage(page)}
              aria-current={isActive ? "page" : undefined}
              aria-label={page === null ? `${labelSeed} — page unknown` : `Show PDF page ${page} for ${labelSeed}`}
              aria-describedby={pageUnavailableId}
              title={page === null ? "Page unknown — this figure has no recorded page number" : `Go to page ${page}`}
              className={cn(
                "inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
                controlDisabled,
                "aria-disabled:cursor-not-allowed hover:not-aria-disabled:bg-[color:var(--surface-subtle)] hover:not-aria-disabled:text-[color:var(--text)]",
                isActive
                  ? "border-[color:var(--clinical-accent)]/40 bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                  : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)]",
              )}
            >
              {/* The page slot itself, so the phrase stands where `p.4` would: the figure has no
                  recorded page number and the record does not say which page it came from.
                  SPEC §11 has no compact citation form, and "p. Unknown" is not one — the `p.`
                  prefix belongs to a page number, not to the absence of one. The button's
                  accessible name and its sr-only description already read "page unknown", so the
                  visible text now agrees with them instead of showing a dash. */}
              <span className={cn("nums shrink-0", isActive || page === null ? undefined : textMuted)}>
                {page === null ? missingValuePhrase("unknown") : `p.${page}`}
              </span>
              <span className="max-w-[9rem] truncate">{shortLabel}</span>
            </button>
            {pageUnavailableId ? (
              <span id={pageUnavailableId} className="sr-only">
                This figure has no recorded page number, so it cannot be jumped to.
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
