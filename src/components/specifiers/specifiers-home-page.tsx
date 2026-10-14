"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useDeferredValue, useId, useMemo, useState } from "react";
import { ArrowRight, Search } from "lucide-react";

import { pairCompareHref } from "@/components/compare";

import {
  SearchResultsHeaderBand,
  type AppliedFilterChip,
} from "@/components/clinical-dashboard/search-results-header-band";
import {
  ResultFilterSheet,
  ResultFilterTrigger,
  resultFilterFacetGroup,
  resultFilterGroup,
} from "@/components/clinical-dashboard/result-filter-control";
import {
  CategoryTag,
  ReviewStatusBadge,
  SpecifierMatchCard,
  SpecifierPageShell,
  SpecifierSafetyNote,
  specifierCard,
} from "@/components/specifiers/specifier-ui";
import { UniversalSearchAlsoMatches } from "@/components/clinical-dashboard/universal-search-also-matches";
import { cn, primaryControl } from "@/components/ui-primitives";
import { consolidatedModeSearchPath } from "@/lib/consolidated-mode-home-redirect";
import { searchSpecifiers, specifierFamilies, type SpecifierFamily } from "@/lib/specifiers";
import { searchSpecifierCatalog, type SpecifierCatalogMatch } from "@/lib/specifiers-search-index";
import { SPECIFIERS_REQUIRE_OPTION_REVIEW_BADGE } from "@/lib/specifiers-governance";
import { interpretSmartSearch } from "@/lib/smart-search-intent";
import {
  readResultFilterValue,
  readResultFilterValues,
  replaceResultFilterUrl,
  writeResultFilterValue,
  writeResultFilterValues,
} from "@/lib/result-filter-url";

// The curated set covers a small number of high-signal mood-episode specifiers.
// The full DSM-5-TR catalogue (~585 items) is surfaced additively beneath the
// curated matches so a search still reaches the broader taxonomy without displacing
// the richer curated cards.
const CATALOGUE_RESULT_LIMIT = 24;
const CATALOGUE_RESULT_INCREMENT = 24;
type SpecifierResultScope = "guides" | "catalogue";
const specifierScopeValues = new Set<SpecifierResultScope>(["guides", "catalogue"]);

const diagnosisOptions = [
  { value: "", label: "All diagnoses" },
  { value: "depressive", label: "Depressive" },
  { value: "bipolar", label: "Bipolar" },
  { value: "psychotic", label: "Psychotic" },
  { value: "mood", label: "Mood episodes" },
];

function EmptySearchResults({ query }: { query: string }) {
  return (
    <div className={cn(specifierCard, "grid justify-items-center gap-3 px-5 py-12 text-center")}>
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-[color:var(--surface-subtle)] text-[color:var(--decoration-soft)]">
        <Search className="h-6 w-6" aria-hidden />
      </span>
      <div className="grid gap-1">
        <h2 className="text-lg font-extrabold text-[color:var(--text-heading)]">
          No strong match for &ldquo;{query}&rdquo;
        </h2>
        <p className="max-w-xl text-sm font-medium leading-6 text-[color:var(--text-muted)]">
          Try the episode pattern, timing, patient language, or the base diagnosis. For example: &ldquo;depressed but
          racing thoughts&rdquo; or &ldquo;returns every winter&rdquo;.
        </p>
      </div>
      <Link href={consolidatedModeSearchPath("specifiers")} className={cn(primaryControl)}>
        Clear search
      </Link>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-1">
        <Link
          href={pairCompareHref("/specifiers/compare", "with-anxious-distress", "with-mixed-features")}
          className="text-sm font-bold text-[color:var(--clinical-accent)] hover:underline motion-reduce:transition-none"
        >
          Anxious distress vs mixed features
        </Link>
        <Link
          href={pairCompareHref("/specifiers/compare", "with-melancholic-features", "with-atypical-features")}
          className="text-sm font-bold text-[color:var(--clinical-accent)] hover:underline motion-reduce:transition-none"
        >
          Melancholic vs atypical features
        </Link>
        <Link
          href="/specifiers/map"
          className="text-sm font-bold text-[color:var(--clinical-accent)] hover:underline motion-reduce:transition-none"
        >
          Browse the map
        </Link>
      </div>
    </div>
  );
}

function SpecifierCatalogueMatches({ matches }: { matches: SpecifierCatalogMatch[] }) {
  if (!matches.length) return null;

  return (
    <section aria-label="Full specifier catalogue matches">
      <ul className="grid gap-2 sm:grid-cols-2">
        {matches.map(({ item }) => (
          <li key={item.slug}>
            <Link
              href={`/specifiers/${item.slug}`}
              className={cn(
                specifierCard,
                "group grid gap-2 p-4 transition hover:border-[color:var(--clinical-accent-border)] hover:shadow-[var(--e2)]",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 text-sm font-extrabold text-[color:var(--text-heading)] group-hover:text-[color:var(--clinical-accent)]">
                  {item.label}
                </span>
                <ArrowRight
                  className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--decoration-soft)] transition group-hover:translate-x-0.5 group-hover:text-[color:var(--clinical-accent)] motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                  aria-hidden
                />
              </div>
              <p className="text-xs font-medium leading-5 text-[color:var(--text-muted)]">{item.disorder}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <CategoryTag categoryId={item.categoryId} name={item.category} />
                {SPECIFIERS_REQUIRE_OPTION_REVIEW_BADGE ? <ReviewStatusBadge status={item.src} /> : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SpecifierResults({ query }: { query: string }) {
  const searchParams = useSearchParams();
  const serializedParams = searchParams.toString();
  const deferredQuery = useDeferredValue(query);
  const filterPanelId = useId();
  const [filterOpen, setFilterOpen] = useState(false);
  const allGuideMatches = useMemo(
    () => searchSpecifiers(deferredQuery, { family: "all", diagnosis: "" }),
    [deferredQuery],
  );
  const allCatalogueMatches = useMemo(() => searchSpecifierCatalog(deferredQuery, {}, true), [deferredQuery]);
  const smartInterpretation = useMemo(() => interpretSmartSearch("specifiers", deferredQuery), [deferredQuery]);
  const defaultScope: SpecifierResultScope =
    smartInterpretation.naturalLanguage && allCatalogueMatches.length > 0
      ? "catalogue"
      : allGuideMatches.length > 0
        ? "guides"
        : "catalogue";
  const scope = readResultFilterValue(searchParams, "scope", specifierScopeValues, defaultScope);
  const familyValues = useMemo(() => new Set(specifierFamilies.map((option) => option.id)), []);
  const diagnosisValues = useMemo(() => new Set(diagnosisOptions.map((option) => option.value)), []);
  const family = readResultFilterValue(searchParams, "family", familyValues, "all") as "all" | SpecifierFamily;
  const diagnosis = readResultFilterValue(searchParams, "diagnosis", diagnosisValues, "");
  const fullCatalogueMatches = useMemo(() => searchSpecifierCatalog("", {}, true), []);
  const categoryOptions = useMemo(
    () =>
      [...new Map(fullCatalogueMatches.map(({ item }) => [item.categoryId, item.category])).entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [fullCatalogueMatches],
  );
  const categoryValues = useMemo(() => new Set(categoryOptions.map((option) => option.value)), [categoryOptions]);
  const selectedCategories = useMemo(
    () => new Set(readResultFilterValues(new URLSearchParams(serializedParams), "category", categoryValues)),
    [serializedParams, categoryValues],
  );
  const reviewedOnly = searchParams.get("reviewed") === "1";
  // Nothing typed is browsing, not a search: the list is shown A to Z with no
  // "Top match", so it never reads as the app having picked something. Sorting
  // here (display only) leaves the search library's ranking untouched.
  const browsing = deferredQuery.length === 0;
  const guideMatches = useMemo(() => {
    const matches = searchSpecifiers(deferredQuery, { family, diagnosis });
    return browsing
      ? [...matches].sort((left, right) =>
          left.record.name.localeCompare(right.record.name, "en", { sensitivity: "base" }),
        )
      : matches;
  }, [browsing, diagnosis, family, deferredQuery]);
  const filteredEntries = useMemo(
    () =>
      allCatalogueMatches.filter(
        ({ item }) =>
          (selectedCategories.size === 0 || selectedCategories.has(item.categoryId)) &&
          (!reviewedOnly || item.src === "source-verified"),
      ),
    [allCatalogueMatches, selectedCategories, reviewedOnly],
  );
  const filteredCatalogueMatches = filteredEntries;
  const sortedEntries = useMemo(
    () =>
      browsing
        ? [...filteredCatalogueMatches].sort((left, right) =>
            left.item.label.localeCompare(right.item.label, "en", { sensitivity: "base" }),
          )
        : filteredCatalogueMatches,
    [browsing, filteredCatalogueMatches],
  );
  const catalogueMatches = sortedEntries;
  const matchingTotal = scope === "guides" ? guideMatches.length : catalogueMatches.length;
  const resultSignature = `${deferredQuery}|${scope}|${[...selectedCategories].sort().join(",")}|${reviewedOnly}`;
  const [visibleState, setVisibleState] = useState({ signature: resultSignature, count: CATALOGUE_RESULT_LIMIT });
  if (visibleState.signature !== resultSignature) {
    setVisibleState({ signature: resultSignature, count: CATALOGUE_RESULT_LIMIT });
  }
  const visibleCatalogueMatches = useMemo(
    () => catalogueMatches.slice(0, visibleState.count),
    [catalogueMatches, visibleState.count],
  );

  const familyOptions = useMemo(
    () => specifierFamilies.map((option) => ({ value: option.id, label: option.label })),
    [],
  );
  const updateLens = useCallback(
    <Value extends string>(
      key: "scope" | "family" | "diagnosis",
      value: Value,
      fallback: Value,
      allowed: ReadonlySet<Value>,
    ) => replaceResultFilterUrl((params) => writeResultFilterValue(params, key, value, fallback, allowed)),
    [],
  );
  const toggleCategory = useCallback(
    (value: string) =>
      replaceResultFilterUrl((params) => {
        const next = new Set(readResultFilterValues(params, "category", categoryValues));
        if (!next.delete(value)) next.add(value);
        writeResultFilterValues(params, "category", next, categoryValues);
      }),
    [categoryValues],
  );
  const setReviewedOnly = useCallback(
    (enabled: boolean) =>
      replaceResultFilterUrl((params) => {
        if (enabled) params.set("reviewed", "1");
        else params.delete("reviewed");
      }),
    [],
  );
  const clearFilters = useCallback(
    () =>
      replaceResultFilterUrl((params) => {
        params.delete("scope");
        params.delete("family");
        params.delete("diagnosis");
        params.delete("category");
        params.delete("reviewed");
      }),
    [],
  );
  const activeFilterCount =
    Number(scope !== defaultScope) +
    (scope === "guides"
      ? Number(family !== "all") + Number(Boolean(diagnosis))
      : selectedCategories.size + Number(reviewedOnly));
  const appliedFilters = useMemo<AppliedFilterChip[]>(() => {
    const chips: AppliedFilterChip[] = [];
    if (scope !== defaultScope) {
      chips.push({
        id: "scope",
        groupLabel: "Search in",
        valueLabel: scope === "guides" ? "Clinical guides" : "Full catalogue",
        onRemove: () => updateLens("scope", defaultScope, defaultScope, specifierScopeValues),
      });
    }
    if (scope === "guides") {
      if (family !== "all") {
        chips.push({
          id: "family",
          groupLabel: "Family",
          valueLabel: familyOptions.find((option) => option.value === family)?.label ?? family,
          onRemove: () => updateLens("family", "all", "all", familyValues),
        });
      }
      if (diagnosis) {
        chips.push({
          id: "diagnosis",
          groupLabel: "Diagnosis",
          valueLabel: diagnosisOptions.find((option) => option.value === diagnosis)?.label ?? diagnosis,
          onRemove: () => updateLens("diagnosis", "", "", diagnosisValues),
        });
      }
    } else {
      for (const category of selectedCategories) {
        chips.push({
          id: `category-${category}`,
          groupLabel: "Category",
          valueLabel: categoryOptions.find((option) => option.value === category)?.label ?? category,
          onRemove: () => toggleCategory(category),
        });
      }
      if (reviewedOnly) {
        chips.push({
          id: "reviewed",
          groupLabel: "Source",
          valueLabel: "Source verified",
          onRemove: () => setReviewedOnly(false),
        });
      }
    }
    return chips;
  }, [
    scope,
    defaultScope,
    family,
    familyOptions,
    familyValues,
    diagnosis,
    diagnosisValues,
    selectedCategories,
    categoryOptions,
    reviewedOnly,
    updateLens,
    toggleCategory,
    setReviewedOnly,
  ]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const option of categoryOptions) {
      const next = new Set(selectedCategories);
      if (!next.has(option.value)) next.add(option.value);
      const count = allCatalogueMatches.filter(
        ({ item }) => next.has(item.categoryId) && (!reviewedOnly || item.src === "source-verified"),
      ).length;
      counts.set(option.value, count);
    }
    return counts;
  }, [categoryOptions, selectedCategories, allCatalogueMatches, reviewedOnly]);

  const grouped = useMemo(
    () =>
      scope === "guides"
        ? [
            resultFilterGroup({
              id: "family",
              label: "Family",
              value: family,
              options: familyOptions.map((option) => ({
                ...option,
                hint: String(searchSpecifiers(deferredQuery, { family: option.value, diagnosis }).length),
              })),
              onChange: (value) => updateLens("family", value, "all", familyValues),
            }),
            resultFilterGroup({
              id: "diagnosis",
              label: "Diagnosis",
              value: diagnosis,
              options: diagnosisOptions.map((option) => ({
                ...option,
                hint: String(searchSpecifiers(deferredQuery, { family, diagnosis: option.value }).length),
              })),
              onChange: (value) => updateLens("diagnosis", value, "", diagnosisValues),
            }),
          ]
        : [
            resultFilterFacetGroup({
              id: "category",
              label: "Category",
              selected: selectedCategories,
              options: categoryOptions.map((option) => {
                const count = categoryCounts.get(option.value) ?? 0;
                return {
                  ...option,
                  hint: String(count),
                  disabled: count === 0 && !selectedCategories.has(option.value),
                };
              }),
              onToggle: toggleCategory,
            }),
            resultFilterFacetGroup({
              id: "reviewed",
              label: "Source verification",
              selected: new Set(reviewedOnly ? ["reviewed"] : []),
              options: [
                {
                  value: "reviewed",
                  label: "Source verified",
                  hint: String(
                    allCatalogueMatches.filter(
                      ({ item }) =>
                        item.src === "source-verified" &&
                        (selectedCategories.size === 0 || selectedCategories.has(item.categoryId)),
                    ).length,
                  ),
                },
              ],
              onToggle: () => setReviewedOnly(!reviewedOnly),
            }),
          ],
    [
      scope,
      family,
      familyOptions,
      familyValues,
      diagnosis,
      diagnosisValues,
      deferredQuery,
      selectedCategories,
      categoryOptions,
      categoryCounts,
      reviewedOnly,
      allCatalogueMatches,
      updateLens,
      toggleCategory,
      setReviewedOnly,
    ],
  );
  const groups = grouped;

  return (
    <SpecifierPageShell>
      <SearchResultsHeaderBand
        modeId="specifiers"
        query={query}
        emptyQuerySubject="Specifiers"
        matchCount={matchingTotal}
        headingLevel={1}
        filterLabel="Filter specifier results"
        // One compact badged trigger replaces the two-column grid of selects, so
        // the band collapses to one line here too.
        mobileControlsPlacement="inline"
        mobileControls={
          <ResultFilterTrigger
            panelId={filterPanelId}
            testId="specifier-filter-trigger-phone"
            title="Filter specifiers"
            open={filterOpen}
            activeCount={activeFilterCount}
            onToggle={() => setFilterOpen((current) => !current)}
          />
        }
        filterControls={
          <ResultFilterTrigger
            panelId={filterPanelId}
            testId="specifier-filter-trigger-desktop"
            title="Filter specifiers"
            open={filterOpen}
            activeCount={activeFilterCount}
            onToggle={() => setFilterOpen((current) => !current)}
          />
        }
        appliedFilters={appliedFilters}
        onClearFilters={activeFilterCount > 0 ? clearFilters : undefined}
      />
      {/* Phone-only by construction: the trigger that opens it lives in the
          ribbon's `mobileControls` slot, which the band hides from `sm` up. Both
          dimensions narrow the same list, so the badge counts them independently
          — unlike formulation, where one group is a new search. */}
      <ResultFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        panelId={filterPanelId}
        testId="specifier-filter-panel"
        title="Filter specifiers"
        scope={{
          label: "Search in",
          value: scope,
          onChange: (value) => updateLens("scope", value as SpecifierResultScope, defaultScope, specifierScopeValues),
          options: [
            {
              value: "guides",
              label: "Clinical guides",
              count: guideMatches.length,
              description: "Curated decision-support guides.",
            },
            {
              value: "catalogue",
              label: "Full catalogue",
              count: catalogueMatches.length,
              description: "The complete disorder-specific catalogue.",
            },
          ],
        }}
        groups={groups}
        onClearAll={activeFilterCount > 0 ? clearFilters : undefined}
        summary={{ count: matchingTotal, noun: matchingTotal === 1 ? "specifier" : "specifiers" }}
      />

      {matchingTotal === 0 ? (
        <EmptySearchResults query={query} />
      ) : scope === "guides" ? (
        <section aria-label={browsing ? "Specifiers, A to Z" : "Specifier matches"} className="grid gap-3">
          {guideMatches.map(({ record }, index) => (
            <SpecifierMatchCard key={record.slug} record={record} isTopMatch={!browsing && index === 0} />
          ))}
        </section>
      ) : null}

      {scope === "catalogue" ? <SpecifierCatalogueMatches matches={visibleCatalogueMatches} /> : null}
      {scope === "catalogue" && visibleCatalogueMatches.length < catalogueMatches.length ? (
        <button
          type="button"
          onClick={() =>
            setVisibleState((current) => ({
              signature: resultSignature,
              count: current.count + CATALOGUE_RESULT_INCREMENT,
            }))
          }
          className="inline-flex min-h-tap w-full items-center justify-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-4 text-sm font-bold text-[color:var(--clinical-accent)]"
        >
          Show more ({catalogueMatches.length - visibleCatalogueMatches.length} remaining)
        </button>
      ) : null}

      <UniversalSearchAlsoMatches modeId="specifiers" query={query} />

      <SpecifierSafetyNote />
    </SpecifierPageShell>
  );
}

export function SpecifiersHomePage({
  query = "",
}: {
  query?: string;
  /** Kept so existing callers can pass it; empty queries now browse the catalogue. */
  autoRunSearch?: boolean;
}) {
  return <SpecifierResults query={query.trim()} />;
}
