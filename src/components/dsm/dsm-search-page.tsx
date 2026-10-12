"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { BookOpenCheck, Check, ChevronDown, ChevronRight, CircleAlert, GitCompareArrows, SearchX } from "lucide-react";

import {
  SearchResultsHeaderBand,
  type AppliedFilterChip,
} from "@/components/clinical-dashboard/search-results-header-band";
import {
  ResultFilterSheet,
  ResultFilterTrigger,
  resultFilterFacetGroup,
} from "@/components/clinical-dashboard/result-filter-control";
import { UniversalSearchAlsoMatches } from "@/components/clinical-dashboard/universal-search-also-matches";
import { cardPadding, cardSurface, focusRing, stretchedRowLinkClass } from "@/components/card-recipes";
import { SharedCompareTray } from "@/components/compare/shared-compare-tray";
import { cn, codeText, EmptyState, metadataPill, pageContainer } from "@/components/ui-primitives";
import type { DsmCategory, DsmDiagnosisSummary } from "@/lib/dsm";
import { readResultFilterValues, replaceResultFilterUrl, writeResultFilterValues } from "@/lib/result-filter-url";
import {
  FilterHighlightNote,
  FilterNotMatchingHeading,
  filterOutsideTitleClass,
} from "@/components/clinical-dashboard/filter-highlight";

/** cardSelected encoding with clinical accent — DSM forbids per-category colour tokens. */
const dsmCardSelected =
  "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] shadow-[var(--e2)]";

/**
 * Browse order with nothing typed: A to Z by title, with the generic template
 * entries ("[Substance] intoxication / withdrawal …") after the named
 * diagnoses. Display-only — query-ranked results never pass through here.
 */
export function compareDsmBrowseTitles(left: { title: string }, right: { title: string }) {
  const leftTemplate = left.title.trimStart().startsWith("[");
  const rightTemplate = right.title.trimStart().startsWith("[");
  if (leftTemplate !== rightTemplate) return leftTemplate ? 1 : -1;
  return left.title.localeCompare(right.title, "en", { sensitivity: "base" });
}

/**
 * Groups browse rows by DSM chapter, in the order the catalogue lists its
 * chapters, rows A to Z inside each. Chapters with no rows are left out.
 */
export function groupDsmBrowseByChapter(
  categories: readonly DsmCategory[],
  results: readonly DsmDiagnosisSummary[],
): Array<{ key: string; label: string; items: DsmDiagnosisSummary[] }> {
  const byKey = new Map<string, DsmDiagnosisSummary[]>();
  for (const result of results) {
    const bucket = byKey.get(result.category.key);
    if (bucket) bucket.push(result);
    else byKey.set(result.category.key, [result]);
  }
  const groups: Array<{ key: string; label: string; items: DsmDiagnosisSummary[] }> = [];
  const seen = new Set<string>();
  for (const category of categories) {
    const items = byKey.get(category.key);
    if (!items?.length) continue;
    seen.add(category.key);
    groups.push({ key: category.key, label: category.label, items: [...items].sort(compareDsmBrowseTitles) });
  }
  // A record whose chapter is missing from the category list still has to show.
  for (const [key, items] of byKey) {
    if (seen.has(key)) continue;
    groups.push({ key, label: items[0]?.category.label ?? key, items: [...items].sort(compareDsmBrowseTitles) });
  }
  return groups;
}

function compareHref(slugs: string[]) {
  const params = new URLSearchParams({ ids: slugs.join(",") });
  return `/dsm/compare?${params.toString()}`;
}

function DsmSearchResultCard({
  result,
  isSelected,
  onToggle,
  compact = false,
  outsideFilter = false,
}: {
  result: DsmDiagnosisSummary;
  isSelected: boolean;
  onToggle: () => void;
  /** Outside the active filter: still listed and tappable, title muted by token. */
  outsideFilter?: boolean;
  /** Browse rows: one line on a phone (title and ICD code); summary and chapter return at `sm`. */
  compact?: boolean;
}) {
  return (
    <article
      data-testid="dsm-search-result"
      data-outside-filter={outsideFilter ? "true" : undefined}
      className={cn(
        cardSurface,
        cardPadding.compact,
        "relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2.5 overflow-hidden transition motion-reduce:transition-none sm:items-start",
        "hover:border-[color:var(--clinical-accent-border)] hover:shadow-[var(--e2)]",
        isSelected && dsmCardSelected,
      )}
    >
      {isSelected ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-[color:var(--clinical-accent)]"
        />
      ) : null}
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={isSelected}
        aria-label={`${isSelected ? "Remove" : "Add"} ${result.title} ${isSelected ? "from" : "to"} comparison`}
        className={cn(
          "relative z-10 grid h-12 w-12 shrink-0 place-items-center rounded-lg border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
          isSelected
            ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
            : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--decoration-soft)] hover:border-[color:var(--clinical-accent)]",
        )}
      >
        {isSelected ? <Check className="h-4 w-4" aria-hidden /> : <GitCompareArrows className="h-4 w-4" aria-hidden />}
      </button>
      <Link
        href={`/dsm/diagnoses/${result.slug}`}
        aria-label={`Open ${result.title}`}
        className={cn("group min-w-0 rounded-md", focusRing, stretchedRowLinkClass)}
      >
        {compact ? (
          <div className="flex min-h-12 min-w-0 items-center gap-2 sm:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <h3
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm font-extrabold leading-5 group-hover:text-[color:var(--clinical-accent)] sm:whitespace-normal sm:text-base-minus",
                    outsideFilter ? filterOutsideTitleClass : "text-[color:var(--text-heading)]",
                  )}
                >
                  {result.title}
                </h3>
                <span className={cn(metadataPill, codeText, "shrink-0")}>{result.icd_code}</span>
              </div>
              <p className="mt-1.5 hidden text-xs font-medium leading-5 text-[color:var(--text-muted)] sm:line-clamp-2">
                {result.summary}
              </p>
              <div className="mt-2 hidden flex-wrap gap-2 sm:flex">
                <span className={metadataPill}>{result.category.label}</span>
              </div>
            </div>
            <ChevronRight
              className="h-5 w-5 shrink-0 text-[color:var(--decoration-soft)] transition group-hover:translate-x-0.5 group-hover:text-[color:var(--clinical-accent)] motion-reduce:transform-none sm:mt-0.5"
              aria-hidden
            />
          </div>
        ) : (
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">
              <h3
                className={cn(
                  "text-sm font-extrabold leading-5 group-hover:text-[color:var(--clinical-accent)] sm:text-base-minus",
                  outsideFilter ? filterOutsideTitleClass : "text-[color:var(--text-heading)]",
                )}
              >
                {result.title}
              </h3>
              <p className="mt-1.5 line-clamp-2 text-xs font-medium leading-5 text-[color:var(--text-muted)]">
                {result.summary}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className={metadataPill}>{result.category.label}</span>
                <span className={cn(metadataPill, codeText)}>{result.icd_code}</span>
              </div>
            </div>
            <ChevronRight
              className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--decoration-soft)] transition group-hover:translate-x-0.5 group-hover:text-[color:var(--clinical-accent)] motion-reduce:transform-none"
              aria-hidden
            />
          </div>
        )}
      </Link>
    </article>
  );
}

export function DsmSearchPage({
  query,
  categories,
  results: queryResults,
  initialIds = [],
}: {
  query: string;
  categories: DsmCategory[];
  results: DsmDiagnosisSummary[];
  initialIds?: string[];
  /** Retained for older server/test callers; filtering now uses the query-matched summaries. */
  totalCount?: number;
}) {
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<string[]>(initialIds.slice(0, 3));
  const [filterOpen, setFilterOpen] = useState(false);
  const filterPanelId = useId();
  const categoryKeys = useMemo(() => new Set(categories.map((item) => item.key)), [categories]);
  const selectedCategories = new Set(readResultFilterValues(searchParams, "category", categoryKeys));
  const supportValues = new Set(["specifiers", "differentials"] as const);
  const selectedSupport = new Set(readResultFilterValues(searchParams, "support", supportValues));
  const filterDiagnoses = (
    categorySelection: ReadonlySet<string>,
    supportSelection: ReadonlySet<"specifiers" | "differentials">,
  ) =>
    queryResults.filter((result) => {
      if (categorySelection.size > 0 && !categorySelection.has(result.category.key)) return false;
      if (supportSelection.has("specifiers") && result.specifierCount === 0) return false;
      if (supportSelection.has("differentials") && result.differentialCount === 0) return false;
      return true;
    });
  const results = filterDiagnoses(selectedCategories, selectedSupport);
  // Filters highlight, never hide: the filtered diagnoses come first and every
  // other query-matched diagnosis stays listed after them under "Not matching".
  const highlightFilterActive = selectedCategories.size + selectedSupport.size > 0;
  const resultSlugs = new Set(results.map((result) => result.slug));
  const outsideResults = highlightFilterActive ? queryResults.filter((result) => !resultSlugs.has(result.slug)) : [];
  // Browsing reads A to Z, like the chapters; a search keeps its ranked order.
  if (highlightFilterActive && query.trim().length === 0) outsideResults.sort(compareDsmBrowseTitles);
  // Nothing typed: this is the whole catalogue, not a search, so it reads as the
  // chapter list a psychiatrist looks things up by rather than a ranked list.
  const browsing = query.trim().length === 0;
  const browseGroups = browsing ? groupDsmBrowseByChapter(categories, results) : [];
  // Chapters start closed so the phone opens on a chapter index; a chapter filter
  // (or a list that is only one chapter) opens them.
  const openChapters = selectedCategories.size > 0 || browseGroups.length === 1;
  const activeFilterCount = selectedCategories.size + selectedSupport.size;
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggleCategory(value: string) {
    replaceResultFilterUrl((params) => {
      const current = new Set(readResultFilterValues(params, "category", categoryKeys));
      if (!current.delete(value)) current.add(value);
      writeResultFilterValues(params, "category", current, categoryKeys);
    });
  }

  function toggleSupport(value: "specifiers" | "differentials") {
    replaceResultFilterUrl((params) => {
      const current = new Set(readResultFilterValues(params, "support", supportValues));
      if (!current.delete(value)) current.add(value);
      writeResultFilterValues(params, "support", current, supportValues);
    });
  }

  function clearFilters() {
    replaceResultFilterUrl((params) => {
      params.delete("category");
      params.delete("support");
    });
  }

  const appliedFilters: AppliedFilterChip[] = [
    ...[...selectedCategories].map((key) => ({
      id: `category-${key}`,
      groupLabel: "Category",
      valueLabel: categories.find((item) => item.key === key)?.label ?? key,
      onRemove: () => toggleCategory(key),
    })),
    ...[...selectedSupport].map((support) => ({
      id: `support-${support}`,
      groupLabel: "Support",
      valueLabel: support === "specifiers" ? "Has specifiers" : "Has differential guidance",
      onRemove: () => toggleSupport(support),
    })),
  ];

  const filterGroups = [
    resultFilterFacetGroup({
      id: "category",
      label: "Category",
      description: "Select one or more query-matched diagnostic categories.",
      selected: selectedCategories,
      options: categories.map((category) => {
        const next = new Set(selectedCategories);
        if (!next.has(category.key)) next.add(category.key);
        const count = filterDiagnoses(next, selectedSupport).length;
        return {
          value: category.key,
          label: category.label,
          hint: String(count),
          disabled: count === 0 && !selectedCategories.has(category.key),
        };
      }),
      onToggle: toggleCategory,
    }),
    resultFilterFacetGroup({
      id: "has-specifiers",
      label: "Specifier support",
      selected: new Set(selectedSupport.has("specifiers") ? ["specifiers"] : []),
      options: [
        {
          value: "specifiers",
          label: "Has specifiers",
          hint: String(filterDiagnoses(selectedCategories, new Set([...selectedSupport, "specifiers"])).length),
        },
      ],
      onToggle: () => toggleSupport("specifiers"),
    }),
    resultFilterFacetGroup({
      id: "has-differentials",
      label: "Differential guidance",
      selected: new Set(selectedSupport.has("differentials") ? ["differentials"] : []),
      options: [
        {
          value: "differentials",
          label: "Has differential guidance",
          hint: String(filterDiagnoses(selectedCategories, new Set([...selectedSupport, "differentials"])).length),
        },
      ],
      onToggle: () => toggleSupport("differentials"),
    }),
  ];

  function toggleDiagnosis(slug: string) {
    setSelected((current) => {
      if (current.includes(slug)) return current.filter((item) => item !== slug);
      if (current.length >= 3) return [...current.slice(1), slug];
      return [...current, slug];
    });
  }

  return (
    <div data-testid="dsm-search-page" className="min-h-full bg-[color:var(--background)]">
      <div className={cn(pageContainer, "space-y-4 px-4 py-4 sm:px-6 sm:py-6 lg:px-8")}>
        <SearchResultsHeaderBand
          modeId="dsm"
          query={query}
          emptyQuerySubject="DSM diagnoses"
          matchCount={queryResults.length}
          headingLevel={1}
          filterLabel="Filter diagnoses by category"
          appliedFilters={appliedFilters}
          onClearFilters={activeFilterCount > 0 ? clearFilters : undefined}
          mobileControlsPlacement="inline"
          mobileControls={
            <ResultFilterTrigger
              panelId={filterPanelId}
              testId="dsm-category-filter-phone"
              title="Filter DSM diagnoses"
              open={filterOpen}
              activeCount={activeFilterCount}
              onToggle={() => setFilterOpen((current) => !current)}
            />
          }
          filterControls={
            <ResultFilterTrigger
              panelId={filterPanelId}
              testId="dsm-category-filter-desktop"
              title="Filter DSM diagnoses"
              open={filterOpen}
              activeCount={activeFilterCount}
              onToggle={() => setFilterOpen((current) => !current)}
            />
          }
        />

        <ResultFilterSheet
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          panelId={filterPanelId}
          testId="dsm-category-filter-panel"
          title="Filter DSM diagnoses"
          description="Narrow the query-matched summary set without changing diagnosis or comparison content."
          groups={filterGroups}
          onClearAll={activeFilterCount > 0 ? clearFilters : undefined}
          summary={{ count: results.length, noun: results.length === 1 ? "diagnosis" : "diagnoses" }}
        />

        <FilterHighlightNote
          active={highlightFilterActive && queryResults.length > 0}
          highlighted={results.length}
          total={queryResults.length}
          onClear={clearFilters}
          testId="dsm-highlight-note"
        />

        {results.length || outsideResults.length ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
            <div className="grid min-w-0 gap-3">
              {browsing ? (
                <section aria-label="DSM diagnoses by chapter, A to Z" className="grid gap-3">
                  {browseGroups.map((group) => (
                    <details
                      // Re-mount when the chapter filter changes so a newly narrowed list opens.
                      key={`${group.key}:${openChapters ? "open" : "closed"}`}
                      open={openChapters || undefined}
                      data-testid="dsm-browse-chapter"
                      className="group/chapter grid gap-2"
                    >
                      <summary
                        className={cn(
                          cardSurface,
                          "flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 [&::-webkit-details-marker]:hidden",
                          focusRing,
                        )}
                      >
                        <h2 className="min-w-0 flex-1 truncate text-sm font-extrabold text-[color:var(--text-heading)]">
                          {group.label}
                        </h2>
                        <span className={cn(metadataPill, "shrink-0 tabular-nums")}>
                          {group.items.length}
                          <span className="sr-only">{group.items.length === 1 ? " diagnosis" : " diagnoses"}</span>
                        </span>
                        <ChevronDown
                          className="h-4 w-4 shrink-0 text-[color:var(--decoration-soft)] transition group-open/chapter:rotate-180 motion-reduce:transition-none"
                          aria-hidden
                        />
                      </summary>
                      <div className="mt-2 grid gap-2">
                        {group.items.map((result) => (
                          <DsmSearchResultCard
                            key={result.slug}
                            result={result}
                            compact
                            isSelected={selectedSet.has(result.slug)}
                            onToggle={() => toggleDiagnosis(result.slug)}
                          />
                        ))}
                      </div>
                    </details>
                  ))}
                  <p className="flex items-start gap-2 px-1 text-xs font-medium leading-5 text-[color:var(--text-muted)] lg:hidden">
                    <BookOpenCheck
                      className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]"
                      aria-hidden
                    />
                    Reference content only. Confirm criteria, exclusions, and clinical context before use.
                  </p>
                </section>
              ) : (
                <section aria-label="DSM diagnosis results" className="grid gap-3">
                  {results.map((result) => (
                    <DsmSearchResultCard
                      key={result.slug}
                      result={result}
                      isSelected={selectedSet.has(result.slug)}
                      onToggle={() => toggleDiagnosis(result.slug)}
                    />
                  ))}
                </section>
              )}

              {outsideResults.length > 0 ? (
                <section
                  data-testid="dsm-outside-filter"
                  aria-label="Diagnoses outside the filter"
                  className="grid gap-2"
                >
                  <FilterNotMatchingHeading
                    label="Not matching"
                    count={outsideResults.length}
                    level={2}
                    testId="dsm-outside-heading"
                  />
                  {outsideResults.map((result) => (
                    <DsmSearchResultCard
                      key={result.slug}
                      result={result}
                      compact={browsing}
                      outsideFilter
                      isSelected={selectedSet.has(result.slug)}
                      onToggle={() => toggleDiagnosis(result.slug)}
                    />
                  ))}
                </section>
              ) : null}
            </div>

            <aside className="hidden gap-3 lg:sticky lg:top-20 lg:grid" aria-label="Comparison selection">
              <section className={cn(cardSurface, "rounded-xl p-4")}>
                <div className="flex items-center gap-2">
                  <GitCompareArrows className="h-5 w-5 text-[color:var(--clinical-accent)]" aria-hidden />
                  <h2 className="text-sm font-extrabold text-[color:var(--text-heading)]">Compare diagnoses</h2>
                </div>
                <p className="mt-2 text-xs font-medium leading-5 text-[color:var(--text-muted)]">
                  Select two or three records. Selecting a fourth replaces the earliest selection.
                </p>
                {selected.length ? (
                  <ol className="mt-3 grid gap-2">
                    {selected.map((slug, index) => {
                      const item = queryResults.find((result) => result.slug === slug);
                      return (
                        <li
                          key={slug}
                          className="flex items-center gap-2 rounded-lg bg-[color:var(--surface-subtle)] px-2.5 py-2 text-xs font-bold text-[color:var(--text-heading)]"
                        >
                          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[color:var(--clinical-accent-soft)] text-2xs text-[color:var(--clinical-accent)]">
                            {index + 1}
                          </span>
                          <span className="min-w-0 truncate">{item?.title ?? slug}</span>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="mt-3 flex items-start gap-2 rounded-lg border border-dashed border-[color:var(--border-strong)] px-3 py-2.5 text-xs font-semibold leading-5 text-[color:var(--text-muted)]">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    Choose diagnoses from the result list.
                  </p>
                )}
                {/* Compare itself is the shared Compare tray at the foot of the window. */}
              </section>
              <p className="flex items-start gap-2 px-1 text-xs font-medium leading-5 text-[color:var(--text-muted)]">
                <BookOpenCheck className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
                Reference content only. Confirm criteria, exclusions, and clinical context before use.
              </p>
            </aside>
          </div>
        ) : (
          <EmptyState
            icon={SearchX}
            title="No diagnosis matches"
            headingLevel={2}
            body="Try a diagnosis name, ICD code, symptom phrase, or a broader category."
            live="polite"
            actions={
              <Link
                href="/dsm/search"
                className="inline-flex min-h-tap items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-3 text-sm font-bold text-[color:var(--clinical-accent)]"
              >
                Browse all diagnoses
              </Link>
            }
          />
        )}
        <UniversalSearchAlsoMatches modeId="dsm" query={query} />
      </div>

      <SharedCompareTray
        count={selected.length}
        names={selected.map((slug) => queryResults.find((result) => result.slug === slug)?.title ?? slug)}
        max={3}
        compareHref={compareHref(selected)}
        onClear={() => setSelected([])}
        noun="diagnoses"
        // DSM search has no dock addon slot, so the tray is its own footer layer above the search box.
        phonePlacement="footer-layer"
        testId="dsm-compare-tray"
      />
    </div>
  );
}
