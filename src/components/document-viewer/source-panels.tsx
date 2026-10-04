// Presentational panels for the document viewer: clinical summary profile,
// high-yield summary, source images/tables, pinned evidence, and the indexed
// source-text search panel. Extracted from DocumentViewer.tsx (maturity X3) as a
// pure move — the DocumentViewer container composes these leaf components.
import {
  ArrowDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileImage,
  FileText,
  Loader2,
  Quote,
  type LucideIcon,
} from "lucide-react";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { AccessibleTable, hasRenderableAccessibleTable } from "@/components/AccessibleTable";
import { SignedImage } from "@/components/clinical-dashboard/signed-image";
import { useBatchSignedImageUrls } from "@/components/clinical-dashboard/use-batch-signed-urls";
import { SafeBoldText } from "@/components/SafeBoldText";
import {
  clinicalDivider,
  cn,
  eyebrowText,
  floatingControl,
  LoadingPanel,
  panel,
  PanelHeading,
  primaryControl,
  proseMeasure,
  sourceCard,
  textMuted,
} from "@/components/ui-primitives";
import {
  cleanClinicalSummaryText,
  sourceTextForCompactDisplay,
  sourceTextForDocumentViewer,
  sourceTextForIndexedPage,
} from "@/lib/source-text-sanitizer";
import { smartEvidenceTags } from "@/lib/evidence-tags";
import { flowIndexedText, parseIndexedSourceText } from "@/lib/indexed-source-formatting";
import { resolveScrollBehavior } from "@/lib/scroll-behavior";
import type { ClinicalDocumentSummaryProfile, DocumentSummaryProfileItem } from "@/lib/types";
import type { FormattedDocumentSummary as FormattedDocumentSummaryModel } from "@/lib/document-summary-formatting";
import type { ChunkRow, DocumentSearchResult, ImageRow, PageRow, TableFactRow } from "./types";

const primaryButton = primaryControl;
const secondaryButton = floatingControl;

const profileSectionLabels: Array<{
  key: keyof Omit<ClinicalDocumentSummaryProfile, "overview">;
  label: string;
}> = [
  { key: "applies_to", label: "Applies to / scope" },
  { key: "key_clinical_actions", label: "Key clinical actions" },
  { key: "medication_dose_monitoring", label: "Medication, dose and monitoring" },
  { key: "thresholds_timing", label: "Thresholds and timing" },
  { key: "escalation_risk_warnings", label: "Escalation and risk warnings" },
  { key: "required_forms_documentation", label: "Required forms / documentation" },
  { key: "not_covered", label: "Not covered / source gaps" },
  { key: "important_tables_images", label: "Important tables / images" },
  { key: "best_questions", label: "Best questions this document can answer" },
  { key: "source_quality_notes", label: "Source quality notes" },
];

function hasProfileItems(items: unknown): items is DocumentSummaryProfileItem[] {
  return Array.isArray(items) && items.some((item) => item && typeof item === "object" && "text" in item);
}

function profileItemText(item: DocumentSummaryProfileItem) {
  return cleanClinicalSummaryText(item.text);
}

export function ClinicalSummaryProfile({ profile }: { profile: ClinicalDocumentSummaryProfile }) {
  const sections = profileSectionLabels
    .map((section) => ({ ...section, items: profile[section.key] }))
    .filter((section) => hasProfileItems(section.items));

  return (
    <div data-testid="clinical-document-profile" className="mt-3 space-y-4">
      {/* The overview sentence leads the document landing card; the profile here
          shows only the structured detail so the same text is not printed twice. */}
      {sections.map((section) => (
        <section key={section.key} className="border-t border-[color:var(--border)] pt-3">
          <h3 className="text-xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
            {section.label}
          </h3>
          <ul className={cn(proseMeasure, "mt-2 space-y-1.5 text-base-minus leading-6 text-[color:var(--text-muted)]")}>
            {section.items.slice(0, section.key === "best_questions" ? 8 : 6).map((item, index) => {
              const text = profileItemText(item);
              if (!text) return null;
              return (
                <li key={`${section.key}:${index}:${text}`} className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-[0.65em] h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--clinical-accent)]"
                  />
                  <span>
                    <SafeBoldText text={text} />
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// Structured renderer for the raw stored summary text, sharing
// ClinicalSummaryProfile's visual language (lead paragraph, eyebrow section
// headings, accent-dot bullets). Collapsed by default with an explicit
// "Show full summary" toggle so nothing is silently hidden.
const collapsedSummarySectionCap = 4;
const collapsedSummaryItemCap = 5;

export function FormattedHighYieldSummary({
  formatted,
  showLead = true,
}: {
  formatted: FormattedDocumentSummaryModel;
  showLead?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (formatted.isEmpty) return null;
  // The lead sentence already leads the document landing "Overview" card, so the
  // right rail can suppress it to avoid printing the same sentence twice.
  const leadVisible = showLead && Boolean(formatted.lead);

  const visibleSections = expanded
    ? formatted.sections
    : formatted.sections
        .slice(0, collapsedSummarySectionCap)
        .map((section) => ({ ...section, items: section.items.slice(0, collapsedSummaryItemCap) }));
  const totalItems = formatted.sections.reduce((count, section) => count + section.items.length, 0);
  const visibleItems = visibleSections.reduce((count, section) => count + section.items.length, 0);
  const hasOverflow = totalItems > visibleItems || formatted.sections.length > visibleSections.length;

  return (
    <div data-testid="formatted-high-yield-summary" className="mt-3 space-y-4">
      {leadVisible ? (
        <p className={cn(proseMeasure, "text-base-minus leading-6 text-[color:var(--text-muted)]")}>
          <SafeBoldText text={formatted.lead ?? ""} />
        </p>
      ) : null}
      {visibleSections.map((section, index) => (
        <section
          key={section.id}
          className={cn((leadVisible || index > 0) && "border-t border-[color:var(--border)] pt-3")}
        >
          <h3 className="text-xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
            {section.heading ?? "Key points"}
          </h3>
          <ul className={cn(proseMeasure, "mt-2 space-y-1.5 text-base-minus leading-6 text-[color:var(--text-muted)]")}>
            {section.items.map((item, itemIndex) => (
              <li key={`${section.id}:${itemIndex}`} className="flex gap-2">
                <span
                  aria-hidden="true"
                  className="mt-[0.65em] h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--clinical-accent)]"
                />
                <span>
                  <SafeBoldText text={item} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {hasOverflow || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className={cn(floatingControl, "sm:min-h-compact-meta px-3 text-xs")}
          data-testid="toggle-full-summary"
        >
          {expanded ? "Show key points only" : "Show full summary"}
        </button>
      ) : null}
      {formatted.truncatedTail ? (
        <p className={cn("text-xs leading-5", textMuted)}>
          Summary trimmed at indexing — open the source PDF for full detail.
        </p>
      ) : null}
    </div>
  );
}

function looksLikeTableText(value?: string | null) {
  return Boolean(value?.includes("|") && value.split("|").filter((cell) => cell.trim()).length >= 3);
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function imageAspectRatio(image: ImageRow) {
  if (!image.width || !image.height || image.width <= 0 || image.height <= 0) return null;
  return image.width / image.height;
}

function tableQualityWarnings(image: ImageRow) {
  const warnings: string[] = [];
  if (image.rowsTruncated) {
    warnings.push(
      image.rowCount
        ? `Extracted table is partial (${image.rowCount} source rows; preview is capped).`
        : "Extracted table is partial.",
    );
  }
  if (typeof image.cropCompleteness === "number" && image.cropCompleteness < 0.82) {
    warnings.push(`Source crop may be incomplete (${formatPercent(image.cropCompleteness)} completeness).`);
  }
  if (typeof image.structuredExtractionConfidence === "number" && image.structuredExtractionConfidence < 0.58) {
    warnings.push(`Structured extraction confidence is low (${formatPercent(image.structuredExtractionConfidence)}).`);
  }
  if (typeof image.ocrTextDensity === "number" && image.ocrTextDensity < 0.18) {
    warnings.push("OCR/text density is low; verify wording against the source image.");
  }
  return warnings;
}

export function DocumentImage({
  image,
  activePage,
  onSelectPage,
}: {
  image: ImageRow;
  /** When set, highlights figures that belong to the active PDF page. */
  activePage?: number;
  /** Jump the PDF reader to this figure's page without remounting the viewer. */
  onSelectPage?: (page: number) => void;
}) {
  const endpoint = `/api/images/${image.id}/signed-url`;
  const pageNumber = typeof image.page_number === "number" && image.page_number >= 1 ? image.page_number : null;
  const isActivePage = pageNumber !== null && pageNumber === activePage;

  const tableHeading = sourceTextForCompactDisplay([image.tableLabel, image.tableTitle].filter(Boolean).join(": "));
  const cleanCaption = image.caption ? sourceTextForCompactDisplay(image.caption) : "";
  const tableMarkdown = image.accessibleTableMarkdown?.trim()
    ? image.accessibleTableMarkdown
    : looksLikeTableText(image.tableTextSnippet)
      ? image.tableTextSnippet
      : null;
  // Only let the table "lead" (collapsing the source image) when AccessibleTable
  // will actually render a table. Columns-only input or unparseable markdown
  // render nothing, so those route to the image-first branch instead of leaving
  // an empty caption above a hidden source image.
  const hasStructuredTable = hasRenderableAccessibleTable({
    markdown: tableMarkdown,
    rows: image.tableRows,
    columns: image.tableColumns,
  });
  const sourceImageOnly = !hasStructuredTable && image.source_kind === "table_crop";
  const tableCaption = tableHeading || cleanCaption || "Document table";
  const hasSourceTableTitle = Boolean(tableHeading || cleanCaption);
  const warnings = tableQualityWarnings(image);
  const sourceImageFirst =
    !hasStructuredTable ||
    image.rowsTruncated === true ||
    (typeof image.cropCompleteness === "number" && image.cropCompleteness < 0.82) ||
    (typeof image.structuredExtractionConfidence === "number" && image.structuredExtractionConfidence < 0.58);
  const showImageCaptionLine = cleanCaption && cleanCaption !== tableCaption;
  const displayLabels = smartEvidenceTags(
    image.labels,
    [tableHeading, cleanCaption, image.tableTextSnippet ? sourceTextForCompactDisplay(image.tableTextSnippet) : null]
      .filter(Boolean)
      .join(" "),
  );

  // When a structured, accessible table exists the extracted table leads and the
  // raw 4:3 table image collapses behind a "Show original" toggle, so the same
  // content is not shown twice at full height. Without a structured table the
  // image is the only representation, so it stays inline and prominent.
  // A crop this much wider than it is tall cannot be read inside a phone card at
  // any faithful size, so it gets a labelled route to the full-screen viewer
  // rather than only the corner chip. 2.1 includes the real clozapine demo crop
  // (1520×720 ≈ 2.11:1) and matches the ~2:1 legibility-floor intent; 2.2 left
  // that fixture (and similar clinical tables) without any labelled route.
  const ratio = imageAspectRatio(image);
  const isWideCrop = typeof ratio === "number" && ratio >= 2.1;

  const imageBlock = (
    <div className="rounded-lg bg-[color:var(--surface-inset)] p-3">
      <SignedImage
        endpoint={endpoint}
        alt={cleanCaption || tableHeading || "Document image"}
        caption={tableHeading || cleanCaption || undefined}
        failureLabel="Image preview failed."
        retryLabel="Retry"
        expandLabel={isWideCrop ? "Open full screen" : undefined}
        // Tighter than the shared default. The rail is secondary evidence beside
        // (desktop) or below (phone) the source the reader opened, and the wide
        // default lookahead minted signed URLs for rows most of a viewport away
        // — competing with the page's own above-the-fold work for no benefit,
        // since those rows are not on screen when the requests land. There is no
        // cross-surface request scheduler, so this differential IS the ordering:
        // surfaces that keep the wide margin resolve first.
        rootMargin={RAIL_IMAGE_ROOT_MARGIN}
        // No `min-h-*` here. `aspect-ratio` transfers size constraints across
        // axes, so a min-height of 10rem on a 3:1 table crop became a *minimum
        // width* of 480px and blew the phone card past the viewport. The frame
        // already has a definite height from the ratio (or the 4:3 fallback), so
        // the floor was only ever redundant.
        className="max-h-[70dvh] w-full"
        aspectRatio={ratio}
        zoomable
      />
      {isWideCrop ? (
        <p className={cn("mt-2 text-xs leading-5", textMuted)}>Wide table — open full screen to read it.</p>
      ) : null}
    </div>
  );

  const figcaptionBlock = (
    <figcaption className="mt-3 space-y-2 text-base-minus leading-6 text-[color:var(--text)]">
      {tableHeading ? <p className="font-semibold">{tableHeading}</p> : null}
      {showImageCaptionLine ? <p className={textMuted}>{cleanCaption}</p> : null}
      <AccessibleTable
        caption={tableCaption}
        markdown={tableMarkdown}
        rows={image.tableRows}
        columns={image.tableColumns}
        compact={false}
        expandOnMobile
        // Invented fallbacks ("Document table") are accessible-name only — do not paint a fake heading.
        hidePreviewCaption={!hasSourceTableTitle}
        dialogTitle={tableCaption}
        lowConfidenceFallback={imageBlock}
      />
      {!hasStructuredTable && image.tableTextSnippet ? (
        <p className={cn("text-sm leading-6", textMuted)}>{image.tableTextSnippet}</p>
      ) : null}
      {image.clinicalUseClass && image.clinicalUseClass !== "clinical_evidence" && image.clinicalUseReason ? (
        <p className={cn("text-xs leading-5", textMuted)}>{image.clinicalUseReason}</p>
      ) : null}
    </figcaption>
  );
  return (
    <figure
      data-testid="document-image"
      data-page={pageNumber ?? undefined}
      data-active-page={isActivePage ? "true" : undefined}
      className={cn(
        sourceCard,
        "overflow-hidden p-3",
        isActivePage && "border-[color:var(--clinical-accent)]/35 ring-1 ring-[color:var(--clinical-accent)]/25",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {onSelectPage && pageNumber !== null ? (
          <button
            type="button"
            onClick={() => onSelectPage(pageNumber)}
            aria-label={`Show PDF page ${pageNumber}`}
            aria-current={isActivePage ? "page" : undefined}
            className={cn(
              "inline-flex min-h-tap items-center rounded-md border px-2.5 text-xs font-semibold uppercase tracking-eyebrow transition",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
              isActivePage
                ? "border-[color:var(--clinical-accent)]/40 bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)]",
            )}
          >
            page {pageNumber}
          </button>
        ) : (
          <p className={cn("text-xs font-semibold uppercase tracking-eyebrow", textMuted)}>
            page {image.page_number ?? "n/a"}
          </p>
        )}
        <p className={cn("text-xs font-semibold uppercase tracking-eyebrow", textMuted)}>
          {[
            image.image_type ? image.image_type.replaceAll("_", " ") : null,
            image.tableRole || null,
            image.clinicalUseClass && image.clinicalUseClass !== "clinical_evidence"
              ? image.clinicalUseClass.replaceAll("_", " ")
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {sourceImageOnly ? (
          <span
            data-testid="source-image-only-status"
            className="inline-flex min-h-6 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-2 text-2xs font-semibold text-[color:var(--text-muted)]"
          >
            Source image only
            <span className="sr-only">; no reliable generated table is available.</span>
          </span>
        ) : null}
      </div>
      {warnings.length ? (
        <div className="mt-2 rounded-lg border border-[color:var(--warning)]/30 bg-[color:var(--warning-soft)] p-2 text-xs leading-5 text-[color:var(--warning)]">
          <p className="font-semibold">Verify table formatting against the source.</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {hasStructuredTable && !sourceImageFirst ? (
        <>
          {figcaptionBlock}
          <details className="group mt-3">
            <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 text-xs font-semibold text-[color:var(--text-muted)] transition hover:text-[color:var(--text)] sm:min-h-compact-meta">
              <FileImage aria-hidden="true" className="h-4 w-4 shrink-0" />
              Show original table image
              <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 transition group-open:rotate-180" />
            </summary>
            <div className="mt-2">{imageBlock}</div>
          </details>
        </>
      ) : (
        <>
          <div className="mt-2">{imageBlock}</div>
          {figcaptionBlock}
        </>
      )}
      {displayLabels.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {displayLabels.map((label) => (
            <span
              key={`${image.id}:${label}`}
              className="inline-flex min-h-6 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-2 text-2xs font-semibold text-[color:var(--text-muted)]"
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}
    </figure>
  );
}

/**
 * Rows revealed before the reader has scrolled anywhere near the end of them.
 * Six covers the great majority of indexed documents outright, so most rails
 * never mount a sentinel at all.
 */
export const RAIL_IMAGE_WINDOW = 6;

/**
 * Lookahead for the rail's own signed-URL requests, against `SignedImage`'s
 * wider default. See the call site in `DocumentImage` for why they differ.
 */
const RAIL_IMAGE_ROOT_MARGIN = "240px 0px";

/**
 * The figure rail, windowed.
 *
 * A `DocumentImage` is not a cheap row. Each one parses table markdown, decides
 * whether a structured `AccessibleTable` can render at all, computes quality
 * warnings and evidence tags, and mounts a `SignedImage` frame. A guideline with
 * ninety indexed tables paid all of that on hydration, for every row, before the
 * reader had opened the section — and the audit list underneath paid it again.
 *
 * Signed-URL fetches were already deferred behind `SignedImage`'s own
 * IntersectionObserver, so this is not primarily about network. What it removes
 * is the mount cost of rows nobody has looked at, and the `640px` observer
 * root-margin fanning requests out well past a tall desktop viewport once the
 * section does open.
 *
 * Deliberately no virtualization dependency: rows have data-dependent heights, a
 * windowed list needs no measurement to be correct, and `check:bundle-budget`
 * totals every built chunk — a library here would land straight on it.
 */
export function DocumentImageList({
  images,
  activePage,
  onSelectPage,
  revealLabel,
}: {
  images: ImageRow[];
  activePage?: number;
  onSelectPage?: (page: number) => void;
  /** Accessible label for the manual reveal control. */
  revealLabel: string;
}) {
  const [requestedCount, setRequestedCount] = useState(RAIL_IMAGE_WINDOW);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Derived rather than synchronised: the list shrinking underneath the reader (a
  // reindex, or navigating documents without remounting the rail) clamps here
  // during render, so there is no effect that can leave the window pointing past
  // the end of the array for a frame.
  // Document changes remount this list via `key` at the call site so an expanded
  // window cannot carry into the next guideline.
  const visibleCount = Math.min(Math.max(requestedCount, RAIL_IMAGE_WINDOW), images.length);
  const remaining = Math.max(images.length - visibleCount, 0);

  const visibleImageIds = useMemo(() => images.slice(0, visibleCount).map((image) => image.id), [images, visibleCount]);
  useBatchSignedImageUrls(visibleImageIds);

  useEffect(() => {
    if (remaining === 0) return () => undefined;
    const sentinel = sentinelRef.current;
    if (!sentinel || !("IntersectionObserver" in window)) return () => undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setRequestedCount((current) => Math.min(current + RAIL_IMAGE_WINDOW, images.length));
      },
      // Enough to land the next rows before they are reached, far less than the
      // signed-image observer's own 640px so the two do not both run far ahead.
      { rootMargin: "320px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [images.length, remaining]);

  return (
    <>
      {images.slice(0, visibleCount).map((image) => (
        <DocumentImage key={image.id} image={image} activePage={activePage} onSelectPage={onSelectPage} />
      ))}
      {remaining > 0 ? (
        // The control is not only a no-IntersectionObserver fallback: it is the
        // only way to reach the rest of the list without scrolling, which is what
        // a keyboard or screen-reader user needs.
        <div ref={sentinelRef} data-testid="document-image-reveal" className="pt-1">
          <button
            type="button"
            onClick={() => setRequestedCount(images.length)}
            className={cn(secondaryButton, "w-full justify-center")}
            aria-label={`${revealLabel} — show the remaining ${remaining}`}
          >
            <FileImage aria-hidden="true" className="h-4 w-4" />
            Show {remaining} more
          </button>
        </div>
      ) : null}
    </>
  );
}

export function TableReviewPanel({
  tableFacts,
  canReview,
  busyFactId,
  onReview,
}: {
  tableFacts: TableFactRow[];
  canReview: boolean;
  busyFactId: string | null;
  onReview: (fact: TableFactRow, reviewClass: string) => void;
}) {
  if (!tableFacts.length) return null;
  return (
    <details className={cn(sourceCard, "p-3")}>
      <summary className="cursor-pointer text-sm font-semibold text-[color:var(--text)]">
        Table review queue ({tableFacts.length})
      </summary>
      <div className="mt-3 grid gap-2">
        {tableFacts.slice(0, 12).map((fact) => {
          const metadata = fact.metadata ?? {};
          const reviewClass = typeof metadata.review_class === "string" ? metadata.review_class : "unreviewed";
          const text = [fact.table_title, fact.row_label, fact.clinical_parameter, fact.threshold_value, fact.action]
            .filter(Boolean)
            .join(" | ");
          return (
            <div
              key={fact.id}
              className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-2"
            >
              <p className="text-xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
                Page {fact.page_number ?? "n/a"} · {reviewClass.replaceAll("_", " ")}
              </p>
              <p className="mt-1 text-sm leading-5 text-[color:var(--text)]">{text || "Table fact has no text."}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[
                  ["clinical_useful", "Clinical"],
                  ["administrative", "Admin"],
                  ["reference", "Reference"],
                  ["unrelated", "Unrelated"],
                  ["bad_extraction", "Bad extraction"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    disabled={!canReview || busyFactId === fact.id}
                    onClick={() => onReview(fact, value)}
                    className={cn(
                      "inline-flex min-h-tap items-center rounded-md border px-2 text-2xs font-semibold transition sm:min-h-compact-meta",
                      reviewClass === value
                        ? "border-[color:var(--clinical-accent)]/35 bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                        : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)]",
                    )}
                  >
                    {busyFactId === fact.id && value === reviewClass ? (
                      <Loader2 aria-hidden="true" className="mr-1 h-3 w-3 animate-spin" />
                    ) : null}
                    {label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

export function DocumentSectionSummary({
  icon: Icon,
  title,
  description,
  onClick,
  interactive = true,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick?: MouseEventHandler<HTMLElement>;
  /** When false, render a static heading (full view) instead of a disclosure control. */
  interactive?: boolean;
}) {
  const label = (
    <span className="inline-flex min-w-0 items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[color:var(--clinical-accent)]/20 bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]">
        <Icon aria-hidden="true" className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span role="heading" aria-level={2} className="block text-base font-semibold text-[color:var(--text-heading)]">
          {title}
        </span>
        <span className={cn("mt-1 block text-sm leading-6", textMuted)}>{description}</span>
      </span>
    </span>
  );

  // Full view keeps a <details> shell for print/section anchors, but the header
  // must not advertise collapse when activation is intentionally inert.
  if (!interactive) {
    return (
      <summary
        key="document-section-summary-static"
        aria-disabled="true"
        tabIndex={-1}
        onClick={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") event.preventDefault();
        }}
        className="flex min-h-[72px] list-none items-center gap-3 px-4 py-3"
      >
        {label}
      </summary>
    );
  }

  return (
    <summary
      key="document-section-summary-interactive"
      onClick={onClick}
      className="flex min-h-[72px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3"
    >
      {label}
      <ChevronDown
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-[color:var(--text-muted)] transition group-open:rotate-180"
      />
    </summary>
  );
}

export function PinnedSourceEvidence({
  loading,
  chunk,
  compact = true,
  sectionId = "source-evidence",
  onInspectIndexedText,
}: {
  loading: boolean;
  chunk: ChunkRow | undefined;
  compact?: boolean;
  sectionId?: "source-evidence" | "source-evidence-rail";
  /** Opens the collapsed indexed-text panel without auto-dumping the viewport there. */
  onInspectIndexedText?: () => void;
}) {
  // Citation landing stays a short chip by default. Full extraction dump lives
  // behind "Inspect indexed text" so PDF remains the primary reading surface.
  const displayContent = chunk ? flowIndexedText(sourceTextForDocumentViewer(chunk.content)) : "";
  const previewLimit = compact ? 160 : 300;
  const [expandedChunkId, setExpandedChunkId] = useState<string | null>(null);
  const isLong = displayContent.length > previewLimit;
  const expanded = !compact || (chunk?.id ? expandedChunkId === chunk.id : false);
  const showingPreview = compact && isLong && !expanded;
  const visibleContent = showingPreview ? `${displayContent.slice(0, previewLimit).trimEnd()}…` : displayContent;
  // Readers navigate by page and section; the internal chunk number is not shown.
  const chunkMeta = chunk?.page_number ? `Page ${chunk.page_number}` : "";

  // Nothing is pinned (a direct visit, not arrived at from a citation or a
  // search result), so the card renders nothing rather than a hint line.
  if (!loading && !chunk) return null;

  return (
    <section
      id={sectionId}
      data-testid="pinned-source-evidence"
      className={cn(panel, "scroll-mt-[var(--document-anchor-offset,6rem)]", compact ? "p-3" : "p-4")}
    >
      <div className="flex items-center justify-between gap-3">
        <PanelHeading icon={Quote} title="Matching passage" />
        {chunkMeta ? (
          <p className="nums shrink-0 text-xs font-semibold text-[color:var(--text-muted)]">{chunkMeta}</p>
        ) : null}
      </div>
      {loading ? (
        <LoadingPanel label="Loading matching passage" />
      ) : chunk ? (
        <div
          data-testid="highlighted-source-passage"
          className={cn("mt-2.5", compact ? "text-sm leading-6" : "text-base-minus leading-7")}
        >
          {chunk.section_heading && (
            <p className="text-sm font-semibold text-[color:var(--text)]">{chunk.section_heading}</p>
          )}
          <blockquote
            id={chunk.id ? `cited-passage-${chunk.id}` : undefined}
            className={cn(
              "mt-2 rounded-lg bg-[color:var(--surface-inset)] px-3 py-2 text-[color:var(--text)]",
              showingPreview ? "whitespace-normal" : "whitespace-pre-line",
            )}
          >
            {/* The clamp sits on an inner span: on the padded quote itself, a third
                line showed half-cut through the bottom padding. */}
            <span className={showingPreview ? "line-clamp-2" : undefined}>
              {visibleContent || "No displayable clinical text was available for this indexed passage."}
            </span>
          </blockquote>
          {compact && isLong ? (
            <button
              type="button"
              onClick={() => setExpandedChunkId((current) => (current === chunk.id ? null : chunk.id))}
              className="mt-0.5 inline-flex min-h-tap items-center border-0 bg-transparent px-0 text-xs font-semibold text-[color:var(--clinical-accent)] transition hover:text-[color:var(--clinical-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
              data-testid="toggle-full-passage"
              aria-expanded={expanded}
              aria-controls={chunk.id ? `cited-passage-${chunk.id}` : undefined}
            >
              {expanded ? "Show less" : "Full passage"}
            </button>
          ) : null}
          <div className={cn("grid grid-cols-2 gap-2", compact && isLong ? "mt-1" : "mt-3")}>
            <a
              href="#pdf-preview-section"
              className={cn(primaryButton, "min-w-0 justify-center px-2 text-center text-xs")}
            >
              <ArrowDown aria-hidden="true" className="h-4 w-4" />
              <span>Show on page</span>
            </a>
            {onInspectIndexedText ? (
              <button
                type="button"
                onClick={onInspectIndexedText}
                className={cn(secondaryButton, "min-w-0 justify-center px-2 text-center text-xs")}
                data-testid="inspect-indexed-text"
              >
                Page text
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className={cn("mt-3 text-base-minus leading-6", textMuted)}>
          Open a citation from an answer to see the exact indexed passage.
        </p>
      )}
    </section>
  );
}

function IndexedSourceText({
  text,
  emptyText,
  compact = false,
}: {
  text: string;
  emptyText: string;
  compact?: boolean;
}) {
  const blocks = parseIndexedSourceText(text);
  if (blocks.length === 0) {
    return <p className={cn("mt-4 text-base-minus leading-6", textMuted)}>{emptyText}</p>;
  }

  return (
    <div className={cn("mt-4 grid", proseMeasure, compact ? "gap-2.5" : "gap-3")}>
      {blocks.map((block) => {
        if (block.type === "heading") {
          return block.level === "title" ? (
            <h3 key={block.id} className="text-base font-semibold leading-6 text-[color:var(--text-heading)]">
              {block.text}
            </h3>
          ) : (
            <h4 key={block.id} className="mt-2 text-sm font-bold text-[color:var(--text-heading)]">
              {block.text}
            </h4>
          );
        }

        if (block.type === "list") {
          return (
            <ul
              key={block.id}
              className={cn(
                "list-disc space-y-1.5 pl-5 text-base-minus leading-7 text-[color:var(--text)] marker:text-[color:var(--decoration-soft)]",
                compact && "text-sm leading-6",
              )}
            >
              {block.items.map((item, index) => (
                <li key={`${block.id}:${index}:${item}`} className="pl-1">
                  {item}
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === "table") {
          const tableCaption = block.caption?.trim() || "Document table";
          return (
            <AccessibleTable
              key={block.id}
              caption={tableCaption}
              rows={block.rows}
              compact={false}
              expandOnMobile
              // Invented fallbacks are accessible-name only — do not paint a fake heading.
              hidePreviewCaption={!block.caption?.trim()}
              dialogTitle={tableCaption}
            />
          );
        }

        return (
          <p
            key={block.id}
            className={cn("text-base-minus leading-7 text-[color:var(--text)]", compact && "text-sm leading-6")}
          >
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

function highlightTermsFor(terms: string[], fallback: string) {
  const fallbackTerms = fallback
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length >= 3);
  return Array.from(new Set((terms.length ? terms : fallbackTerms).map((term) => term.toLowerCase()).filter(Boolean)));
}

function sourcePassageTeaser(value: string) {
  return flowIndexedText(value).replace(/\s+/g, " ").trim();
}

function openNestedSourceDisclosure(container: HTMLDetailsElement | null, disclosure: HTMLDetailsElement) {
  container?.querySelectorAll<HTMLDetailsElement>("[data-source-nested-disclosure]").forEach((peer) => {
    if (peer !== disclosure) peer.open = false;
  });
  disclosure.open = true;
}

function HighlightedSearchText({ text, terms }: { text: string; terms: string[] }) {
  if (!text.trim() || terms.length === 0) return <>{text}</>;
  const escaped = terms
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  if (!escaped.length) return <>{text}</>;
  const matcher = new RegExp(`(^|[^a-z0-9])(${escaped.join("|")})`, "gi");
  const parts: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(text))) {
    const prefixLength = match[1]?.length ?? 0;
    const term = match[2] ?? "";
    const termStart = match.index + prefixLength;
    if (termStart > cursor) parts.push(text.slice(cursor, termStart));
    parts.push(
      <mark
        key={`${termStart}:${term}`}
        className="rounded-sm bg-[color:var(--clinical-accent-soft)] px-0.5 font-semibold text-[color:var(--clinical-accent)]"
      >
        {term}
      </mark>,
    );
    cursor = termStart + term.length;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

// Memoised: both the mobile <details> and desktop copies stay mounted and are
// CSS-toggled, so without this every unrelated parent re-render (e.g. composer
// typing) re-rendered both instances. All props are referentially stable across
// those renders, so memo actually elides them.
export const IndexedTextPanel = memo(function IndexedTextPanel({
  loading,
  selectedPage,
  chunks,
  search,
  documentSearchResults,
  searchingDocument,
  documentSearchError,
  idPrefix,
  sectionId,
  selectedChunkId,
  compact = false,
  revealRequest = false,
}: {
  loading: boolean;
  selectedPage: PageRow | undefined;
  chunks: ChunkRow[];
  search: string;
  documentSearchResults: DocumentSearchResult[];
  searchingDocument: boolean;
  documentSearchError: string | null;
  idPrefix: string;
  sectionId?: "source-text";
  selectedChunkId?: string;
  /** Retained for call-site compatibility; search input is owned by the document composer. */
  onSearchChange?: (value: string) => void;
  compact?: boolean;
  /**
   * Explicit user intent to open the panel (e.g. "Inspect indexed text").
   * Citation deep-links alone must not force-open this dump over the PDF.
   */
  revealRequest?: boolean;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const searchEligible = normalizedSearch.length >= 2;
  const displayChunks = useMemo(
    () =>
      chunks.map((chunk) => ({
        ...chunk,
        displayContent: sourceTextForDocumentViewer(chunk.content),
      })),
    [chunks],
  );
  const loadedChunkById = useMemo(() => new Map(displayChunks.map((chunk) => [chunk.id, chunk])), [displayChunks]);
  const visibleChunks = useMemo(
    () =>
      searchEligible
        ? documentSearchResults.map((result) => {
            const loadedChunk = loadedChunkById.get(result.id);
            return {
              id: result.id,
              page_number: result.page_number,
              chunk_index: result.chunk_index,
              section_heading: result.section_heading,
              displayContent: loadedChunk?.displayContent ?? result.snippet,
              matchedTerms: result.matched_terms,
              serverRanked: true,
            };
          })
        : normalizedSearch
          ? []
          : displayChunks.slice(0, 8).map((chunk) => ({ ...chunk, matchedTerms: [], serverRanked: false })),
    [displayChunks, documentSearchResults, loadedChunkById, normalizedSearch, searchEligible],
  );
  const [activeHitIndex, setActiveHitIndex] = useState(0);
  const clampedActiveHitIndex = visibleChunks.length ? Math.min(activeHitIndex, visibleChunks.length - 1) : 0;
  const activeHit = searchEligible && visibleChunks.length ? visibleChunks[clampedActiveHitIndex] : null;
  const pageHitCounts = visibleChunks.reduce<Map<number, number>>((counts, chunk) => {
    if (!chunk.page_number) return counts;
    counts.set(chunk.page_number, (counts.get(chunk.page_number) ?? 0) + 1);
    return counts;
  }, new Map());
  const pageHitSummary = Array.from(pageHitCounts.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(0, 5)
    .map(([page, count]) => `p${page}: ${count}`)
    .join(" · ");
  const selectedPageText = selectedPage ? sourceTextForIndexedPage(selectedPage.text) : "";
  const topLevelDisclosureRef = useRef<HTMLDetailsElement>(null);
  const hitMoveLockRef = useRef(false);
  const activeHitId = activeHit?.id;
  const autoOpenTargetId = activeHitId ?? selectedChunkId;
  const autoOpenDriver = activeHitId ? `search:${activeHitId}` : selectedChunkId ? `citation:${selectedChunkId}` : null;
  const targetAvailability = `${searchingDocument ? "loading" : "ready"}:${visibleChunks
    .map((chunk) => chunk.id)
    .join(",")}`;
  const previousAutoOpenDriverRef = useRef<string | null>(null);
  // Track manual close in state (not only a ref) so selected/active chunk
  // disclosures can stay React-controlled — imperative `.open = true` alone was
  // lost across re-renders and left deep-linked hits collapsed in Production UI.
  const [manualClosedDriver, setManualClosedDriver] = useState<string | null>(null);
  const [compactOpen, setCompactOpen] = useState(false);
  const previousSearchRef = useRef("");
  // In-document search and an explicit "Inspect indexed text" action keep the
  // panel revealed through exclusive-accordion closes. Citation deep-links alone
  // must not force-open — that stole the first viewport from the PDF.
  const forceReveal = Boolean(normalizedSearch) || revealRequest;
  const panelShouldOpen = !compact || compactOpen || forceReveal;
  const previousForceRevealRef = useRef(forceReveal);
  useEffect(() => {
    if (forceReveal === previousForceRevealRef.current) return;
    previousForceRevealRef.current = forceReveal;
    // Rising edge: latch open so exclusive-accordion closes cannot collapse an
    // active inspect/search reveal. Falling edge: drop the latch so jumping to
    // PDF/overview (or clearing revealRequest on the same citation) restores
    // PDF-first instead of leaving the dump controlled-open.
    setCompactOpen(forceReveal);
  }, [forceReveal]);
  useEffect(() => {
    if (previousSearchRef.current === normalizedSearch) return;
    previousSearchRef.current = normalizedSearch;
    setActiveHitIndex(0);
  }, [normalizedSearch]);
  if (previousAutoOpenDriverRef.current !== autoOpenDriver) {
    previousAutoOpenDriverRef.current = autoOpenDriver;
    if (manualClosedDriver !== null) setManualClosedDriver(null);
    if (!forceReveal) setCompactOpen(false);
  }
  const autoOpenSuppressed = Boolean(autoOpenDriver) && manualClosedDriver === autoOpenDriver;

  // Gecko's exclusive `<details name>` can clear `.open` on a sibling without
  // React seeing a prop change. When our controlled `open` still says true, the
  // DOM stays closed until something else re-renders — which is how Firefox
  // intermittently loses "Inspect indexed text" and search-hit navigation.
  useLayoutEffect(() => {
    const top = topLevelDisclosureRef.current;
    if (!top || top.open === panelShouldOpen) return;
    top.open = panelShouldOpen;
  }, [panelShouldOpen]);

  useEffect(() => {
    if (!autoOpenDriver || !autoOpenTargetId || autoOpenSuppressed) return;
    const targetDisclosure = document.getElementById(`${idPrefix}-${autoOpenTargetId}`);
    if (!(targetDisclosure instanceof HTMLDetailsElement)) return;
    const top = topLevelDisclosureRef.current;
    // Citation-only: leave the nested disclosure marked for when the user opens
    // the panel, but do not open/scroll the dump over the PDF.
    if (!forceReveal && !(top?.open || compactOpen)) return;
    // Do not imperatively toggle the top-level exclusive-accordion member here —
    // React's controlled `open` + the layout sync above own that. Re-setting
    // `.open` on the named details was retriggering Gecko toggle fights.
    const wasOpen = targetDisclosure.open;
    openNestedSourceDisclosure(top, targetDisclosure);
    if (!wasOpen) {
      // Defer past the activating pointer gesture so scrollIntoView cannot
      // synthesise a second activation on the hit controls in Firefox.
      requestAnimationFrame(() => {
        targetDisclosure.scrollIntoView({ block: "nearest", behavior: resolveScrollBehavior() });
      });
    }
  }, [autoOpenDriver, autoOpenTargetId, autoOpenSuppressed, compactOpen, forceReveal, idPrefix, targetAvailability]);

  function moveHit(delta: number) {
    if (visibleChunks.length === 0 || hitMoveLockRef.current) return;
    // One user gesture can deliver two click activations in Firefox (pointer +
    // exclusive-accordion side effects). With exactly two hits, wrapping twice
    // returns to Hit 1 and looks like a no-op — coalesce same-turn duplicates.
    hitMoveLockRef.current = true;
    queueMicrotask(() => {
      hitMoveLockRef.current = false;
    });
    setActiveHitIndex((current) => (current + delta + visibleChunks.length) % visibleChunks.length);
  }

  function handleNestedSummaryClick(event: ReactMouseEvent<HTMLElement>) {
    const disclosure = event.currentTarget.parentElement;
    if (!(disclosure instanceof HTMLDetailsElement)) return;
    event.preventDefault();
    const isDriverDisclosure = disclosure.id === `${idPrefix}-${autoOpenTargetId}`;
    if (disclosure.open) {
      disclosure.open = false;
      if (isDriverDisclosure && autoOpenDriver) setManualClosedDriver(autoOpenDriver);
      return;
    }
    if (isDriverDisclosure && autoOpenDriver) setManualClosedDriver(null);
    if (!isDriverDisclosure && autoOpenDriver && autoOpenTargetId) {
      const driverDisclosure = document.getElementById(`${idPrefix}-${autoOpenTargetId}`);
      if (driverDisclosure instanceof HTMLDetailsElement && driverDisclosure.open) {
        setManualClosedDriver(autoOpenDriver);
      }
    }
    openNestedSourceDisclosure(topLevelDisclosureRef.current, disclosure);
  }

  return (
    <details
      ref={topLevelDisclosureRef}
      id={sectionId}
      name={compact ? "document-viewer-section" : undefined}
      open={panelShouldOpen}
      onToggle={(event) => {
        if (!compact) return;
        // Exclusive-accordion closes must not win over a deep-link/search reveal.
        // Re-open after the browser finishes the toggle (microtask), and bump a
        // render so the controlled `open` prop stays authoritative. The layout
        // sync above recovers the case where Gecko clears `.open` without a
        // React prop change; this path still latches compactOpen for search.
        if (!event.currentTarget.open && forceReveal) {
          const disclosure = event.currentTarget;
          queueMicrotask(() => {
            disclosure.open = true;
          });
          setCompactOpen(true);
          return;
        }
        setCompactOpen(event.currentTarget.open);
      }}
      data-testid={`${idPrefix}-indexed-text-panel`}
      className={cn(panel, "group scroll-mt-[var(--document-anchor-offset,6rem)] source-print")}
    >
      <DocumentSectionSummary
        icon={FileText}
        title="Page text"
        // Search / explicit inspect force the panel open; citation deep-links do
        // not — keep the summary interactive so readers can still open it.
        interactive={compact && !forceReveal}
        description={
          loading
            ? "Loading the text of each page."
            : selectedPage?.page_number
              ? `The searchable text of page ${selectedPage.page_number}.`
              : "The searchable text of each page."
        }
      />
      <div className={cn(clinicalDivider, "px-4 pb-4 pt-3 sm:p-5 sm:pt-4")}>
        {loading ? (
          <LoadingPanel label="Loading page text" />
        ) : (
          <div className="grid gap-2.5">
            <details
              data-source-nested-disclosure
              data-testid="indexed-page-text-disclosure"
              className={cn(sourceCard, "group/source-row overflow-hidden p-0 source-print")}
            >
              <summary
                onClick={handleNestedSummaryClick}
                className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:min-h-compact-meta"
              >
                <span>
                  <span className="block text-sm font-semibold text-[color:var(--text)]">Full extracted page text</span>
                  <span className={cn("mt-1 block text-2xs font-semibold", textMuted)}>
                    Page {selectedPage?.page_number ?? "n/a"}
                  </span>
                </span>
                <ChevronDown
                  aria-hidden="true"
                  data-testid="indexed-page-text-chevron"
                  className="h-4 w-4 shrink-0 transition group-open/source-row:rotate-180"
                />
              </summary>
              <div className="border-t border-[color:var(--border)] px-3 pb-3 pt-1">
                {selectedPage ? (
                  <IndexedSourceText
                    text={selectedPageText}
                    emptyText="No displayable extracted text has been indexed for this page yet."
                  />
                ) : (
                  <p className={cn("mt-3 text-base-minus", textMuted)}>
                    No extracted text has been indexed for this page yet.
                  </p>
                )}
              </div>
            </details>
          </div>
        )}
        <div className={cn("mt-3 pt-3", clinicalDivider)}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-[color:var(--text)]">Source passages</p>
            {searchEligible ? (
              <span className={cn("text-xs font-semibold", textMuted)}>
                {searchingDocument
                  ? "Searching all indexed passages"
                  : `${visibleChunks.length} full-document hit${visibleChunks.length === 1 ? "" : "s"}`}
              </span>
            ) : null}
          </div>
          {searchEligible && visibleChunks.length > 0 && !searchingDocument ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2">
              <div className="min-w-0">
                <p className="nums text-xs font-bold text-[color:var(--text)]">
                  Hit {clampedActiveHitIndex + 1} of {visibleChunks.length}
                </p>
                <p className={cn("mt-0.5 truncate text-2xs font-semibold", textMuted)}>
                  {pageHitSummary || "No page numbers indexed for these hits"}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => moveHit(-1)}
                  className={cn(secondaryButton, "size-tap justify-center p-0")}
                  aria-label="Previous document search hit"
                  title="Previous document search hit"
                >
                  <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moveHit(1)}
                  className={cn(secondaryButton, "size-tap justify-center p-0")}
                  aria-label="Next document search hit"
                  title="Next document search hit"
                >
                  <ChevronRight aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
          {documentSearchError && searchEligible ? (
            <p className="mt-2 rounded-lg border border-[color:var(--warning)]/30 bg-[color:var(--warning-soft)] px-3 py-2 text-xs font-semibold text-[color:var(--warning)]">
              {documentSearchError}
            </p>
          ) : null}
          <div className="mt-2.5 grid gap-2.5">
            {normalizedSearch.length === 1 ? (
              <p className={cn("text-base-minus leading-6", textMuted)}>
                Enter at least 2 characters to search all indexed passages.
              </p>
            ) : searchingDocument ? (
              <LoadingPanel label="Searching all indexed passages" />
            ) : documentSearchError ? null : visibleChunks.length === 0 ? (
              <p className={cn("text-base-minus leading-6", textMuted)}>No indexed passage matched that search.</p>
            ) : (
              visibleChunks.map((chunk) => {
                const selected = selectedChunkId === chunk.id;
                const active = activeHit?.id === chunk.id;
                const isAutoOpenTarget = Boolean(autoOpenTargetId) && chunk.id === autoOpenTargetId;
                // Keep deep-linked / active-hit passages React-controlled so a
                // later render cannot collapse the citation the URL asked for.
                const forceChunkOpen = isAutoOpenTarget && !autoOpenSuppressed;
                const status = selected
                  ? "Highlighted quoted passage"
                  : active
                    ? "Active search hit"
                    : "Source passage";
                const teaser = sourcePassageTeaser(chunk.displayContent);
                return (
                  <details
                    id={`${idPrefix}-${chunk.id}`}
                    key={chunk.id}
                    data-source-nested-disclosure
                    data-testid={selected ? "highlighted-indexed-source-chunk" : "indexed-source-passage-disclosure"}
                    data-source-chunk-id={chunk.id}
                    data-source-active-hit={active || undefined}
                    open={forceChunkOpen ? true : undefined}
                    className={cn(
                      sourceCard,
                      "group/source-row overflow-hidden p-0 transition source-print",
                      (selected || active) &&
                        "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] shadow-[var(--glow-soft)] ring-2 ring-[color:var(--clinical-accent)]/25",
                    )}
                  >
                    <summary
                      onClick={handleNestedSummaryClick}
                      className="flex min-h-tap cursor-pointer list-none items-start justify-between gap-2 px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:min-h-compact-meta"
                    >
                      <span className="min-w-0">
                        <span
                          className={cn(
                            "inline-flex min-h-6 items-center rounded-md px-2 text-xs font-bold",
                            selected
                              ? "bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
                              : active
                                ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                                : "border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)]",
                          )}
                        >
                          {status}
                        </span>
                        <span className={cn("mt-1.5 block", eyebrowText)}>
                          {chunk.page_number ? `Page ${chunk.page_number}` : "Passage"}
                          {chunk.serverRanked ? " · full-document search" : ""}
                        </span>
                        {chunk.section_heading ? (
                          <span className="mt-1 block text-sm font-semibold text-[color:var(--text)]">
                            {chunk.section_heading}
                          </span>
                        ) : null}
                        <span className={cn("mt-1 line-clamp-1 block text-xs leading-5", textMuted)}>
                          {teaser || "No displayable clinical text was available for this indexed passage."}
                        </span>
                      </span>
                      <ChevronDown
                        aria-hidden="true"
                        data-testid="indexed-source-passage-chevron"
                        className="mt-1 h-4 w-4 shrink-0 transition group-open/source-row:rotate-180"
                      />
                    </summary>
                    <div className="border-t border-[color:var(--border)] px-3 pb-3">
                      {chunk.matchedTerms.length ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {chunk.matchedTerms.slice(0, 5).map((term) => (
                            <span
                              key={`${chunk.id}:${term}`}
                              className="inline-flex min-h-6 items-center rounded-md border border-[color:var(--clinical-accent)]/20 bg-[color:var(--clinical-accent-soft)] px-2 text-2xs font-bold text-[color:var(--clinical-accent)]"
                            >
                              {term}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <p className="mb-2 mt-3 text-2xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
                        Excerpt
                      </p>
                      {normalizedSearch ? (
                        <p className="whitespace-pre-line rounded-lg bg-[color:var(--surface-inset)] px-3 py-2.5 text-sm leading-6 text-[color:var(--text)]">
                          <HighlightedSearchText
                            text={
                              chunk.displayContent
                                ? flowIndexedText(chunk.displayContent)
                                : "No displayable clinical text was available for this indexed passage."
                            }
                            terms={highlightTermsFor(chunk.matchedTerms, normalizedSearch)}
                          />
                        </p>
                      ) : (
                        <IndexedSourceText
                          text={chunk.displayContent}
                          emptyText="No displayable clinical text was available for this indexed passage."
                          compact
                        />
                      )}
                    </div>
                  </details>
                );
              })
            )}
          </div>
        </div>
      </div>
    </details>
  );
});
