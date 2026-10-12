"use client";

import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { useId, useMemo, useState } from "react";

import {
  SearchResultsEmptyState,
  SearchResultsHeaderBand,
} from "@/components/clinical-dashboard/search-results-header-band";
import { UniversalSearchAlsoMatches } from "@/components/clinical-dashboard/universal-search-also-matches";
import {
  ResultFilterSheet,
  ResultFilterTrigger,
  resultFilterFacetGroup,
} from "@/components/clinical-dashboard/result-filter-control";
import { pageContainer } from "@/components/ui-primitives";
import { therapyScreenHref } from "@/lib/therapy-compass-navigation";

import { useTcBindings } from "../bindings";
import { matchesAvailability, matchesTopics } from "../data/select";
import { hasSearchableTherapyQuery } from "@/lib/therapy-ranking";
import { LoadingState } from "../ui";
import { CompactResultRow } from "../therapy-card";

// Curated quick-filter tags surfaced as chips (all exist in the tag set).
// None of the six is ever zero across the whole 205-therapy catalogue, so the
// "derive the option list from the data" rule (docs/filter-contract.md
// section 3) — aimed at a permanently empty option — does not apply here; a
// deliberately curated subset of a larger tag vocabulary is a different thing.
const QUICK_TAGS = ["CBT", "Anxiety", "Mood", "Trauma", "DBT", "Crisis/risk"];
const MAX_CARDS = 24;

export function SearchScreen() {
  const b = useTcBindings();
  const q = b.search.query;
  // Nothing typed is browsing, not a search: show the list A to Z with no
  // "Best match" or "Why matched", so it never reads as the app having picked
  // something for this patient. Display-only; the search library is untouched.
  // "Nothing typed" uses the scorer's own normalisation, so punctuation alone
  // (which the scorer cannot rank on) is browsing too.
  const browsing = !hasSearchableTherapyQuery(q);
  const results = useMemo(
    () =>
      browsing
        ? [...b.searchResults].sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" }))
        : b.searchResults,
    [b.searchResults, browsing],
  );
  const shown = results.slice(0, MAX_CARDS);
  // An empty query gives every record the same baseline score and then sorts
  // alphabetically, so only call out a best match when the scorer had real
  // query evidence to rank. Facets narrow the list but do not rank it.
  const hasRankedQuery = !browsing;
  const topics = useMemo(() => new Set(b.search.tags), [b.search.tags]);
  // Filters only — the query is deliberately excluded. It counts toward the
  // sheet's Clear all (see below), because `clearSearch` resets it, but the
  // trigger badge is labelled "N filters active" and a search term is not a
  // filter. Counting it there makes the control announce a state the page is
  // not in, which is the exact defect this screen's sheet was built to fix.
  const activeFilterCount = b.search.tags.length + Number(b.search.reviewedOnly) + Number(b.search.briefOnly);
  // Topics and availability both narrow the same list, so both belong on the
  // shelf. The query is deliberately absent: it is stated in the composer and
  // removing it is not a filter operation.
  const appliedFilters = [
    ...b.search.tags.map((tag) => ({
      id: `topic-${tag}`,
      groupLabel: "Topic",
      valueLabel: tag,
      onRemove: () => b.toggleTag(tag),
    })),
    ...(b.search.reviewedOnly
      ? [{ id: "reviewed", groupLabel: "Evidence", valueLabel: "Reviewed", onRemove: b.toggleReviewedOnly }]
      : []),
    ...(b.search.briefOnly
      ? [{ id: "brief", groupLabel: "Availability", valueLabel: "Brief available", onRemove: b.toggleBriefOnly }]
      : []),
  ];
  const filterPanelId = useId();
  const [filterOpen, setFilterOpen] = useState(false);

  // "How many would I have if I ticked this as well" — the same predicate as
  // the filter, run against the query-only match set with the candidate
  // added, so a count is never derived by narrowing the already-filtered
  // subset. See docs/filter-contract.md section 3 and the two shared
  // predicates in `data/select.ts` that both this and `searchTherapies` run
  // through, so the count and the filter cannot drift apart.
  const topicsGroup = useMemo(
    () =>
      resultFilterFacetGroup({
        id: "topics",
        label: "Topics",
        selected: topics,
        options: QUICK_TAGS.map((tag) => {
          const withCandidate = topics.has(tag) ? topics : new Set([...topics, tag]);
          const count = b.queryMatches.filter(
            (t) => matchesTopics(t, withCandidate) && matchesAvailability(t, b.search.reviewedOnly, b.search.briefOnly),
          ).length;
          return { value: tag, label: tag, hint: String(count), disabled: count === 0 && !topics.has(tag) };
        }),
        onToggle: b.toggleTag,
      }),
    [topics, b.queryMatches, b.search.reviewedOnly, b.search.briefOnly, b.toggleTag],
  );
  // Reviewed-only and brief-available are independent AND constraints, not
  // alternatives — see `matchesAvailability`. Modelled as two separate
  // one-option facet groups rather than options inside one group, because a
  // shared group would OR them together (docs/filter-contract.md section 1),
  // which `searchTherapies` does not: selecting both narrows to therapies
  // that are both reviewed and have a brief, not either.
  const reviewedGroup = useMemo(
    () =>
      resultFilterFacetGroup({
        id: "review-status",
        label: "Review status",
        selected: b.search.reviewedOnly ? new Set(["reviewed"]) : new Set<string>(),
        options: [
          {
            value: "reviewed",
            label: "Reviewed only",
            hint: String(
              b.queryMatches.filter((t) => matchesTopics(t, topics) && matchesAvailability(t, true, b.search.briefOnly))
                .length,
            ),
            disabled:
              b.queryMatches.filter((t) => matchesTopics(t, topics) && matchesAvailability(t, true, b.search.briefOnly))
                .length === 0 && !b.search.reviewedOnly,
          },
        ],
        onToggle: b.toggleReviewedOnly,
      }),
    [b.search.reviewedOnly, b.search.briefOnly, b.queryMatches, topics, b.toggleReviewedOnly],
  );
  const handoutGroup = useMemo(
    () =>
      resultFilterFacetGroup({
        id: "handout",
        label: "Handout",
        selected: b.search.briefOnly ? new Set(["brief"]) : new Set<string>(),
        options: [
          {
            value: "brief",
            label: "Brief available",
            hint: String(
              b.queryMatches.filter(
                (t) => matchesTopics(t, topics) && matchesAvailability(t, b.search.reviewedOnly, true),
              ).length,
            ),
            disabled:
              b.queryMatches.filter(
                (t) => matchesTopics(t, topics) && matchesAvailability(t, b.search.reviewedOnly, true),
              ).length === 0 && !b.search.briefOnly,
          },
        ],
        onToggle: b.toggleBriefOnly,
      }),
    [b.search.briefOnly, b.search.reviewedOnly, b.queryMatches, topics, b.toggleBriefOnly],
  );
  const filterGroups = [topicsGroup, reviewedGroup, handoutGroup];

  // One trigger, both breakpoints — the shared idiom every other mode uses
  // (forms-search-results-page.tsx, document-search-results.tsx). The desktop
  // slot previously printed all three facet groups as a permanently expanded
  // rail, which made Therapy the only mode whose filters were open by default
  // and pushed the first result below the fold. Both copies stay in the DOM at
  // every width; CSS in the band decides which one is displayed, so each needs
  // its own testId.
  const renderFilterTrigger = (testId: string) => (
    <ResultFilterTrigger
      panelId={filterPanelId}
      testId={testId}
      title="Filter therapy results"
      open={filterOpen}
      activeCount={activeFilterCount}
      onToggle={() => setFilterOpen((current) => !current)}
    />
  );

  return (
    <section data-screen-label="Search" className={`${pageContainer} space-y-2.5 sm:space-y-3`}>
      <SearchResultsHeaderBand
        modeId="therapy-compass"
        query={browsing ? "" : q}
        emptyQuerySubject="Therapies"
        matchCount={results.length}
        status={b.error ? "error" : b.loading ? "loading" : "ready"}
        faultBody={b.error ?? undefined}
        onRetry={b.retryData}
        headingLevel={1}
        appliedFilters={appliedFilters}
        onClearFilters={b.clearSearchFilters}
        filterLabel="Filter therapy results"
        // A compact badged trigger, so it shares the count line.
        mobileControlsPlacement="inline"
        mobileControls={renderFilterTrigger("therapy-filter-trigger-phone")}
        filterControls={renderFilterTrigger("therapy-filter-trigger-wide")}
      />

      <ResultFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        panelId={filterPanelId}
        testId="therapy-filter-panel"
        title="Filter therapies"
        groups={filterGroups}
        // Never `clearSearch` — the shared sheet's Clear all must not touch
        // the query (docs/filter-contract.md section 6). The composer's own
        // "Clear search" control (every breakpoint) already covers wiping the
        // query; this sheet only ever clears what it itself narrows.
        onClearAll={activeFilterCount > 0 ? b.clearSearchFilters : undefined}
        summary={{ count: results.length, noun: results.length === 1 ? "therapy" : "therapies" }}
      />

      {/* The band's fault panel owns the failure. Without this guard an error
          also renders the empty state, so the page says both "we couldn't
          search" and "nothing matched" at once. */}
      {b.error ? null : b.loading ? (
        <LoadingState />
      ) : (
        <>
          {results.length === 0 ? (
            <SearchResultsEmptyState
              modeId="therapy-compass"
              query={q}
              appliedFilters={appliedFilters}
              onClearFilters={b.clearSearchFilters}
              // Query-only zero results otherwise have no filter chip or example.
              // Restore a one-tap escape without relabeling
              // a query reset as a filter operation.
              onClearSearch={b.clearSearch}
            />
          ) : (
            // One hairline card with divided compact rows (no cards inside cards).
            <ul
              data-testid="therapy-result-list"
              className="m-0 list-none divide-y divide-[color:var(--border)] overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-0"
            >
              {shown.map((t, index) => (
                <CompactResultRow key={t.slug} therapy={t} featured={!browsing && hasRankedQuery && index === 0} />
              ))}
            </ul>
          )}
        </>
      )}

      {!b.error && !b.loading ? (
        <UniversalSearchAlsoMatches modeId="therapy-compass" query={q} className="mt-4" />
      ) : null}

      {/* The sign-off queue left the main tabs (it is editorial work, not a
          clinical destination). This quiet link keeps it one tap away. */}
      <p className="m-0 pt-2">
        <Link
          href={b.workspaceHref(therapyScreenHref("review"))}
          data-testid="therapy-review-queue-link"
          className="inline-flex min-h-tap items-center gap-2 rounded-lg px-1 text-sm-minus font-semibold text-[color:var(--text-muted)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        >
          <ClipboardCheck aria-hidden="true" className="size-icon-md shrink-0" />
          Review queue
          {b.loading || b.error ? null : (
            <span className="nums text-[color:var(--text-muted)]">· {b.reviewCount} to review</span>
          )}
        </Link>
      </p>
    </section>
  );
}
