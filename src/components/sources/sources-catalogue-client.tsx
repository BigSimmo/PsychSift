"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useId, useState } from "react";

import {
  ResultFilterSheet,
  ResultFilterTrigger,
  resultFilterFacetGroup,
  resultFilterGroup,
} from "@/components/clinical-dashboard/result-filter-control";
import { SearchResultsLayout } from "@/components/clinical-dashboard/search-results-layout";
import { UniversalSearchAlsoMatches } from "@/components/clinical-dashboard/universal-search-also-matches";
import {
  SearchResultsEmptyState,
  SearchResultsHeaderBand,
  type AppliedFilterChip,
} from "@/components/clinical-dashboard/search-results-header-band";
import { Chip } from "@/components/ui/chip";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/components/ui-primitives";
import { appModeDefinition, appModeHomeHref, type AppModeId } from "@/lib/app-modes";
import type {
  ClinicalSourceClientEntry,
  SourceCatalogueFilters,
  SourceDateLabel,
  SourceQualityBand,
} from "@/lib/sources/catalogue-types";
import {
  formatCatalogueMonth,
  type SourceCatalogueFacetCounts,
  type SourceCatalogueFacetKey,
} from "@/lib/sources/catalogue-view";
import { SOURCE_BAND_LABELS, SOURCE_BAND_TONES } from "@/lib/sources/rating-method";
import { sourceAttentionFlags } from "@/lib/sources/source-status-presentation";
import { groupSourceUsagesByMode } from "@/lib/sources/source-usage-presentation";

/**
 * The clinical source catalogue.
 *
 * The page used to open with a title, a paragraph, four count tiles and a panel
 * of nine native `<select>`s before the first source appeared. None of that is
 * what the page is for. The filters now live where every other mode keeps them —
 * behind the ribbon's badged trigger — and the reader lands directly on the
 * sources, each one leading with the only signal that decides whether to open it:
 * its quality band, then where in PsychSift it is actually used.
 *
 * Filter dimensions are deliberately four, not nine. Band, jurisdiction, topic
 * and application usage are the questions a clinician asks of a source list;
 * validation state, content mode and lifecycle are governance bookkeeping and
 * belong on the record, not in the narrowing control. Their URL parameters still
 * parse, so a deep link from Publishers or a saved catalogue link keeps working
 * and shows up as a removable applied chip.
 *
 * `entries` is the current page's slice only — 50 sources, cut server-side by
 * `SourcesCatalogueContent` before anything crosses the RSC boundary. The
 * filters, the facet option counts and the total match count are computed there
 * too, against the whole catalogue, so narrowing still searches all 866 sources
 * while the browser only ever receives the page it is showing.
 */

const jurisdictionLabels: Record<string, string> = {
  wa: "Western Australia",
  australian_national: "Australian national",
  australian_state: "Another Australian state",
  international: "International",
  unknown: "Unknown jurisdiction",
};

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function jurisdictionLabel(scope: string) {
  return jurisdictionLabels[scope] ?? titleCase(scope);
}

function modeLabel(modeId: AppModeId) {
  return appModeDefinition(modeId).label;
}

/**
 * The most recent date the entry can stand behind.
 *
 * Expiry is not a candidate: a source that expires in 2027 is not thereby
 * current, and reading a future expiry as recency is the inference the Method
 * page forbids. Absent dates return null and the tile says nothing rather than
 * inventing a currency claim.
 *
 * The comparison still uses `Date.parse`, which reads a bare `YYYY-MM-DD` as UTC
 * midnight — every candidate shifts by the same amount, so the ordering is
 * unaffected. Rendering is not: `formatCatalogueMonth` parses the winner as a
 * local calendar date, because a UTC instant formatted west of UTC shows the
 * previous month.
 *
 * Candidates are listed strongest claim first and the sort is stable, so a tie
 * goes to "reviewed", then "published", and a publisher's update stamp — which
 * asserts neither — is named "last updated" and never borrows either label.
 */
function latestKnownDate(entry: ClinicalSourceClientEntry) {
  const candidates: { value: string | null | undefined; label: SourceDateLabel }[] = [
    { value: entry.reviewDate, label: "reviewed" },
    { value: entry.publicationDate, label: "published" },
    { value: entry.lastUpdatedDate, label: "last updated" },
  ];
  const parsed = candidates
    .filter((candidate): candidate is { value: string; label: SourceDateLabel } => Boolean(candidate.value))
    .map((candidate) => ({ ...candidate, time: Date.parse(candidate.value) }))
    .filter((candidate) => !Number.isNaN(candidate.time))
    .sort((left, right) => right.time - left.time);
  const text = formatCatalogueMonth(parsed[0]?.value ?? null);
  if (!parsed[0] || !text) return null;
  return { label: parsed[0].label, text };
}

function SourceTile({ entry }: { entry: ClinicalSourceClientEntry }) {
  const flags = sourceAttentionFlags(entry);
  const usageGroups = groupSourceUsagesByMode(entry.usedBy);
  const recordTotal = usageGroups.reduce((total, group) => total + group.recordCount, 0);
  // "Used in Dictionary" says a mode cites this; it does not say whether one
  // record leans on it or forty. The record count is what tells a reader how
  // much of the app moves if this source turns out to be wrong.
  const usageSummary = usageGroups.length
    ? `Used in ${usageGroups.map((group) => group.modeLabel).join(", ")} · ${recordTotal} ${recordTotal === 1 ? "record" : "records"}`
    : "Not used by any record yet";
  const currency = latestKnownDate(entry);

  return (
    <Link
      href={`/sources/${entry.id}`}
      aria-label={`View source details: ${entry.title}`}
      className={cn(
        // A row of the one catalogue card, not a card of its own: the list
        // draws the box and a hairline divides each source from the next.
        "group grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-3.5 transition-colors",
        "hover:bg-[color:var(--surface-subtle)] motion-reduce:transition-none",
        "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus)]",
      )}
    >
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5">
          {/* Colour only where a row differs (Clinical audit, 13 Oct 2026, item 8):
              A, B and C are quiet grey text with the grade letter, so the green
              pill no longer repeats on almost every row. D and Excluded keep
              their coloured tag because they are the exception. */}
          {entry.rating.band === "D" || entry.rating.band === "excluded" ? (
            <Chip size="compact" appearance={{ kind: "status", tone: SOURCE_BAND_TONES[entry.rating.band] }} dot>
              {SOURCE_BAND_LABELS[entry.rating.band]}
            </Chip>
          ) : (
            <span data-source-band={entry.rating.band} className="text-xs font-semibold text-[color:var(--text-muted)]">
              {SOURCE_BAND_LABELS[entry.rating.band]}
            </span>
          )}
          {flags.map((flag) => (
            <Chip key={flag.label} size="compact" appearance={{ kind: "status", tone: flag.tone }}>
              {flag.label}
            </Chip>
          ))}
        </span>
        <span className="mt-2 block text-sm-minus font-extrabold leading-5 text-[color:var(--text-heading)]">
          {entry.title}
        </span>
        <span className="mt-1 block truncate text-2xs font-semibold leading-4 text-[color:var(--text-muted)]">
          {entry.publisher ?? "Publisher unknown"} · {entry.geography.label} · {titleCase(entry.sourceType)}
        </span>
        <span className="mt-2 block text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
          {usageSummary}
          {/* Currency, on the card rather than one navigation away. Whether a
              guideline was reviewed last year or in 2016 changes whether you
              open it, and the band letter alone does not say. */}
          {currency ? ` · ${currency.label} ${currency.text}` : null}
        </span>
      </span>
      <ArrowRight
        className={cn(
          "size-icon-md shrink-0 self-center text-[color:var(--decoration-soft)] transition",
          "group-hover:translate-x-0.5 group-hover:text-[color:var(--clinical-accent)]",
          "motion-reduce:transition-none motion-reduce:group-hover:translate-x-0",
        )}
        aria-hidden="true"
      />
    </Link>
  );
}

/** Every filter group that can be active, including the ones only a deep link sets. */
const chipGroups = [
  {
    key: "band",
    label: "Quality band",
    field: "bands",
    format: (value: string) => SOURCE_BAND_LABELS[value as SourceQualityBand],
  },
  { key: "jurisdiction", label: "Jurisdiction", field: "jurisdictions", format: jurisdictionLabel },
  { key: "topic", label: "Topic", field: "topics", format: titleCase },
  { key: "usedBy", label: "Used in", field: "usedBy", format: (value: string) => modeLabel(value as AppModeId) },
  { key: "type", label: "Source type", field: "sourceTypes", format: titleCase },
  { key: "publisher", label: "Publisher", field: "publishers", format: (value: string) => value },
  { key: "lifecycle", label: "Lifecycle", field: "lifecycleStatuses", format: titleCase },
  { key: "status", label: "Currency", field: "documentStatuses", format: titleCase },
  { key: "validation", label: "Validation", field: "validationStatuses", format: titleCase },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  field: keyof SourceCatalogueFilters;
  format: (value: string) => string;
}>;

export function SourcesCatalogueClient({
  entries,
  hostedDocuments,
  filters,
  facetCounts,
  totalMatches,
  page,
  pageCount,
  startIndex,
}: {
  /** The current page's slice, already filtered and sorted on the server. */
  entries: readonly ClinicalSourceClientEntry[];
  hostedDocuments: "available" | "unavailable";
  filters: SourceCatalogueFilters;
  facetCounts: SourceCatalogueFacetCounts;
  totalMatches: number;
  page: number;
  pageCount: number;
  startIndex: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const filterPanelId = useId();
  const [filterOpen, setFilterOpen] = useState(false);

  // Narrowing resets the page. Page 12 of a 2-page result is the state a saved
  // link, a removed chip or a widened facet would otherwise leave behind, and it
  // reads as an empty catalogue rather than as a stale page number.
  const setParamValues = (key: string, values: readonly string[]) => {
    const next = new URLSearchParams();
    for (const [candidateKey, candidateValue] of searchParams.entries()) {
      if (candidateKey !== key && candidateKey !== "page") next.append(candidateKey, candidateValue);
    }
    for (const value of values) next.append(key, value);
    const suffix = next.toString();
    router.replace(`${pathname}${suffix ? `?${suffix}` : ""}`, { scroll: false });
  };

  const goToPage = (next: number) => {
    const params = new URLSearchParams();
    for (const [candidateKey, candidateValue] of searchParams.entries()) {
      if (candidateKey !== "page") params.append(candidateKey, candidateValue);
    }
    if (next > 1) params.append("page", String(next));
    const suffix = params.toString();
    // `push`, not `replace`: a page move is navigation, and Back has to return
    // the reader to the page they came from.
    router.push(`${pathname}${suffix ? `?${suffix}` : ""}`);
  };

  const selectedValues = (key: SourceCatalogueFacetKey): readonly string[] => {
    if (key === "band") return filters.bands;
    if (key === "jurisdiction") return filters.jurisdictions;
    if (key === "topic") return filters.topics;
    return filters.usedBy;
  };

  const toggleFacet = (key: SourceCatalogueFacetKey, value: string) => {
    const current = selectedValues(key);
    setParamValues(key, current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };

  const removeFilterValue = (key: string, value: string) => {
    const current = searchParams
      .getAll(key)
      .flatMap((entry) => entry.split(","))
      .map((entry) => entry.trim())
      .filter((entry) => entry && entry !== value);
    setParamValues(key, current);
  };

  /**
   * The option list and its union-widening counts, both derived server-side over
   * the whole catalogue. This used to re-filter all 866 entries once per option
   * per render in the browser.
   */
  const facetOptions = (key: SourceCatalogueFacetKey, format: (value: string) => string) =>
    facetCounts[key].map(({ value, count }) => ({
      value,
      label: format(value),
      hint: `${count} ${count === 1 ? "source" : "sources"}`,
      hintLabel: String(count),
      disabled: count === 0 && !selectedValues(key).includes(value),
    }));

  const bandGroup = resultFilterFacetGroup({
    id: "source-band",
    label: "Quality band",
    description: "Organisational review rating. It is not a clinical endorsement.",
    selected: new Set(filters.bands),
    options: facetOptions("band", (value) => SOURCE_BAND_LABELS[value as SourceQualityBand] ?? titleCase(value)),
    onToggle: (value) => toggleFacet("band", value),
  });
  const jurisdictionGroup = resultFilterFacetGroup({
    id: "source-jurisdiction",
    label: "Jurisdiction",
    selected: new Set(filters.jurisdictions),
    options: facetOptions("jurisdiction", jurisdictionLabel),
    onToggle: (value) => toggleFacet("jurisdiction", value),
  });
  const topicGroup = resultFilterFacetGroup({
    id: "source-topic",
    label: "Topic",
    selected: new Set(filters.topics),
    options: facetOptions("topic", titleCase),
    onToggle: (value) => toggleFacet("topic", value),
  });
  const usedByGroup = resultFilterFacetGroup({
    id: "source-used-by",
    label: "Used in",
    description: "The part of PsychSift whose records cite the source.",
    selected: new Set(filters.usedBy),
    options: facetOptions("usedBy", (value) => modeLabel(value as AppModeId)),
    onToggle: (value) => toggleFacet("usedBy", value),
  });
  const sortGroup = resultFilterGroup({
    id: "source-order",
    label: "Order",
    note: "one only",
    value: filters.sort,
    options: [
      { value: "quality", label: "Quality band" },
      { value: "title", label: "Title" },
      { value: "currency", label: "Most recently current" },
    ],
    onChange: (value) => setParamValues("sort", value === "quality" ? [] : [value]),
  });

  const appliedFilters: AppliedFilterChip[] = chipGroups.flatMap((group) => {
    const values = filters[group.field];
    if (!Array.isArray(values)) return [];
    return values.map((value: string) => ({
      id: `${group.key}-${value}`,
      groupLabel: group.label,
      valueLabel: group.format(value),
      onRemove: () => removeFilterValue(group.key, value),
    }));
  });

  const activeFilterCount = appliedFilters.length;

  // Drops the query and keeps every filter — the mirror of `clearFilters`, which
  // keeps the query. The empty state offers both as separate controls, so a
  // "Clear search" that also silently wiped band, jurisdiction and usage would make
  // one of those controls a lie. It used to `router.push(appModeHomeHref("sources"))`,
  // which left the catalogue entirely and dropped every filter with it — the same
  // reasoning already applied to the Topics and Publishers browse view.
  const clearQuery = () => {
    const next = new URLSearchParams();
    for (const [candidateKey, candidateValue] of searchParams.entries()) {
      if (candidateKey !== "q" && candidateKey !== "page") next.append(candidateKey, candidateValue);
    }
    const suffix = next.toString();
    router.push(`${pathname}${suffix ? `?${suffix}` : ""}`);
  };

  const clearFilters = () => {
    const next = new URLSearchParams();
    const query = searchParams.get("q");
    if (query) next.set("q", query);
    const suffix = next.toString();
    router.replace(`${pathname}${suffix ? `?${suffix}` : ""}`, { scroll: false });
  };

  const filterTrigger = (testId: string) => (
    <ResultFilterTrigger
      panelId={filterPanelId}
      testId={testId}
      title="Filter sources"
      open={filterOpen}
      activeCount={activeFilterCount}
      onToggle={() => setFilterOpen((current) => !current)}
    />
  );

  return (
    <SearchResultsLayout
      testId="sources-catalogue-main"
      resultsLabel="Source results"
      footer={<UniversalSearchAlsoMatches modeId="sources" query={filters.q ?? ""} />}
      header={
        <>
          {/* The band's own heading is the query, which a browse visit does not
              have. The page still needs a name in the outline. */}
          <h1 className="sr-only">Source catalogue</h1>
          <SearchResultsHeaderBand
            modeId="sources"
            query={filters.q}
            matchCount={totalMatches}
            status="ready"
            resultNoun={totalMatches === 1 ? "source" : "sources"}
            hideEmptyQuery
            emptyQueryLabel="Source catalogue"
            filterLabel="Filter sources"
            appliedFilters={appliedFilters}
            onClearFilters={activeFilterCount > 0 ? clearFilters : undefined}
            mobileControlsPlacement="inline"
            mobileControls={filterTrigger("sources-filter-trigger-phone")}
            utilityControls={
              <span className="hidden items-center gap-2 sm:inline-flex">
                {filterTrigger("sources-filter-trigger-desktop")}
              </span>
            }
          />
          <ResultFilterSheet
            open={filterOpen}
            onClose={() => setFilterOpen(false)}
            panelId={filterPanelId}
            testId="sources-filter-sheet"
            title="Filter sources"
            description="Narrow the catalogue by rating, jurisdiction, topic, or the part of PsychSift that uses the source."
            groups={[bandGroup, jurisdictionGroup, topicGroup, usedByGroup, sortGroup]}
            onClearAll={activeFilterCount > 0 ? clearFilters : undefined}
            summary={{ count: totalMatches, noun: totalMatches === 1 ? "source" : "sources" }}
            chromeResetKey={filters.q}
          />
          {/* One quiet line, not the bordered banner this replaced. The count
              above it is wrong while the hosted-document loader is unreachable,
              and a count a reader cannot tell is partial is worse than no count. */}
          {hostedDocuments === "unavailable" ? (
            <p
              role="note"
              data-testid="sources-partial-catalogue-note"
              className="pt-2 text-2xs font-semibold text-[color:var(--warning-text,var(--text-muted))]"
            >
              Uploaded document sources cannot be reached, so this list and its count are incomplete.
            </p>
          ) : null}
        </>
      }
    >
      {entries.length ? (
        <>
          {/* One hairline card for the page of sources, rows divided by a
              hairline. One column at every width: two columns of rows inside
              one card read as a table with no header. */}
          <ul className="divide-y divide-[color:var(--border)] overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]">
            {entries.map((entry) => (
              <li key={entry.id}>
                <SourceTile entry={entry} />
              </li>
            ))}
          </ul>
          <Pagination
            className="pt-4"
            page={page}
            pageCount={pageCount}
            onPageChange={goToPage}
            label="Source catalogue pages"
            summary={`${startIndex + 1}\u2013${startIndex + entries.length} of ${totalMatches} ${
              totalMatches === 1 ? "source" : "sources"
            }`}
          />
        </>
      ) : (
        <SearchResultsEmptyState
          modeId="sources"
          query={filters.q}
          appliedFilters={appliedFilters}
          onClearFilters={activeFilterCount > 0 ? clearFilters : undefined}
          onClearSearch={filters.q ? clearQuery : undefined}
          onTryExample={(example) => router.push(appModeHomeHref("sources", { query: example, run: true }))}
        />
      )}
    </SearchResultsLayout>
  );
}
