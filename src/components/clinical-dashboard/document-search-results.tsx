"use client";

import { isPdfDocument } from "@/lib/pdf-documents";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  BookOpen,
  Clock3,
  Copy,
  ExternalLink,
  FileImage,
  FileText,
  Link2,
  ListChecks,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  Shield,
  ShieldAlert,
  Sparkles,
  Target,
} from "lucide-react";

import { stretchedRowLinkClass } from "@/components/card-recipes";
import { DocumentTagCloud } from "@/components/DocumentTagCloud";
import {
  ResultFilterSheet,
  ResultFilterTrigger,
  resultFilterFacetGroup,
  resultFilterGroup,
  type ResultFilterGroup,
} from "@/components/clinical-dashboard/result-filter-control";
import { documentDisplayTitle } from "@/components/DocumentOrganizationBadges";
import { isDeployedClinicalKb } from "@/lib/deployed-app";
import { ModeHomeTemplate } from "@/components/mode-home-template";
import {
  SearchResultsEmptyState,
  SearchResultsHeaderBand,
  type AppliedFilterChip,
} from "@/components/clinical-dashboard/search-results-header-band";
import { deriveDocumentSearchUnavailable } from "@/components/clinical-dashboard/document-search-unavailable-status";
import { useResultSort } from "@/components/use-result-sort";
import {
  DocumentActionButton,
  DocumentActionLink,
  DocumentBadge,
  documentActionClass,
} from "@/components/clinical-dashboard/document-ui";
import { useBatchSignedImageUrls } from "@/components/clinical-dashboard/use-batch-signed-urls";
import { useSignedImageUrl } from "@/components/clinical-dashboard/use-signed-image-url";
import {
  cn,
  floatingControl,
  LoadingPanel,
  metadataPillDensity,
  Skeleton,
  sourceCard,
  textMuted,
} from "@/components/ui-primitives";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { compactBestUseTitle } from "@/lib/compact-best-use-title";
import { withCatalogueDegradedNotice } from "@/lib/site-content/catalogue-degraded-notice";
import {
  buildSmartDocumentTagFacetIndex,
  filterDocumentsBySmartTagFacetIndex,
  projectSmartTagFacetGroups,
  type SmartDocumentTag,
  type SmartDocumentTagFacet,
} from "@/lib/document-tags";
import type { ServiceSearchMatch } from "@/lib/services";
import type { FormSearchMatch } from "@/lib/forms";
import {
  extractionQualityValues,
  sourceStatusValues,
  validationStatusValues,
  type SearchScopeFilters,
} from "@/lib/search-scope";
import { removeScopeFilterValue, scopeFilterChips } from "@/lib/search-scope-filter-chips";
import {
  documentLabelFilterFields,
  documentRetrievalFilterValueCount,
  deriveDocumentLabelOptions,
  extractionQualityLabels,
  filterDocumentsByRetrievalScope,
  mergePublicDocumentScopeFilters,
  projectedDocumentScopeCount,
  publicDocumentScopeFilters,
  sameDocumentScope,
  sourceStatusLabels,
  validationStatusLabels,
  type DocumentLabelFilterKey,
} from "@/lib/document-filter-model";
import {
  readResultFilterValue,
  readResultFilterValues,
  replaceResultFilterUrl,
  writeResultFilterValue,
  writeResultFilterValues,
} from "@/lib/result-filter-url";
import type { ClinicalDocument, SearchScopeSummary } from "@/lib/types";
import type { ClientDocumentMatch } from "@/lib/answer-client-payload";
import type { RegistryRequestStatus } from "@/lib/use-registry-records";
import { sortResultItems } from "@/lib/result-sort";
import { documentRelevanceLabel } from "./relevance-score";

type SearchFacet = { value: string; count: number };
type ResultTypeFilter = "all" | "tables" | "images" | "pdfs";
const resultTypeFilterValues = new Set<ResultTypeFilter>(["all", "tables", "images", "pdfs"]);
type DocumentFilterDraft = {
  query: string;
  facetKeys: string[];
  resultType: ResultTypeFilter;
  scopeFilters: SearchScopeFilters;
  selectedDocumentIds: string[];
};

/** Initial DOM budget for document result cards; further rows reveal on demand. */
const DOCUMENT_RESULTS_INITIAL_WINDOW = 25;
const DOCUMENT_RESULTS_PAGE_SIZE = 25;
export type SearchFacets = {
  status?: SearchFacet[];
  validation?: SearchFacet[];
  extractionQuality?: SearchFacet[];
  sections?: SearchFacet[];
  labels?: SearchFacet[];
  sites?: SearchFacet[];
  documentTypes?: SearchFacet[];
  services?: SearchFacet[];
  settings?: SearchFacet[];
  populations?: SearchFacet[];
  risks?: SearchFacet[];
  clinicalActions?: SearchFacet[];
  carePhases?: SearchFacet[];
  documentIntents?: SearchFacet[];
  contentFeatures?: SearchFacet[];
  evidence?: SearchFacet[];
};

type SearchRecordMode = "services" | "forms";
type SearchRecordMatch = ServiceSearchMatch | FormSearchMatch;

const searchRecordConfig: Record<
  SearchRecordMode,
  {
    routePrefix: string;
    ariaLabel: string;
    heading: string;
    chip: string;
    recordLabel: string;
    testIdPrefix: string;
  }
> = {
  services: {
    routePrefix: "/services",
    ariaLabel: "Service record matches",
    heading: "Verified service records",
    chip: "Services mode",
    recordLabel: "service record",
    testIdPrefix: "service-search",
  },
  forms: {
    routePrefix: "/forms",
    ariaLabel: "Form record matches",
    heading: "Verified forms",
    chip: "Forms mode",
    recordLabel: "form record",
    testIdPrefix: "form-search",
  },
};

// The filter sheet itself (source type as a lens, smart-tag facets as facet groups) is
// built in DocumentSearchResultsPanelImpl below and rendered through the shared
// ResultFilterSheet/ResultFilterTrigger (src/components/clinical-dashboard/result-filter-control.tsx),
// which grew documents' own dense tier (find-a-filter, collapse-by-default) and
// typed coverage, result-action and secondary-action anatomy. Result type is
// single-select and the tag facets are multi-select (OR within a group, AND across
// groups, per filterDocumentsBySmartTagFacetIndex), so the two still carry different
// affordances: role="radio"+aria-checked for source type, aria-pressed for facets —
// the shared component picks the renderer from each group's own `kind`.

function documentPageLabel(document: ClientDocumentMatch) {
  const pages = document.bestPages.filter((page) => Number.isFinite(page));
  if (pages.length === 0) return "Page unavailable";
  if (pages.length === 1) return `Page ${pages[0]}`;

  const consecutive = pages.every((page, index) => index === 0 || page === pages[index - 1]! + 1);
  if (consecutive) return `Pages ${pages[0]}–${pages.at(-1)}`;
  return `Page ${pages[0]} +${pages.length - 1}`;
}

function resultTypeTabs(matches: ClientDocumentMatch[]) {
  const tabs = [
    { key: "all" as const, label: "All", count: matches.length },
    { key: "tables" as const, label: "Tables", count: matches.filter((match) => match.tableCount > 0).length },
    { key: "images" as const, label: "Images", count: matches.filter((match) => match.imageCount > 0).length },
  ];

  return tabs.filter((tab) => tab.key === "all" || tab.count > 0);
}

function filterMatchesByResultType(matches: ClientDocumentMatch[], filter: ResultTypeFilter) {
  if (filter === "tables") return matches.filter((match) => match.tableCount > 0);
  if (filter === "images") return matches.filter((match) => match.imageCount > 0);
  if (filter === "pdfs") return matches.filter((match) => match.file_name.toLowerCase().endsWith(".pdf"));
  return matches;
}

function loadedSourceCountHint(count: number) {
  return `${count.toLocaleString()} loaded ${count === 1 ? "source" : "sources"}`;
}

// What the option DISPLAYS. The announced name keeps the full phrase above, so
// a reader still hears the unit; the visible column is a bare numeral. Spelling
// "0 loaded sources" seven times down a phone sheet made every option wide
// enough to wrap onto its own line and repeated the same two words in each one.
function loadedSourceCountLabel(count: number) {
  return count.toLocaleString();
}

function documentOpenHref(document: ClientDocumentMatch) {
  const params = new URLSearchParams();
  params.set("page", String(document.bestPages[0] ?? 1));
  const chunkId = document.bestChunkIds[0];
  if (chunkId) params.set("chunk", chunkId);
  return `/documents/${document.document_id}?${params.toString()}`;
}

const resultMenuItemClass =
  "flex min-h-12 w-full items-center gap-2.5 px-3 py-2 text-left text-sm font-bold text-[color:var(--text)] transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--focus)]";

function DocumentPagePreview({ document, href }: { document: ClientDocumentMatch; href: string }) {
  const pageNumber = document.bestPages[0] ?? 1;
  const lineWidths = [74, 88, 63, 79, 56];
  const coverEndpoint = document.coverImageId ? `/api/images/${document.coverImageId}/signed-url` : "";
  const { url: coverUrl, failed: coverFailed, markFailed } = useSignedImageUrl(coverEndpoint, Boolean(coverEndpoint));
  const [loadedCoverUrl, setLoadedCoverUrl] = useState<string | null>(null);
  const hasCoverUrl = Boolean(coverEndpoint && coverUrl && !coverFailed);
  const coverLoaded = Boolean(coverUrl && loadedCoverUrl === coverUrl);
  const showSkeleton = Boolean(coverEndpoint && !coverFailed && !coverLoaded);
  const showFallback = Boolean(!coverLoaded && (!coverEndpoint || coverFailed));

  return (
    <Link
      href={href}
      aria-label={`Preview page ${pageNumber} of ${document.title}`}
      data-testid="document-page-preview"
      className="group relative z-10 flex h-28 w-20 shrink-0 flex-col overflow-hidden rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface)] shadow-[var(--e2)] transition hover:-translate-y-0.5 hover:border-[color:var(--clinical-accent-border)] hover:shadow-[var(--shadow-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transform-none motion-reduce:transition-none sm:h-32 sm:w-24"
    >
      {hasCoverUrl ? (
        // Private signed covers stay unoptimized so bearer URLs never enter `/_next/image`.
        // eslint-disable-next-line @next/next/no-img-element -- signed private URL; avoid optimizer cache
        <img
          src={coverUrl!}
          alt=""
          aria-hidden="true"
          onLoad={() => setLoadedCoverUrl(coverUrl)}
          onError={markFailed}
          className={cn(
            "absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-[var(--duration-deliberate)] motion-reduce:transition-none",
            coverLoaded ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
      {showSkeleton ? <Skeleton className="absolute inset-0 h-full w-full rounded-none" /> : null}
      {showFallback ? (
        <span className="relative flex h-full flex-col p-2 sm:p-2.5" aria-hidden="true">
          <span className="flex items-center justify-between text-[color:var(--clinical-accent)]">
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="h-1.5 w-5 rounded-full bg-[color:var(--clinical-accent-soft)]" />
          </span>
          <span className="mt-3 space-y-1.5">
            {lineWidths.map((width, index) => (
              <span
                key={`${document.document_id}-preview-line-${index}`}
                className={cn(
                  "block h-1 rounded-full bg-[color:var(--border-strong)]",
                  index < 2 && "bg-[color:var(--clinical-accent)]",
                )}
                style={{ width: `${width}%` }}
              />
            ))}
          </span>
          <span className="mt-auto grid grid-cols-3 gap-1 opacity-80 transition group-hover:opacity-100">
            <span className="h-3 rounded-sm bg-[color:var(--clinical-accent-soft)]" />
            <span className="h-3 rounded-sm bg-[color:var(--surface-subtle)]" />
            <span className="h-3 rounded-sm bg-[color:var(--clinical-accent-soft)]" />
          </span>
        </span>
      ) : null}
      <span className="absolute bottom-1.5 right-1.5 rounded bg-[color:var(--surface-raised)]/95 px-1.5 py-0.5 text-3xs font-bold text-[color:var(--text-muted)] shadow-[var(--shadow-inset)]">
        {pageNumber}
      </span>
    </Link>
  );
}

type ResultCopyStatus = "idle" | "citation-copied" | "citation-failed" | "link-copied" | "link-failed";

function DocumentResultMoreMenu({
  document,
  openHref,
  onScopeDocument,
}: {
  document: ClientDocumentMatch;
  openHref: string;
  onScopeDocument: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<ResultCopyStatus>("idle");
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerId = useId();
  const menuId = useId();

  const updateMenuPosition = useCallback(() => {
    const trigger = buttonRef.current;
    if (!trigger) return;
    const triggerRect = trigger.getBoundingClientRect();
    const viewportPadding = 16;
    const gap = 8;
    const menuWidth = Math.min(272, window.innerWidth - viewportPadding * 2);
    const menuHeight = menuRef.current?.getBoundingClientRect().height ?? (document.imageCount > 0 ? 204 : 156);
    const left = Math.min(
      Math.max(viewportPadding, triggerRect.right - menuWidth),
      window.innerWidth - viewportPadding - menuWidth,
    );
    const top =
      triggerRect.top - gap - menuHeight >= viewportPadding
        ? triggerRect.top - gap - menuHeight
        : Math.min(triggerRect.bottom + gap, window.innerHeight - viewportPadding - menuHeight);
    setMenuPosition({ left, top: Math.max(viewportPadding, top) });
  }, [document.imageCount]);

  useEffect(() => {
    if (!open) return;

    let positionFrame: number | null = null;
    const scheduleMenuPositionUpdate = () => {
      if (positionFrame !== null) return;
      positionFrame = window.requestAnimationFrame(() => {
        positionFrame = null;
        updateMenuPosition();
      });
    };
    const scrollOptions: AddEventListenerOptions = { capture: true, passive: true };

    function closeOutside(event: PointerEvent) {
      if (menuRef.current?.contains(event.target as Node) || buttonRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus({ preventScroll: true });
    }

    window.document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", scheduleMenuPositionUpdate);
    window.addEventListener("scroll", scheduleMenuPositionUpdate, scrollOptions);
    updateMenuPosition();
    return () => {
      if (positionFrame !== null) window.cancelAnimationFrame(positionFrame);
      window.document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", scheduleMenuPositionUpdate);
      window.removeEventListener("scroll", scheduleMenuPositionUpdate, scrollOptions);
    };
  }, [open, updateMenuPosition]);

  function focusMenuItem(position: "first" | "last" = "first") {
    window.requestAnimationFrame(() => {
      updateMenuPosition();
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      const target = position === "first" ? items[0] : items.at(-1);
      target?.focus({ preventScroll: true });
    });
  }

  function openMenu(position: "first" | "last" = "first") {
    updateMenuPosition();
    setOpen(true);
    setCopyStatus("idle");
    focusMenuItem(position);
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const currentIndex = items.findIndex((item) => item === window.document.activeElement);

    if (event.key === "Tab") {
      setOpen(false);
      return;
    }

    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    if (event.key === "ArrowUp")
      nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;

    if (nextIndex !== null && items[nextIndex]) {
      event.preventDefault();
      items[nextIndex].focus({ preventScroll: true });
    }
  }

  async function copyValue(value: string, action: "citation" | "link") {
    const restoreFocusTarget =
      window.document.activeElement instanceof HTMLElement && menuRef.current?.contains(window.document.activeElement)
        ? window.document.activeElement
        : null;
    try {
      await copyTextToClipboard(value);
      setCopyStatus(action === "citation" ? "citation-copied" : "link-copied");
    } catch {
      setCopyStatus(action === "citation" ? "citation-failed" : "link-failed");
    } finally {
      window.requestAnimationFrame(() => {
        if (restoreFocusTarget?.isConnected && menuRef.current?.contains(restoreFocusTarget)) {
          restoreFocusTarget.focus({ preventScroll: true });
        }
      });
    }
  }

  const citation = `${documentDisplayTitle(document)}. ${documentPageLabel(document)}.`;

  return (
    <div className="relative min-w-0">
      <button
        ref={buttonRef}
        id={triggerId}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        aria-label={`More actions for ${document.title}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          openMenu(event.key === "ArrowUp" ? "last" : "first");
        }}
        className={cn(
          documentActionClass,
          "min-h-12 w-full min-w-0 rounded-br-xl px-2 !text-sm !font-semibold text-[color:var(--text)]",
        )}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        More
      </button>
      {open && menuPosition
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              data-testid="document-result-more-menu"
              role="menu"
              aria-labelledby={triggerId}
              onKeyDown={handleMenuKeyDown}
              style={menuPosition}
              className="fixed z-80 w-[min(17rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface)] py-1.5 shadow-[var(--shadow-lift)]"
            >
              <button
                type="button"
                role="menuitem"
                className={resultMenuItemClass}
                onClick={() => {
                  onScopeDocument();
                  setOpen(false);
                }}
              >
                <Target className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden="true" />
                Search only this source
              </button>
              <button
                type="button"
                role="menuitem"
                className={resultMenuItemClass}
                onClick={() => void copyValue(citation, "citation")}
              >
                <Copy className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden="true" />
                {copyStatus === "citation-copied"
                  ? "Citation copied"
                  : copyStatus === "citation-failed"
                    ? "Copy failed"
                    : "Copy citation"}
              </button>
              <button
                type="button"
                role="menuitem"
                className={resultMenuItemClass}
                onClick={() => void copyValue(new URL(openHref, window.location.origin).toString(), "link")}
              >
                <Link2 className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden="true" />
                {copyStatus === "link-copied"
                  ? "Link copied"
                  : copyStatus === "link-failed"
                    ? "Copy failed"
                    : "Copy link"}
              </button>
              {document.imageCount > 0 ? (
                <Link
                  href={`${openHref}#source-images`}
                  role="menuitem"
                  className={resultMenuItemClass}
                  onClick={() => setOpen(false)}
                >
                  <FileImage className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden="true" />
                  View images ({document.imageCount})
                </Link>
              ) : null}
            </div>,
            window.document.body,
          )
        : null}
      <span className="sr-only" role="status" aria-live="polite">
        {copyStatus === "citation-copied"
          ? `${document.title} citation copied`
          : copyStatus === "link-copied"
            ? `${document.title} link copied`
            : copyStatus === "citation-failed" || copyStatus === "link-failed"
              ? "Unable to copy"
              : ""}
      </span>
    </div>
  );
}

function DocumentSearchHome({
  documentCount,
  onOpenRecentDocuments,
  onOpenLibrary,
  onOpenSourcePdf,
  desktopComposerSlotId,
}: {
  documentCount: number;
  onOpenRecentDocuments: () => void;
  onOpenLibrary: () => void;
  onOpenSourcePdf: () => void;
  desktopComposerSlotId?: string;
}) {
  const startItems = [
    {
      label: "Recent documents",
      description: "Pick up where you left off.",
      icon: Clock3,
      action: onOpenRecentDocuments,
    },
    {
      label: "Browse library",
      description: "Open any indexed source.",
      icon: BookOpen,
      action: onOpenLibrary,
    },
    {
      label: "Open a source PDF",
      description: "Original source files.",
      icon: ExternalLink,
      action: onOpenSourcePdf,
    },
  ];

  return (
    <ModeHomeTemplate
      testId="document-search-empty-state"
      title="Documents"
      subtitle="Open, browse, and continue reading your clinical sources."
      icon={FileText}
      headingLevel={2}
      desktopComposerSlotId={desktopComposerSlotId}
      actionsLabel="Start here"
      actions={startItems.map((item) => ({
        title: item.label,
        description: item.description,
        icon: item.icon,
        onClick: item.action,
      }))}
      footer={
        <div className="grid w-full gap-3">
          {documentCount > 0 ? (
            <p className="text-xs font-semibold text-[color:var(--text-muted)]">
              {documentCount.toLocaleString()} indexed source{documentCount === 1 ? "" : "s"}
            </p>
          ) : null}
          {/* The visible count above can change while this home screen stays
              mounted (ingestion polling updates the indexed total), so the
              live announcement lives on this separate sr-only twin rather
              than on the visible node itself — SPEC.md §9.2. Mounted
              unconditionally (empty until documentCount is positive): a
              region that appears already containing its content — the shape
              a poll landing on the very first render would produce — is not
              reliably announced by assistive tech, only a text change inside
              an already-mounted region is. */}
          <span className="sr-only" role="status" aria-live="polite">
            {documentCount > 0
              ? `${documentCount.toLocaleString()} indexed source${documentCount === 1 ? "" : "s"}`
              : ""}
          </span>
        </div>
      }
    />
  );
}

function SearchRecordResults({
  matches,
  query,
  mode,
  degraded = false,
}: {
  matches: SearchRecordMatch[];
  query: string;
  mode: SearchRecordMode;
  /** Served from the in-bundle catalogue: the records are real, the list may
   *  not include the most recent publication, and the heading says so. */
  degraded?: boolean;
}) {
  if (matches.length === 0) return null;
  const copy = searchRecordConfig[mode];
  const recordRoute = (slug: string) => `${copy.routePrefix}/${slug}`;
  return (
    <section
      data-testid={`${copy.testIdPrefix}-results`}
      aria-label={copy.ariaLabel}
      className="grid gap-3 rounded-lg border border-[color:var(--clinical-accent)]/20 bg-[color:var(--surface-lux)] p-3 shadow-[var(--e1)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]">
            <FileText className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[color:var(--text-heading)]">
              {withCatalogueDegradedNotice(copy.heading, degraded)}
            </h3>
            <p className={cn("text-sm leading-5", textMuted)}>
              {matches.length} structured {copy.recordLabel}
              {matches.length === 1 ? "" : "s"} matched
              {query.trim() ? ` "${query.trim()}"` : ""}.
            </p>
          </div>
        </div>
        <span className={metadataPillDensity.roomyCompact}>{copy.chip}</span>
      </div>

      <div className="grid gap-3">
        {matches.map(({ service, reasons }, index) => {
          const summaryCards = service.summaryCards?.slice(0, 3) ?? [];
          const chips = [
            ...(service.statusChips ?? []).map((chip) => chip.label).filter(Boolean),
            service.primaryContact?.value,
            service.source?.status,
          ].filter((value): value is string => Boolean(value?.trim()));

          return (
            <article
              key={service.slug}
              data-testid={`${copy.testIdPrefix}-result-${service.slug}`}
              className={cn(
                sourceCard,
                "content-auto",
                "relative grid gap-3 p-3 shadow-[var(--e1)] transition hover:border-[color:var(--clinical-accent-border)] sm:p-4",
                index === 0 && "ring-1 ring-[color:var(--clinical-accent)]/15",
              )}
            >
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0">
                  <p className="text-2xs font-bold uppercase tracking-label text-[color:var(--text-muted)]">
                    {service.catalogueLabel ?? "Source-backed record"}
                  </p>
                  <Link
                    href={recordRoute(service.slug)}
                    className={cn(
                      "mt-0.5 inline-flex min-h-tap items-center text-base font-semibold leading-6 text-[color:var(--text-heading)] transition hover:text-[color:var(--clinical-accent)]",
                      stretchedRowLinkClass,
                    )}
                  >
                    <span className="line-clamp-2">{service.title}</span>
                  </Link>
                  <p className={cn("mt-1 line-clamp-2 text-sm leading-6", textMuted)}>
                    {(() => {
                      const subtitleText =
                        service.subtitle ?? service.bestUse ?? service.route ?? "Open the source-backed record.";
                      return mode === "services" ? compactBestUseTitle(subtitleText, 120) : subtitleText;
                    })()}
                  </p>
                </div>
                <Link
                  href={recordRoute(service.slug)}
                  className={cn(
                    floatingControl,
                    "relative z-10 inline-flex min-h-tap w-full justify-center rounded-lg px-3 text-sm text-[color:var(--clinical-accent)] sm:w-auto",
                  )}
                  aria-label={`Open ${service.title}`}
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Open
                </Link>
              </div>

              {chips.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {chips.slice(0, 5).map((chip) => (
                    <span key={chip} className={metadataPillDensity.dense}>
                      {chip}
                    </span>
                  ))}
                </div>
              ) : null}

              {summaryCards.length ? (
                <dl className="grid gap-2 sm:grid-cols-3">
                  {summaryCards.map((card) => (
                    <div
                      key={card.id}
                      className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-2.5"
                    >
                      <dt className="text-2xs font-bold uppercase tracking-label text-[color:var(--text-muted)]">
                        {card.label ?? card.id}
                      </dt>
                      <dd className="mt-1 text-sm font-semibold leading-5 text-[color:var(--text-heading)]">
                        {card.title ?? "Check record"}
                      </dd>
                      {card.detail ? (
                        <dd className={cn("mt-0.5 text-xs leading-5", textMuted)}>{card.detail}</dd>
                      ) : null}
                    </div>
                  ))}
                </dl>
              ) : null}

              {reasons.length ? (
                <p className="text-xs font-medium text-[color:var(--text-muted)]">
                  Matched by {reasons.slice(0, 3).join(", ")}.
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RecordRegistryNotice({ status, mode }: { status: RegistryRequestStatus; mode: SearchRecordMode }) {
  if (status === "ready" || status === "refetching") return null;
  const noun = mode === "forms" ? "forms" : "services";
  const config =
    status === "loading"
      ? { Icon: Loader2, spin: true, tone: "info" as const, text: `Loading your ${noun} registry…` }
      : status === "unauthorized"
        ? {
            Icon: Shield,
            spin: false,
            tone: "warning" as const,
            text: `Your session expired. Sign in again to search your private ${noun} registry.`,
          }
        : {
            Icon: ShieldAlert,
            spin: false,
            tone: "danger" as const,
            text: `Couldn't load the ${noun} registry. Try again shortly.`,
          };
  const toneClass =
    config.tone === "danger"
      ? "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]/50 text-[color:var(--danger)]"
      : config.tone === "warning"
        ? "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)]/50 text-[color:var(--warning)]"
        : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)]";
  return (
    <p
      data-testid="dashboard-registry-status-notice"
      className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold", toneClass)}
    >
      <config.Icon className={cn("h-4 w-4 shrink-0", config.spin && "animate-spin")} aria-hidden />
      {config.text}
    </p>
  );
}

function DocumentSearchResultsPanelImpl({
  matches: retrievedMatches,
  recordMatches = [],
  recordMode = "services",
  recordStatus = "ready",
  recordDegraded = false,
  showRecordMatches = false,
  query,
  loading,
  documentCount,
  realDataReady,
  authUnavailable,
  apiUnavailable,
  setupWarning,
  facets: _facets,
  searchScope = null,
  onScopeDocument,
  onAnswerFromDocument,
  onOpenRecentDocuments,
  onOpenLibrary,
  onOpenSourcePdf,
  onTagSearch,
  recentDocuments = [],
  selectedDocumentIds = [],
  scopeFilters,
  onScopeFiltersChange,
  onDocumentFiltersApply,
  showHome = false,
  desktopComposerSlotId,
  searchFailed = false,
}: {
  matches: ClientDocumentMatch[];
  recordMatches?: SearchRecordMatch[];
  recordMode?: SearchRecordMode;
  recordStatus?: RegistryRequestStatus;
  /** The services/forms catalogue was served from the in-bundle seed list, so
   *  the matches are real but the list may lag what was published. */
  recordDegraded?: boolean;
  showRecordMatches?: boolean;
  query: string;
  loading: boolean;
  documentCount: number;
  recentDocuments?: ClinicalDocument[];
  realDataReady: boolean;
  authUnavailable: boolean;
  apiUnavailable: boolean;
  setupWarning: string | null;
  /** The last documents search request failed, so an empty list is not a real "no matches". */
  searchFailed?: boolean;
  facets?: SearchFacets | null;
  searchScope?: SearchScopeSummary | null;
  onScopeDocument: (documentId: string) => void;
  onAnswerFromDocument: (documentId: string) => void;
  onOpenRecentDocuments: () => void;
  onOpenLibrary: () => void;
  onOpenSourcePdf: () => void;
  onTagSearch: (tag: SmartDocumentTag | SmartDocumentTagFacet) => void;
  selectedDocumentIds?: string[];
  /**
   * The scope filters the current results were requested with. Paired with
   * `searchScope.activeFilterCount` (the server's count of what it actually
   * applied) so the zero-result state only claims a filter when retrieval was
   * really scoped.
   */
  scopeFilters?: SearchScopeFilters | null;
  /**
   * Re-run the search with a relaxed server-side scope. Required to make the
   * scoped-to-zero state recoverable: those filters are applied before
   * retrieval, so no client-side control can undo them. Omit to hide that route.
   */
  onScopeFiltersChange?: (filters: SearchScopeFilters) => void;
  /** Commits the staged retrieval scope and performs the one resulting search. */
  onDocumentFiltersApply?: (filters: SearchScopeFilters, selectedDocumentIds: string[]) => void;
  showHome?: boolean;
  desktopComposerSlotId?: string;
}) {
  // Only PDFs are listed as documents; other sources still reach answers.
  const matches = useMemo(() => retrievedMatches.filter(isPdfDocument), [retrievedMatches]);
  void _facets;
  const [sortValue, setSortValue] = useResultSort();
  const searchParams = useSearchParams();
  const trimmedQuery = query.trim();
  const filterPanelId = useId();
  const filterOpenerRef = useRef<HTMLElement | null>(null);
  // Query-scope the open flag the same way facets are scoped: a new search must
  // not leave the panel covering a different result set (especially on phones).
  // Do not reset via useEffect+setState — react-hooks/set-state-in-effect fails CI.
  const [filterPanelState, setFilterPanelState] = useState<{ query: string; open: boolean }>({
    query: "",
    open: false,
  });
  const filterPanelOpen = filterPanelState.query === query && filterPanelState.open;
  const tagFacetIndex = useMemo(() => buildSmartDocumentTagFacetIndex(matches, { query }), [matches, query]);
  const availableFacetKeys = useMemo(
    () => new Set(tagFacetIndex.groups.flatMap((group) => group.facets.map((facet) => facet.key))),
    [tagFacetIndex],
  );
  const activeFacetKeys = useMemo(
    () => readResultFilterValues(searchParams, "facet", availableFacetKeys),
    [availableFacetKeys, searchParams],
  );
  const activeResultType = readResultFilterValue(searchParams, "resultType", resultTypeFilterValues, "all");
  const committedScopeFilters = scopeFilters ?? {};
  const [filterDraft, setFilterDraft] = useState<DocumentFilterDraft>({
    query: "",
    facetKeys: [],
    resultType: "all",
    scopeFilters: {},
    selectedDocumentIds: [],
  });
  // Counts must describe the set the reader is looking at. `tagFacetIndex.groups`
  // counts against the whole match set, so once a facet is selected the rest of
  // the panel reports numbers for a set that no longer exists — several of them
  // pointing at AND-combinations that return nothing.
  const tagFacetGroups = useMemo(
    () => projectSmartTagFacetGroups(tagFacetIndex, activeFacetKeys),
    [tagFacetIndex, activeFacetKeys],
  );
  const visibleMatches = useMemo(
    () => filterDocumentsBySmartTagFacetIndex(tagFacetIndex, activeFacetKeys),
    [tagFacetIndex, activeFacetKeys],
  );
  const resultTabs = useMemo(() => resultTypeTabs(visibleMatches), [visibleMatches]);
  const effectiveResultType = resultTabs.some((tab) => tab.key === activeResultType) ? activeResultType : "all";
  const displayedMatches = useMemo(
    () => filterMatchesByResultType(visibleMatches, effectiveResultType),
    [visibleMatches, effectiveResultType],
  );
  const sortedMatches = useMemo(
    () => sortResultItems(displayedMatches, sortValue, documentDisplayTitle),
    [displayedMatches, sortValue],
  );
  // Progressive reveal so large libraries do not mount every card on first paint.
  // Reset the window whenever the sorted result set identity changes (query/filter/sort).
  const resultsSignature = [
    trimmedQuery,
    sortValue,
    effectiveResultType,
    activeFacetKeys.join(","),
    sortedMatches.map((document) => document.document_id).join(","),
  ].join("\0");
  const [visibleCountState, setVisibleCountState] = useState({
    signature: resultsSignature,
    count: DOCUMENT_RESULTS_INITIAL_WINDOW,
  });
  if (visibleCountState.signature !== resultsSignature) {
    setVisibleCountState({ signature: resultsSignature, count: DOCUMENT_RESULTS_INITIAL_WINDOW });
  }
  const visibleCount = Math.min(visibleCountState.count, sortedMatches.length);
  const renderedMatches = sortedMatches.slice(0, visibleCount);
  const coverImageIds = useMemo(
    () => renderedMatches.map((doc) => doc.coverImageId).filter((id): id is string => Boolean(id)),
    [renderedMatches],
  );
  useBatchSignedImageUrls(coverImageIds);
  const hasMoreMatches = visibleCount < sortedMatches.length;
  const recordMatchCount = recordMatches.length;
  const shouldShowHome = showHome || !trimmedQuery;

  // Stable per query so the applied-filter shelf can depend on it honestly
  // rather than suppressing the dependency check.
  const toggleTagFacet = useCallback(
    (key: string) => {
      replaceResultFilterUrl((params) => {
        const next = new Set(readResultFilterValues(params, "facet", availableFacetKeys));
        if (!next.delete(key)) next.add(key);
        writeResultFilterValues(params, "facet", next, availableFacetKeys);
      });
    },
    [availableFacetKeys],
  );

  const setResultType = useCallback((value: ResultTypeFilter) => {
    replaceResultFilterUrl((params) =>
      writeResultFilterValue(params, "resultType", value, "all", resultTypeFilterValues),
    );
  }, []);

  const unavailable = deriveDocumentSearchUnavailable({
    apiUnavailable,
    authUnavailable,
    realDataReady,
    setupWarning,
    deployedClinicalKb: isDeployedClinicalKb(),
  });
  const unavailableMessage = unavailable?.message ?? null;
  // On the record path the band's fault panel now reports a failed registry, so
  // RecordRegistryNotice would repeat that verbatim two lines below — the same
  // double-reporting removed from the standalone services/forms pages. Loading
  // is still the notice's to own: the band only says "Searching…" there.
  const recordBandOwnsFault =
    showRecordMatches && (recordStatus === "error" || recordStatus === "not_found" || recordStatus === "unauthorized");
  const showResultsControls = matches.length > 0 && !loading;
  const activeFilterCount =
    activeFacetKeys.length +
    (effectiveResultType === "all" ? 0 : 1) +
    documentRetrievalFilterValueCount(committedScopeFilters, selectedDocumentIds.length);
  // Both the source-type tabs and the tag facets are derived from the current
  // match set, so a query that yields one uniform kind of document has nothing
  // to offer. Advertising Filter there would open an empty panel.
  const hasFilters = resultTabs.length > 1 || tagFacetGroups.length > 0;
  const hasRetrievalFilters =
    recentDocuments.length > 0 ||
    documentRetrievalFilterValueCount(committedScopeFilters, selectedDocumentIds.length) > 0;
  const showFilterControl =
    !showRecordMatches && !loading && Boolean(trimmedQuery) && (hasFilters || hasRetrievalFilters);
  /* The registry is still answering. `loading` covers only the document search,
     so on the services and forms paths the zero-result body used to render
     "No matches for …" directly beneath a spine reading "Searching…" — the band
     derives its status from `recordStatus`, this branch did not. The band's
     clinical invariant is that a search in flight asserts nothing; the body has
     to hold to it too, or the page contradicts itself. Named here rather than
     inlined because a comment this long inside the ternary chain below gets
     reflowed into one line by Prettier on every run. */
  const recordSearchStillRunning = showRecordMatches && recordStatus === "loading";
  /* The in-context route to the whole corpus, for the render paths that have no
     other one. Shared rather than duplicated so a fourth path cannot be added
     without a Library route: the sheet footer needs `matches.length > 0`, and
     the zero-result empty state needs `recordMatchCount === 0`, which between
     them miss the services/forms record-match render entirely. */
  const browseLibraryControl = (
    <button
      type="button"
      onClick={onOpenLibrary}
      data-testid="document-results-browse-library"
      className={cn(floatingControl, "min-h-tap w-fit gap-2 px-3 text-xs sm:min-h-10")}
    >
      <BookOpen aria-hidden="true" className="size-icon-md shrink-0" />
      Browse all sources
      {documentCount > 0 ? (
        <span className="nums text-2xs text-[color:var(--text-muted)]">{documentCount.toLocaleString()}</span>
      ) : null}
    </button>
  );
  const openOrCloseFilters = () => {
    if (filterPanelOpen) {
      setFilterPanelState({ query, open: false });
      return;
    }
    setFilterDraft({
      query,
      facetKeys: activeFacetKeys,
      resultType: effectiveResultType,
      scopeFilters: publicDocumentScopeFilters(committedScopeFilters),
      selectedDocumentIds,
    });
    setFilterPanelState({ query, open: true });
  };
  // Remember which of the two triggers (phone / wide) opened the sheet, so
  // closing it returns focus there (#M3XZV0).
  const toggleFiltersFromTrigger = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!filterPanelOpen) filterOpenerRef.current = event.currentTarget;
    openOrCloseFilters();
  };
  const renderFilterTrigger = (testId: string) =>
    showFilterControl ? (
      <ResultFilterTrigger
        panelId={filterPanelId}
        testId={testId}
        title="Filter documents"
        open={filterPanelOpen}
        activeCount={activeFilterCount}
        onToggle={toggleFiltersFromTrigger}
      />
    ) : null;

  const activeDraft: DocumentFilterDraft =
    filterPanelOpen && filterDraft.query === query
      ? filterDraft
      : {
          query,
          facetKeys: activeFacetKeys,
          resultType: effectiveResultType,
          scopeFilters: publicDocumentScopeFilters(committedScopeFilters),
          selectedDocumentIds,
        };
  // These projections exist solely to render the open filter sheet. Keep the
  // library-sized scans dormant while it is closed so composer keystrokes do
  // not rebuild every projected count.
  const draftSourceDocuments = filterPanelOpen ? recentDocuments : [];
  const loadedSourceCountsAreComplete = documentCount > 0 && draftSourceDocuments.length >= documentCount;
  const draftSelectedDocumentIds = new Set(filterPanelOpen ? activeDraft.selectedDocumentIds : []);
  const draftTagFacetGroups = filterPanelOpen ? projectSmartTagFacetGroups(tagFacetIndex, activeDraft.facetKeys) : [];
  const draftVisibleMatches = filterPanelOpen
    ? filterDocumentsBySmartTagFacetIndex(tagFacetIndex, activeDraft.facetKeys)
    : [];
  const draftResultTabs = filterPanelOpen ? resultTypeTabs(draftVisibleMatches) : [];
  const draftResultType =
    filterPanelOpen && draftResultTabs.some((tab) => tab.key === activeDraft.resultType)
      ? activeDraft.resultType
      : "all";
  const draftDisplayedMatches = filterPanelOpen ? filterMatchesByResultType(draftVisibleMatches, draftResultType) : [];

  function toggleDraftListFilter(
    key: DocumentLabelFilterKey | "sourceStatuses" | "validationStatuses" | "extractionQualities",
    value: string,
  ) {
    setFilterDraft((current) => {
      const selected = new Set((current.scopeFilters[key] as string[] | undefined) ?? []);
      if (!selected.delete(value)) selected.add(value);
      return { ...current, scopeFilters: { ...current.scopeFilters, [key]: [...selected] } };
    });
  }

  function commitRetrievalFilters(filters: SearchScopeFilters, documentIds: string[]) {
    if (onDocumentFiltersApply) onDocumentFiltersApply(filters, documentIds);
    else if (onScopeFiltersChange) onScopeFiltersChange(filters);
  }

  function applyDocumentFilters() {
    replaceResultFilterUrl((params) => {
      writeResultFilterValues(params, "facet", activeDraft.facetKeys, availableFacetKeys);
      writeResultFilterValue(params, "resultType", draftResultType, "all", resultTypeFilterValues);
    });
    const nextScope = mergePublicDocumentScopeFilters(committedScopeFilters, activeDraft.scopeFilters);
    const selectedChanged =
      [...activeDraft.selectedDocumentIds].sort().join("\0") !== [...selectedDocumentIds].sort().join("\0");
    if (!sameDocumentScope(nextScope, committedScopeFilters) || selectedChanged) {
      commitRetrievalFilters(nextScope, activeDraft.selectedDocumentIds);
    }
    setFilterPanelState({ query, open: false });
  }

  function clearAllFilters() {
    replaceResultFilterUrl((params) => {
      params.delete("facet");
      params.delete("resultType");
    });
    const nextScope = mergePublicDocumentScopeFilters(committedScopeFilters, {});
    if (!sameDocumentScope(nextScope, committedScopeFilters) || selectedDocumentIds.length > 0) {
      commitRetrievalFilters(nextScope, []);
    }
  }

  const selectedFacetKeys = new Set(activeFacetKeys);
  const appliedFilters: AppliedFilterChip[] = [
    ...selectedDocumentIds.map((documentId) => {
      const document = recentDocuments.find((item) => item.id === documentId);
      return {
        id: `source-${documentId}`,
        groupLabel: "Source",
        valueLabel: document ? documentDisplayTitle(document) : "Selected source",
        onRemove: () =>
          commitRetrievalFilters(
            committedScopeFilters,
            selectedDocumentIds.filter((id) => id !== documentId),
          ),
      };
    }),
    ...scopeFilterChips(publicDocumentScopeFilters(committedScopeFilters)).map((chip) => ({
      ...chip,
      onRemove: () =>
        commitRetrievalFilters(
          mergePublicDocumentScopeFilters(
            committedScopeFilters,
            removeScopeFilterValue(publicDocumentScopeFilters(committedScopeFilters), chip.id),
          ),
          selectedDocumentIds,
        ),
    })),
    ...tagFacetGroups.flatMap((group) =>
      group.facets
        .filter((facet) => selectedFacetKeys.has(facet.key))
        .map((facet) => ({
          id: facet.key,
          groupLabel: group.group,
          valueLabel: facet.label,
          onRemove: () => toggleTagFacet(facet.key),
        })),
    ),
  ];
  if (effectiveResultType !== "all") {
    const tab = resultTabs.find((entry) => entry.key === effectiveResultType);
    if (tab) {
      appliedFilters.push({
        id: `result-type-${tab.key}`,
        groupLabel: "Result type",
        valueLabel: tab.label,
        onRemove: () => setResultType("all"),
      });
    }
  }

  const documentFilterGroups: ResultFilterGroup[] = [];
  if (draftSourceDocuments.length > 0) {
    documentFilterGroups.push(
      resultFilterFacetGroup({
        id: "selected-sources",
        label: "Selected sources",
        description: "Choose specific indexed sources. Leave empty to search across the filtered source set.",
        selected: draftSelectedDocumentIds,
        options: [...draftSourceDocuments]
          .sort((left, right) => documentDisplayTitle(left).localeCompare(documentDisplayTitle(right)))
          .map((document) => {
            const withCandidate = new Set(draftSelectedDocumentIds);
            if (!withCandidate.has(document.id)) withCandidate.add(document.id);
            const count = filterDocumentsByRetrievalScope(
              draftSourceDocuments,
              activeDraft.scopeFilters,
              withCandidate,
            ).length;
            return {
              value: document.id,
              label: documentDisplayTitle(document),
              searchText: `${document.title} ${document.file_name}`,
              hint: loadedSourceCountHint(count),
              hintLabel: loadedSourceCountLabel(count),
              disabled: count === 0 && !draftSelectedDocumentIds.has(document.id),
            };
          }),
        onToggle: (documentId) =>
          setFilterDraft((current) => {
            const next = new Set(current.selectedDocumentIds);
            if (!next.delete(documentId)) next.add(documentId);
            return { ...current, selectedDocumentIds: [...next] };
          }),
      }),
    );
  }

  const governanceGroups = filterPanelOpen
    ? [
        {
          key: "sourceStatuses" as const,
          label: "Source status",
          values: sourceStatusValues,
          labels: sourceStatusLabels,
        },
        {
          key: "validationStatuses" as const,
          label: "Clinical validation",
          values: validationStatusValues,
          labels: validationStatusLabels,
        },
        {
          key: "extractionQualities" as const,
          label: "Extraction quality",
          values: extractionQualityValues,
          labels: extractionQualityLabels,
        },
      ]
    : [];
  for (const [groupIndex, group] of governanceGroups.entries()) {
    const selected = new Set((activeDraft.scopeFilters[group.key] as string[] | undefined) ?? []);
    documentFilterGroups.push(
      resultFilterFacetGroup({
        id: group.key,
        label: group.label,
        // The three governance groups are adjacent and share one rule, so the
        // rule is stated once above the first of them. Repeating it verbatim
        // under each heading spent three lines saying the same thing.
        description: groupIndex === 0 ? "Source governance is applied before document retrieval." : undefined,
        selected,
        options: group.values.map((value) => {
          const count = projectedDocumentScopeCount({
            documents: draftSourceDocuments,
            filters: activeDraft.scopeFilters,
            selectedDocumentIds: draftSelectedDocumentIds,
            key: group.key,
            value,
          });
          return {
            value,
            label: group.labels[value] ?? value,
            hint: loadedSourceCountHint(count),
            hintLabel: loadedSourceCountLabel(count),
            disabled: loadedSourceCountsAreComplete && count === 0 && !selected.has(value),
          };
        }),
        onToggle: (value) => toggleDraftListFilter(group.key, value),
      }),
    );
  }

  if (filterPanelOpen) {
    const anyLocalityCount = filterDocumentsByRetrievalScope(
      draftSourceDocuments,
      { ...activeDraft.scopeFilters, locality: undefined },
      draftSelectedDocumentIds,
    ).length;
    documentFilterGroups.push(
      resultFilterGroup({
        id: "locality",
        label: "Source locality",
        description: "Separate WA and health-service sources from non-local guidance.",
        value: activeDraft.scopeFilters.locality ?? "all",
        options: [
          {
            value: "all",
            label: "Any locality",
            hint: loadedSourceCountHint(anyLocalityCount),
            hintLabel: loadedSourceCountLabel(anyLocalityCount),
          },
          ...(["local", "non_local"] as const).map((value) => {
            const count = filterDocumentsByRetrievalScope(
              draftSourceDocuments,
              { ...activeDraft.scopeFilters, locality: value },
              draftSelectedDocumentIds,
            ).length;
            return {
              value,
              label: value === "local" ? "Local" : "Non-local",
              hint: loadedSourceCountHint(count),
              hintLabel: loadedSourceCountLabel(count),
              disabled: loadedSourceCountsAreComplete && count === 0 && activeDraft.scopeFilters.locality !== value,
            };
          }),
        ],
        onChange: (value) =>
          setFilterDraft((current) => ({
            ...current,
            scopeFilters: {
              ...current.scopeFilters,
              locality: value === "all" ? undefined : value,
            },
          })),
      }),
    );
  }

  for (const field of filterPanelOpen ? documentLabelFilterFields : []) {
    const selected = new Set(activeDraft.scopeFilters[field.key] ?? []);
    const values = [...new Set([...deriveDocumentLabelOptions(draftSourceDocuments, field.labelType), ...selected])];
    if (values.length === 0) continue;
    documentFilterGroups.push(
      resultFilterFacetGroup({
        id: field.key,
        label: field.label,
        description: "Advanced clinical label. Values are OR alternatives within this group.",
        selected,
        options: values.map((value) => {
          const count = projectedDocumentScopeCount({
            documents: draftSourceDocuments,
            filters: activeDraft.scopeFilters,
            selectedDocumentIds: draftSelectedDocumentIds,
            key: field.key,
            value,
          });
          return {
            value,
            label: value,
            hint: loadedSourceCountHint(count),
            hintLabel: loadedSourceCountLabel(count),
            disabled: loadedSourceCountsAreComplete && count === 0 && !selected.has(value),
          };
        }),
        onToggle: (value) => toggleDraftListFilter(field.key, value),
      }),
    );
  }

  if (filterPanelOpen && draftResultTabs.length > 1) {
    documentFilterGroups.push(
      resultFilterGroup({
        id: "result-type",
        label: "Result type",
        description: "Refine the retrieved matches without running retrieval again.",
        note: "one only",
        value: draftResultType,
        options: draftResultTabs.map((tab) => ({ value: tab.key, label: tab.label, hint: String(tab.count) })),
        onChange: (value) => setFilterDraft((current) => ({ ...current, resultType: value })),
      }),
    );
  }
  for (const group of draftTagFacetGroups) {
    const selected = new Set(
      group.facets.filter((facet) => activeDraft.facetKeys.includes(facet.key)).map((facet) => facet.key),
    );
    documentFilterGroups.push(
      resultFilterFacetGroup({
        id: `smart-${group.group}`,
        label: group.group,
        description: "Smart tags refine the matches already retrieved.",
        selected,
        options: group.facets.map((facet) => ({
          value: facet.key,
          label: facet.label,
          hint: String(facet.count),
          searchText: facet.searchText,
          disabled: facet.count === 0 && !selected.has(facet.key),
        })),
        onToggle: (facetKey) =>
          setFilterDraft((current) => {
            const next = new Set(current.facetKeys);
            if (!next.delete(facetKey)) next.add(facetKey);
            return { ...current, facetKeys: [...next] };
          }),
      }),
    );
  }
  const draftActiveFilterCount = filterPanelOpen
    ? activeDraft.facetKeys.length +
      Number(draftResultType !== "all") +
      documentRetrievalFilterValueCount(activeDraft.scopeFilters, activeDraft.selectedDocumentIds.length)
    : 0;

  /* A retrieval layer errored, so no count from this search is trustworthy —
     including a non-zero one. The band owns that claim: it renders `matchCount`
     inside the only `role="status"` region on the page, and the zero-result
     state suppresses its own live region while filters are applied, so a
     degraded+scoped search announced a bare confident "0 documents" and nothing
     else. `partial` is the band's own word for it ("available sources returned
     an honest count, but at least one source failed") and is right for BOTH
     cases: at zero it stops the headline contradicting the panel below it, and
     above zero it is the only thing that says the list is a floor rather than
     the answer. (Raised by Devin review on PR #1640.) */
  // A failed request is the strongest form of the same fault: nothing was searched at all.
  const retrievalDegraded = Boolean(searchScope?.retrieval?.degraded) || searchFailed;
  // Mounted whenever the control is, not only while open (#M3XZV0): `Sheet`
  // skips its focus restore when it unmounts, so a sheet rendered only while
  // open closed with focus on <body>. Closed, it renders nothing — no DOM, no
  // tab stop, and nothing on the server render.
  const documentFilterSheet = showFilterControl ? (
    <ResultFilterSheet
      open={filterPanelOpen}
      returnFocusRef={filterOpenerRef}
      onClose={() => setFilterPanelState({ query, open: false })}
      panelId={filterPanelId}
      testId="document-filter-panel"
      title="Filter documents"
      description="Set retrieval scope, then refine the matches. Changes apply together."
      chromeResetKey={query}
      groups={documentFilterGroups}
      applicationMode="staged"
      primaryActionLabel="Update search"
      onApply={applyDocumentFilters}
      onClearAll={
        draftActiveFilterCount > 0
          ? () =>
              setFilterDraft((current) => ({
                ...current,
                facetKeys: [],
                resultType: "all",
                scopeFilters: {},
                selectedDocumentIds: [],
              }))
          : undefined
      }
      summary={{
        count: draftDisplayedMatches.length,
        noun: draftDisplayedMatches.length === 1 ? "match" : "matches",
      }}
      coverage={{
        visibleCount: draftDisplayedMatches.length,
        totalCount: matches.length,
        label: "Visible retrieved matches",
      }}
      secondaryAction={{
        label: "Browse all sources",
        count: documentCount > 0 ? documentCount : undefined,
        onClick: () => {
          setFilterPanelState({ query, open: false });
          onOpenLibrary();
        },
      }}
    />
  ) : null;
  const showIdentityHeader =
    recordMatchCount > 0 ||
    matches.length > 0 ||
    (trimmedQuery && !shouldShowHome) ||
    loading ||
    (unavailableMessage && !shouldShowHome);

  return (
    <div data-testid="document-search-workspace" className="w-full space-y-2.5 sm:space-y-3">
      {showIdentityHeader ? (
        <SearchResultsHeaderBand
          modeId={showRecordMatches ? recordMode : "documents"}
          query={trimmedQuery}
          matchCount={recordMatchCount + sortedMatches.length}
          // Derive the fault from whichever source this ribbon is actually
          // counting. On the services/forms path the registry has its own status
          // and can be perfectly healthy while the unrelated document API is
          // down; letting that invalidate the ribbon would announce "Couldn't
          // search" and hide a valid recordMatchCount while SearchRecordResults
          // renders those very matches below.
          status={
            showRecordMatches
              ? recordStatus === "unauthorized"
                ? "unauthorized"
                : recordStatus === "error" || recordStatus === "not_found"
                  ? "error"
                  : recordStatus === "loading"
                    ? "loading"
                    : recordStatus === "refetching"
                      ? "refetching"
                      : "ready"
              : (unavailable?.status ?? (loading ? "loading" : retrievalDegraded ? "partial" : "ready"))
          }
          faultBody={showRecordMatches ? undefined : (unavailableMessage ?? undefined)}
          // Only the record path can carry it: the documents path counts retrieval
          // matches, which have no seed catalogue behind them.
          catalogueDegraded={showRecordMatches && recordDegraded}
          sortValue={sortValue}
          onSortChange={matches.length > 0 ? setSortValue : undefined}
          // Library has left the rail. It sat adjacent to Filter while answering
          // a different question — Filter narrows what this query returned,
          // Library opens the whole indexed corpus — and that proximity is what
          // made the old name ("Filter and browse sources") read as a second
          // filter; renaming treated the symptom. It also occupied the rail
          // space the pinned Filter needs, and was the reason the phone rail
          // could overflow at all: without it documents carries only Sort and
          // Filter.
          //
          // It is moved, not removed. The requirement the old comment here was
          // protecting still holds — the documents action menu routes through
          // `onSearchModeChange`, which calls `setQuery("")`, so reaching the
          // library that way discards the search being read. Both of its new
          // homes are in-context and preserve the query: the filter sheet's
          // footer, and the zero-result state, which are the two moments
          // browsing is actually the next step.
          appliedFilters={appliedFilters}
          onClearFilters={activeFilterCount > 0 ? clearAllFilters : undefined}
          filterLabel="Filter documents"
          // The same trigger goes in both slots: the ribbon shows `mobileControls`
          // below `sm` and `filterControls` from `sm` up, never both at once.
          // The phone control here is a compact badged trigger, not a full-width
          // select, so it shares the count line rather than taking a row of its own.
          mobileControlsPlacement="inline"
          mobileControls={renderFilterTrigger("document-filter-trigger-phone")}
          filterControls={renderFilterTrigger("document-filter-trigger-wide")}
        />
      ) : null}

      {documentFilterSheet}

      {/* When the ribbon is shown it owns this message in its fault panel. This
          standalone alert remains for the routes that render no ribbon, so the
          message is never lost. */}
      {/* The ribbon only carries this message on the documents path; in record
          mode its fault comes from the registry, so the notice must still
          render or an auth/API/setup warning is reported nowhere. */}
      {unavailableMessage && (showRecordMatches || !showIdentityHeader) ? (
        <div
          role="alert"
          className="rounded-lg border border-[color:var(--warning)]/30 bg-[color:var(--warning-soft)]/45 p-4 text-sm font-semibold leading-6 text-[color:var(--warning)]"
        >
          {unavailableMessage}
        </div>
      ) : null}

      {showRecordMatches ? (
        <>
          {recordBandOwnsFault ? null : <RecordRegistryNotice status={recordStatus} mode={recordMode} />}
          <SearchRecordResults matches={recordMatches} query={query} mode={recordMode} degraded={recordDegraded} />
        </>
      ) : null}

      {loading ? (
        <LoadingPanel label="Finding matching documents" />
      ) : matches.length === 0 ? (
        // A services or forms search that matched records but no documents.
        // This branch used to render `null`, which stranded the reader: moving
        // Library off the utility rail left three homes for it — the sheet
        // footer, the zero-result empty state, and the inline fallback below —
        // and this path reaches none of them, because the sheet needs
        // `matches.length > 0` and the empty state needs `recordMatchCount === 0`.
        // `docs/search-results-bar-decisions.md` requires an in-context route
        // precisely because the documents action menu calls `setQuery("")` and
        // discards the search the reader is looking at.
        recordMatchCount > 0 ? (
          browseLibraryControl
        ) : recordSearchStillRunning ? null : trimmedQuery && !shouldShowHome ? (
          <SearchResultsEmptyState
            modeId="documents"
            query={trimmedQuery}
            // The band above owns `h2` for this region, so the zero-result
            // state is `h3` — the level #1612 gave it, kept across the move to
            // the shared state. The inline filtered-to-zero state inside the
            // results grid stays a paragraph: the grid's heading is the band's.
            headingLevel={3}
            // Names the scope constraint and hands back a relaxed filter set, so
            // the state reads "No documents match the selected filter … remove
            // one to widen it" instead of "check the spelling" — the copy this
            // shared state already carries for filtered-to-zero, which the
            // documents path could not reach because it only ever passed
            // client-derived facet chips (always empty at zero matches).
            appliedFilters={appliedFilters}
            onClearFilters={activeFilterCount > 0 ? clearAllFilters : undefined}
            // A retrieval layer errored, so this zero is not evidence of absence.
            degraded={retrievalDegraded}
            onBrowseAll={onOpenLibrary}
            browseAllLabel={
              documentCount > 0 ? `Browse all ${documentCount.toLocaleString()} sources` : "Browse all sources"
            }
          />
        ) : (
          <DocumentSearchHome
            documentCount={documentCount}
            onOpenRecentDocuments={onOpenRecentDocuments}
            onOpenLibrary={onOpenLibrary}
            onOpenSourcePdf={onOpenSourcePdf}
            desktopComposerSlotId={desktopComposerSlotId}
          />
        )
      ) : sortedMatches.length === 0 ? (
        // Facet toggles empty this list without a navigation. The shared
        // empty state leads with Remove / Clear all against the chips
        // that caused it (F11); the band's `role="status"` already
        // re-announced the zero count, so the empty state suppresses its
        // own live region on the filtered path to avoid a double polite
        // announcement for one interaction.
        <div data-testid="document-filter-empty-results" className="w-full">
          <SearchResultsEmptyState
            modeId="documents"
            query={trimmedQuery}
            appliedFilters={appliedFilters}
            onClearFilters={clearAllFilters}
            onBrowseAll={onOpenLibrary}
            browseAllLabel={
              documentCount > 0 ? `Browse all ${documentCount.toLocaleString()} sources` : "Browse all sources"
            }
          />
        </div>
      ) : (
        <>
          {showResultsControls && !showFilterControl ? browseLibraryControl : null}
          {/* With the panel closed the active filters are otherwise invisible
              apart from the trigger's badge, so the reader needs the count to
              explain why the list is shorter than the ribbon's total. */}
          {activeFilterCount > 0 && !filterPanelOpen ? (
            <div className={cn(metadataPillDensity.roomyCompact, "w-fit max-w-full")}>
              {sortedMatches.length} result{sortedMatches.length === 1 ? "" : "s"} after filters
            </div>
          ) : null}
          <div className="grid gap-3 sm:gap-4">
            <div className="min-w-0 space-y-2.5 sm:space-y-3">
              <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
                {renderedMatches.map((document, index) => {
                  // The verdict in words, never a percentage (#1M22X5): the
                  // number was a per-verdict constant that measured nothing.
                  const relevanceLabel = documentRelevanceLabel(document);
                  // One accent per card. `high` is accent TEXT on the raised
                  // surface (no fill), so a top hit showing both "Best match"
                  // and "Strong match" still has a single filled accent.
                  const relevanceVariant = relevanceLabel === "Strong match" ? "high" : "neutral";
                  // Owner decision 11 (2026-09-25): "Best match" is a quality
                  // claim, so the first card earns it only on a strong or
                  // partial verdict. Otherwise it is just the first result.
                  const topBadgeLabel =
                    relevanceLabel === "Strong match" || relevanceLabel === "Partial match"
                      ? "Best match"
                      : "Top result";
                  const openHref = documentOpenHref(document);
                  return (
                    <article
                      key={document.document_id}
                      data-testid="document-result-card"
                      className={cn(
                        sourceCard,
                        "content-auto",
                        "relative overflow-visible p-0 shadow-[var(--e1)] transition hover:border-[color:var(--clinical-accent-border)] hover:shadow-[var(--shadow-hover)] motion-reduce:transition-none",
                      )}
                    >
                      <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-3 p-3 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-4 sm:p-4">
                        <DocumentPagePreview document={document} href={openHref} />
                        <div className="min-w-0">
                          <h3 className="flex min-w-0 items-start gap-2">
                            <span
                              data-testid="document-result-rank"
                              // An ordinal, not a status. The list order already
                              // says which result is first, and a filled accent
                              // chip competed with the title beside it for the
                              // one accent this card is allowed to spend.
                              className="nums mt-2.5 grid h-7 min-w-7 shrink-0 place-items-center rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface-subtle)] px-1.5 text-2xs font-semibold text-[color:var(--text-muted)]"
                              aria-hidden="true"
                            >
                              {index + 1}
                            </span>
                            <Link
                              href={openHref}
                              className={cn(
                                "inline-flex min-h-12 min-w-0 items-center rounded-md text-base font-semibold leading-snug text-[color:var(--text-heading)] transition hover:text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:text-lg sm:leading-6",
                                // The whole card opens the document. The title
                                // carries it because its text names the result.
                                stretchedRowLinkClass,
                              )}
                            >
                              <span className="sr-only">Result {index + 1}: </span>
                              <span className="line-clamp-2">{documentDisplayTitle(document)}</span>
                            </Link>
                          </h3>
                          <div className="mt-2 flex flex-wrap gap-1.5 sm:mt-2.5">
                            {index === 0 ? (
                              // The top hit used to carry BOTH this chip and a 2px
                              // saturated rail across the card's top edge — two accent
                              // treatments on one card, which is exactly what the
                              // "one accent per card" note above exists to prevent, and
                              // the loudest block of colour in the results list. The rail
                              // is gone; the chip says the same thing in the badge
                              // language every other marker on this card already uses,
                              // and takes an icon so it still reads at a glance.
                              <DocumentBadge
                                variant="best"
                                icon={Sparkles}
                                className="min-h-7 rounded-lg px-2.5 text-2xs"
                              >
                                {topBadgeLabel}
                              </DocumentBadge>
                            ) : null}
                            <DocumentBadge
                              variant={relevanceVariant}
                              icon={Target}
                              className="min-h-7 rounded-lg px-2.5 text-2xs"
                            >
                              {relevanceLabel}
                            </DocumentBadge>
                            <DocumentBadge
                              variant="neutral"
                              icon={BookOpen}
                              className="min-h-7 rounded-lg px-2.5 text-2xs"
                            >
                              {documentPageLabel(document)}
                            </DocumentBadge>
                            {document.tableCount > 0 ? (
                              <DocumentBadge
                                variant="neutral"
                                icon={ListChecks}
                                className="min-h-7 rounded-lg px-2.5 text-2xs"
                              >
                                {document.tableCount} table{document.tableCount === 1 ? "" : "s"}
                              </DocumentBadge>
                            ) : null}
                            {document.imageCount > 0 ? (
                              <DocumentBadge
                                variant="neutral"
                                icon={FileImage}
                                className="min-h-7 rounded-lg px-2.5 text-2xs"
                              >
                                {document.imageCount} image{document.imageCount === 1 ? "" : "s"}
                              </DocumentBadge>
                            ) : null}
                          </div>
                          <DocumentTagCloud
                            labels={document.labels}
                            query={query}
                            limit={2}
                            compact
                            className="relative z-10 mt-2.5"
                            onTagClick={onTagSearch}
                          />
                        </div>
                      </div>
                      <div
                        data-testid="document-result-actions"
                        className="relative z-10 grid grid-cols-3 items-stretch divide-x divide-[color:var(--border)] rounded-b-xl border-t border-[color:var(--border)] bg-[color:var(--surface)]"
                      >
                        <DocumentActionLink
                          href={openHref}
                          icon={FileText}
                          className="min-h-12 min-w-0 rounded-bl-xl bg-[color:var(--clinical-accent-soft)] px-2 !text-sm !font-semibold text-[color:var(--clinical-accent)] hover:bg-[color:var(--clinical-accent-border)]"
                          aria-label={`Open ${document.title}`}
                        >
                          Open
                        </DocumentActionLink>
                        <DocumentActionButton
                          onClick={() => onAnswerFromDocument(document.document_id)}
                          icon={MessageSquareText}
                          className="min-h-12 min-w-0 px-2 !text-sm !font-semibold text-[color:var(--text)]"
                          aria-label={`Ask about ${document.title}`}
                        >
                          Ask
                        </DocumentActionButton>
                        <DocumentResultMoreMenu
                          document={document}
                          openHref={openHref}
                          onScopeDocument={() => onScopeDocument(document.document_id)}
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
              {hasMoreMatches ? (
                <button
                  type="button"
                  className={cn(
                    floatingControl,
                    "min-h-tap w-full justify-center rounded-xl px-4 text-sm font-semibold",
                  )}
                  onClick={() =>
                    setVisibleCountState((current) => ({
                      signature: resultsSignature,
                      count: Math.min(current.count + DOCUMENT_RESULTS_PAGE_SIZE, sortedMatches.length),
                    }))
                  }
                  data-testid="document-search-show-more"
                >
                  Show more ({sortedMatches.length - visibleCount} remaining)
                </button>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Memoized so this panel (and its result list) stops re-rendering on unrelated
// dashboard state changes. It still receives the live `query` prop for its
// header, so keystrokes in documents mode re-render it, but the expensive
// `matches` list only changes on submit; every other parent render is now
// suppressed once the parent's callbacks are stabilized.
export const DocumentSearchResultsPanel = memo(DocumentSearchResultsPanelImpl);
