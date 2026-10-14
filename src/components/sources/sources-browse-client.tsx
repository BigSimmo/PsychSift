"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, BookOpenText, Landmark } from "lucide-react";
import { useId, useMemo, useState } from "react";

import {
  ResultFilterSheet,
  ResultFilterTrigger,
  resultFilterFacetGroup,
  resultFilterGroup,
} from "@/components/clinical-dashboard/result-filter-control";
import { SearchResultsLayout } from "@/components/clinical-dashboard/search-results-layout";
import {
  SearchResultsEmptyState,
  SearchResultsHeaderBand,
  type AppliedFilterChip,
} from "@/components/clinical-dashboard/search-results-header-band";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { appModeDefinition, type AppModeId } from "@/lib/app-modes";
import {
  SOURCE_BAND_ORDER,
  matchesBrowseQuery,
  sortBrowseSummaries,
  sourceTopicLabel,
  totalSourceCount,
  type SourceBrowseOrder,
  type SourceBrowseSummary,
} from "@/lib/sources/browse-facets";
import type { SourceGeographyScope, SourceQualityBand } from "@/lib/sources/catalogue-types";
import { formatCatalogueMonth } from "@/lib/sources/catalogue-view";
import { SOURCE_BAND_LABELS } from "@/lib/sources/rating-method";

/**
 * Topics and Publishers, on the chrome the Catalogue already uses.
 *
 * Both tabs shipped as bare server-rendered lists: no count, no filter, no empty
 * state, and — the defect a reader actually hits — no reaction to the composer.
 * The query stayed on screen while the page listed every topic in the catalogue,
 * which is a browse result asserted for a search that never ran.
 *
 * One component serves both because they are the same surface over different
 * facets: a heading, how many sources sit under it, how good and how current
 * those sources are, and a link into the filtered catalogue. Publishers adds
 * jurisdiction sections, because WA-first is the clinical point of this mode.
 *
 * The catalogue remains the only place results are read. Nothing here renders a
 * source list, and nothing here owns a search field — the mode composer is the
 * single composer on these routes, per AGENTS.md "Search chrome behaviour".
 */

export type SourcesBrowseKind = "topic" | "publisher";

const jurisdictionLabels: Record<SourceGeographyScope, string> = {
  wa: "Western Australia",
  australian_national: "Australian national",
  australian_state: "Another Australian state",
  international: "International",
  unknown: "Unknown jurisdiction",
};

/** WA first: local applicability is the question this catalogue exists to answer. */
const jurisdictionOrder: readonly SourceGeographyScope[] = [
  "wa",
  "australian_national",
  "australian_state",
  "international",
  "unknown",
];

/** The band said as a quantity rather than as a letter, for the meter's text. */
const bandNouns: Record<SourceQualityBand, string> = {
  A: "preferred",
  B: "strong",
  C: "supplementary",
  D: "needs review",
  excluded: "excluded",
};

/** Status tones — a quality band is a state, so the six-tone system owns its colour. */
const bandFill: Record<SourceQualityBand, string> = {
  A: "bg-[color:var(--success)]",
  B: "bg-[color:var(--info)]",
  C: "bg-[color:var(--border-strong)]",
  D: "bg-[color:var(--warning)]",
  excluded: "bg-[color:var(--danger)]",
};

const kindCopy = {
  topic: {
    testId: "sources-topics-main",
    pageName: "Topics",
    noun: "topic",
    nounPlural: "topics",
    emptyQueryLabel: "Source topics",
    filterLabel: "Filter topics",
    filterDescription:
      "Narrow the topics by the jurisdiction, quality band or application usage of the sources behind them.",
    resultsLabel: "Source topics",
    param: "topic",
    icon: BookOpenText,
  },
  publisher: {
    testId: "sources-publishers-main",
    pageName: "Publishers",
    noun: "publisher",
    nounPlural: "publishers",
    emptyQueryLabel: "Source publishers",
    filterLabel: "Filter publishers",
    filterDescription:
      "Narrow the publishers by jurisdiction, the quality of their sources, or where PsychSift uses them.",
    resultsLabel: "Source publishers",
    param: "publisher",
    icon: Landmark,
  },
} as const satisfies Record<SourcesBrowseKind, Record<string, unknown>>;

const orderOptions: ReadonlyArray<{ value: SourceBrowseOrder; label: string }> = [
  { value: "alpha", label: "A–Z" },
  { value: "coverage", label: "Most sources" },
  { value: "attention", label: "Needs review first" },
];

function readOrder(value: string | null): SourceBrowseOrder {
  return value === "coverage" || value === "attention" ? value : "alpha";
}

function qualityPhrase(summary: SourceBrowseSummary) {
  return SOURCE_BAND_ORDER.filter((band) => summary.bandCounts[band] > 0)
    .map((band) => `${summary.bandCounts[band]} ${bandNouns[band]}`)
    .join(" · ");
}

function BrowseRow({ kind, summary, href }: { kind: SourcesBrowseKind; summary: SourceBrowseSummary; href: string }) {
  const Icon = kindCopy[kind].icon;
  const latest = formatCatalogueMonth(summary.latestDate);
  const detail = kind === "topic" ? summary.publishers : summary.topics.map(sourceTopicLabel);
  const usage = summary.usedByModes.slice(0, 2).map((modeId) => appModeDefinition(modeId).label);
  const bands = SOURCE_BAND_ORDER.filter((band) => summary.bandCounts[band] > 0);

  return (
    <li>
      <Link
        href={href}
        aria-label={`View ${summary.label} sources`}
        className={cn(
          // A row of its section's one card: no border, shadow or lift of its
          // own. The list draws the box and divides rows with a hairline.
          "group grid min-h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-3.5 py-3.5 transition-colors",
          "hover:bg-[color:var(--surface-subtle)] motion-reduce:transition-none",
          "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus)]",
        )}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
          <Icon className="size-icon-md" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block overflow-hidden text-sm-minus font-extrabold leading-5 text-[color:var(--text-heading)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] group-hover:text-[color:var(--clinical-accent)]">
            {summary.label}
          </span>
          {/* The quality mix as a bar, drawn inside the row's labelled link and
              always accompanied by the sentence below it. Band is a clinical
              signal, so it is never carried by hue alone — under forced colors
              every fill collapses to the same system colour, and the tally in
              words is what survives.

              Only drawn where there is a mix. A heading whose sources are all one
              band renders a single solid bar that says nothing the sentence does
              not, and on a corpus where one band dominates that is a whole page of
              identical coloured rules reading as an alert. */}
          {bands.length > 1 ? (
            <span
              aria-hidden
              className="mt-1.5 flex h-0.5 w-full max-w-40 overflow-hidden rounded-full bg-[color:var(--surface-inset)]"
            >
              {bands.map((band) => (
                <span
                  key={band}
                  className={cn("h-full", bandFill[band])}
                  style={{ flexGrow: summary.bandCounts[band] }}
                />
              ))}
            </span>
          ) : null}
          <span className="mt-1 block text-xs font-semibold leading-5 text-[color:var(--text-muted)]">
            {qualityPhrase(summary)}
            {summary.attentionCount > 0 ? (
              <span className="text-[color:var(--warning)]">
                {" · "}
                {summary.attentionCount} need{summary.attentionCount === 1 ? "s" : ""} attention
              </span>
            ) : null}
            {latest ? ` · ${summary.latestDateLabel} ${latest}` : null}
          </span>
          {detail.length || usage.length ? (
            <span className="mt-1 block text-xs font-medium leading-5 text-[color:var(--text-muted)]">
              {detail.join(" · ")}
              {detail.length && usage.length ? " · " : null}
              {usage.length ? `Used in ${usage.join(", ")}` : null}
            </span>
          ) : null}
        </span>
        {/* The count, without its unit. 166 stacked "SOURCES" captions is noise,
            and the width the caption cost is what was truncating the titles. The
            unit stays in the row's accessible name and in the line below. */}
        <span className="flex shrink-0 items-center gap-1 self-center">
          <span className="nums text-sm-minus font-extrabold leading-4 text-[color:var(--text-heading)]">
            {summary.count}
          </span>
          <ArrowRight
            className={cn(
              "size-icon-md shrink-0 text-[color:var(--decoration-soft)] transition",
              "group-hover:translate-x-0.5 group-hover:text-[color:var(--clinical-accent)]",
              "motion-reduce:transition-none motion-reduce:group-hover:translate-x-0",
            )}
            aria-hidden="true"
          />
        </span>
      </Link>
    </li>
  );
}

// One hairline card per group, rows divided by a hairline, one column at every
// width. The three-column grid of separate cards made a heading's sources read
// as unrelated tiles rather than as one list.
const rowGrid =
  "divide-y divide-[color:var(--border)] overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]";

type FacetKey = "jurisdiction" | "band" | "usedBy";

export function SourcesBrowseClient({
  kind,
  summaries,
  hostedDocuments,
}: {
  kind: SourcesBrowseKind;
  summaries: readonly SourceBrowseSummary[];
  hostedDocuments: "available" | "unavailable";
}) {
  const copy = kindCopy[kind];
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const filterPanelId = useId();
  const [filterOpen, setFilterOpen] = useState(false);

  const query = (searchParams.get("q") ?? "").trim();
  const order = readOrder(searchParams.get("order"));
  const selected = useMemo(
    () => ({
      jurisdiction: searchParams
        .getAll("jurisdiction")
        .flatMap((value) => value.split(","))
        .filter(Boolean),
      band: searchParams
        .getAll("band")
        .flatMap((value) => value.split(","))
        .filter(Boolean),
      usedBy: searchParams
        .getAll("usedBy")
        .flatMap((value) => value.split(","))
        .filter(Boolean),
    }),
    [searchParams],
  );

  const narrow = useMemo(() => {
    const apply = (facets: Record<FacetKey, readonly string[]>) =>
      summaries.filter((summary) => {
        if (!matchesBrowseQuery(summary, query)) return false;
        if (
          facets.jurisdiction.length &&
          !(kind === "publisher"
            ? facets.jurisdiction.includes(summary.scope)
            : summary.jurisdictions.some((scope) => facets.jurisdiction.includes(scope)))
        ) {
          return false;
        }
        if (facets.band.length && !facets.band.some((band) => summary.bandCounts[band as SourceQualityBand] > 0)) {
          return false;
        }
        if (facets.usedBy.length && !summary.usedByModes.some((modeId) => facets.usedBy.includes(modeId))) {
          return false;
        }
        return true;
      });
    return apply;
  }, [kind, query, summaries]);

  const visible = useMemo(() => sortBrowseSummaries(narrow(selected), order), [narrow, order, selected]);

  const setParamValues = (key: string, values: readonly string[]) => {
    const next = new URLSearchParams();
    for (const [candidateKey, candidateValue] of searchParams.entries()) {
      if (candidateKey !== key) next.append(candidateKey, candidateValue);
    }
    for (const value of values) next.append(key, value);
    const suffix = next.toString();
    router.replace(`${pathname}${suffix ? `?${suffix}` : ""}`, { scroll: false });
  };

  const toggleFacet = (key: FacetKey, value: string) => {
    const current = selected[key];
    setParamValues(key, current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };

  // Drops the query and keeps every filter — the mirror of `clearFilters`, which
  // keeps the query. The empty state offers both as separate controls, so a
  // "Clear search" that also silently wiped band, jurisdiction and usage would
  // make one of those controls a lie.
  const clearQuery = () => {
    const next = new URLSearchParams();
    for (const [candidateKey, candidateValue] of searchParams.entries()) {
      if (candidateKey !== "q") next.append(candidateKey, candidateValue);
    }
    const suffix = next.toString();
    router.push(`${pathname}${suffix ? `?${suffix}` : ""}`);
  };

  const clearFilters = () => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    const suffix = next.toString();
    router.replace(`${pathname}${suffix ? `?${suffix}` : ""}`, { scroll: false });
  };

  /** How many headings this option would leave visible if it were ticked as well. */
  const optionCount = (key: FacetKey, value: string) => {
    const current = selected[key];
    const widened = current.includes(value) ? current : [...current, value];
    return narrow({ ...selected, [key]: widened }).length;
  };

  const facetOptions = (key: FacetKey, values: readonly string[], format: (value: string) => string) =>
    values.map((value) => {
      const count = optionCount(key, value);
      return {
        value,
        label: format(value),
        hint: `${count} ${count === 1 ? copy.noun : copy.nounPlural}`,
        hintLabel: String(count),
        disabled: count === 0 && !selected[key].includes(value),
      };
    });

  const presentJurisdictions = jurisdictionOrder.filter((scope) =>
    summaries.some((summary) =>
      kind === "publisher" ? summary.scope === scope : summary.jurisdictions.includes(scope),
    ),
  );
  const presentBands = SOURCE_BAND_ORDER.filter((band) => summaries.some((summary) => summary.bandCounts[band] > 0));
  const presentModes = [...new Set(summaries.flatMap((summary) => summary.usedByModes))].sort((left, right) =>
    appModeDefinition(left).label.localeCompare(appModeDefinition(right).label, "en-AU"),
  );

  const groups = [
    resultFilterFacetGroup({
      id: "sources-browse-jurisdiction",
      label: "Jurisdiction",
      selected: new Set(selected.jurisdiction),
      options: facetOptions(
        "jurisdiction",
        presentJurisdictions,
        (scope) => jurisdictionLabels[scope as SourceGeographyScope],
      ),
      onToggle: (value) => toggleFacet("jurisdiction", value),
    }),
    resultFilterFacetGroup({
      id: "sources-browse-band",
      label: "Quality band",
      description: "Kept when at least one source under the heading carries the band.",
      selected: new Set(selected.band),
      options: facetOptions("band", presentBands, (band) => SOURCE_BAND_LABELS[band as SourceQualityBand]),
      onToggle: (value) => toggleFacet("band", value),
    }),
    resultFilterFacetGroup({
      id: "sources-browse-used-by",
      label: "Used in",
      description: "The part of PsychSift whose records cite these sources.",
      selected: new Set(selected.usedBy),
      options: facetOptions("usedBy", presentModes, (modeId) => appModeDefinition(modeId as AppModeId).label),
      onToggle: (value) => toggleFacet("usedBy", value),
    }),
    resultFilterGroup({
      id: "sources-browse-order",
      label: "Order",
      note: "one only",
      value: order,
      options: orderOptions.map((option) => ({ value: option.value, label: option.label })),
      onChange: (value) => setParamValues("order", value === "alpha" ? [] : [value]),
    }),
  ];

  const chipGroups = [
    {
      key: "jurisdiction",
      label: "Jurisdiction",
      format: (value: string) => jurisdictionLabels[value as SourceGeographyScope] ?? value,
    },
    {
      key: "band",
      label: "Quality band",
      format: (value: string) => SOURCE_BAND_LABELS[value as SourceQualityBand] ?? value,
    },
    { key: "usedBy", label: "Used in", format: (value: string) => appModeDefinition(value as AppModeId).label },
  ] as const;

  const appliedFilters: AppliedFilterChip[] = chipGroups.flatMap((group) =>
    selected[group.key].map((value) => ({
      id: `${group.key}-${value}`,
      groupLabel: group.label,
      valueLabel: group.format(value),
      onRemove: () => toggleFacet(group.key, value),
    })),
  );

  const filterTrigger = (testId: string) => (
    <ResultFilterTrigger
      panelId={filterPanelId}
      testId={testId}
      title={copy.filterLabel}
      open={filterOpen}
      activeCount={appliedFilters.length}
      onToggle={() => setFilterOpen((current) => !current)}
    />
  );

  const href = (summary: SourceBrowseSummary) =>
    kind === "topic"
      ? `/sources/search?topic=${encodeURIComponent(summary.value)}`
      : `/sources/search?publisher=${encodeURIComponent(summary.value)}&jurisdiction=${summary.scope}`;

  const sections =
    kind === "publisher"
      ? jurisdictionOrder
          .map((scope) => ({ scope, rows: visible.filter((summary) => summary.scope === scope) }))
          .filter((section) => section.rows.length > 0)
      : [];

  return (
    <SearchResultsLayout
      testId={copy.testId}
      resultsLabel={copy.resultsLabel}
      header={
        <>
          {/* Reached through the mode navigation, which already says which tab you
              are on, so the name exists for the outline and is not painted. */}
          <h1 className="sr-only">{copy.pageName}</h1>
          <SearchResultsHeaderBand
            modeId="sources"
            query={query}
            matchCount={visible.length}
            status="ready"
            resultNoun={visible.length === 1 ? copy.noun : copy.nounPlural}
            hideEmptyQuery
            emptyQueryLabel={copy.emptyQueryLabel}
            filterLabel={copy.filterLabel}
            appliedFilters={appliedFilters}
            onClearFilters={appliedFilters.length > 0 ? clearFilters : undefined}
            mobileControlsPlacement="inline"
            mobileControls={filterTrigger(`sources-${kind}-filter-trigger-phone`)}
            utilityControls={
              <span className="hidden items-center gap-2 sm:inline-flex">
                {filterTrigger(`sources-${kind}-filter-trigger-desktop`)}
              </span>
            }
          />
          <ResultFilterSheet
            open={filterOpen}
            onClose={() => setFilterOpen(false)}
            panelId={filterPanelId}
            testId={`sources-${kind}-filter-sheet`}
            title={copy.filterLabel}
            description={copy.filterDescription}
            groups={groups}
            onClearAll={appliedFilters.length > 0 ? clearFilters : undefined}
            summary={{ count: visible.length, noun: visible.length === 1 ? copy.noun : copy.nounPlural }}
            chromeResetKey={query}
          />
          {/* The same honesty the catalogue owes its count. Topic and publisher
              coverage is derived from the same entries, so it is exactly as
              incomplete when the hosted-document loader is unreachable. */}
          {hostedDocuments === "unavailable" ? (
            <p
              role="note"
              data-testid="sources-partial-catalogue-note"
              className="pt-2 text-xs font-semibold text-[color:var(--warning-text,var(--text-muted))]"
            >
              Uploaded document sources cannot be reached, so this list and its counts are incomplete.
            </p>
          ) : null}
        </>
      }
    >
      {visible.length === 0 ? (
        <SearchResultsEmptyState
          modeId="sources"
          query={query}
          appliedFilters={appliedFilters}
          onClearFilters={appliedFilters.length > 0 ? clearFilters : undefined}
          onClearSearch={query ? clearQuery : undefined}
          onBrowseAll={() => router.push("/sources/search")}
          browseAllLabel="Browse every source"
        />
      ) : kind === "publisher" ? (
        <div className="grid gap-5">
          {sections.map((section) => (
            <section key={section.scope} className="grid gap-2.5" aria-labelledby={`publisher-scope-${section.scope}`}>
              {/* A compact label row, not the `text-xl` block this replaced. The
                  heading is the page's outline; it is not the page's furniture,
                  and on a phone it was costing a publisher of screen each time. */}
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-0.5">
                <h2 id={`publisher-scope-${section.scope}`} className={eyebrowText}>
                  {jurisdictionLabels[section.scope]}
                </h2>
                <span className="text-xs font-semibold text-[color:var(--text-muted)]">
                  {section.rows.length} {section.rows.length === 1 ? "publisher" : "publishers"} ·{" "}
                  {totalSourceCount(section.rows)} {totalSourceCount(section.rows) === 1 ? "source" : "sources"}
                </span>
              </div>
              {/* Unknown is a gap in the records, not a place. Saying so stops the
                  longest section on the page reading as a jurisdiction. */}
              {section.scope === "unknown" ? (
                <p className="text-xs font-medium text-[color:var(--text-muted)]">
                  No jurisdiction is recorded for these publishers. The catalogue does not infer one.
                </p>
              ) : null}
              <ul className={rowGrid}>
                {section.rows.map((summary) => (
                  <BrowseRow
                    key={`${section.scope}-${summary.value}`}
                    kind={kind}
                    summary={summary}
                    href={href(summary)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className={rowGrid}>
          {visible.map((summary) => (
            <BrowseRow key={summary.value} kind={kind} summary={summary} href={href(summary)} />
          ))}
        </ul>
      )}
    </SearchResultsLayout>
  );
}
