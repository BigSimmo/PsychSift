"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useDeferredValue, useId, useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, ListChecks, Search } from "lucide-react";

import {
  FormulationPageShell,
  FormulationSafetyNote,
  MechanismDomainChips,
  formulationCard,
} from "@/components/formulation/formulation-ui";
import {
  SearchResultsHeaderBand,
  type AppliedFilterChip,
} from "@/components/clinical-dashboard/search-results-header-band";
import {
  ResultFilterSheet,
  ResultFilterTrigger,
  resultFilterFacetGroup,
} from "@/components/clinical-dashboard/result-filter-control";
import { AnswerSuggestionChips } from "@/components/clinical-dashboard/answer-suggestion-chips";
import { cn } from "@/components/ui-primitives";
import { appModeHomeHref } from "@/lib/app-modes";
import { consolidatedModeSearchPath } from "@/lib/consolidated-mode-home-redirect";
import {
  formulationDomains,
  formulationDomainsInUse,
  formulationDomainGroups,
  formulationSearchPresets,
  searchFormulationMechanismIndex,
} from "@/lib/formulation-mechanism-index";
import { formulationConceptDomainsInUse, searchFormulationConcepts } from "@/lib/formulation-concept-search";

/**
 * Every domain something in the library actually carries.
 *
 * Before the contextual concepts arrived this was nine of the twelve declared
 * domains, because no mechanism carried Biological, Social or Cultural. Those
 * three are now carried by concept records, so hiding them would offer a filter
 * that cannot reach content the same page is showing. Taxonomy order is kept.
 */
const formulationLibraryDomainsInUse = formulationDomains.filter(
  (domain) => formulationDomainsInUse.includes(domain) || formulationConceptDomainsInUse.includes(domain),
);
import { UniversalSearchAlsoMatches } from "@/components/clinical-dashboard/universal-search-also-matches";
import { stretchedRowLinkClass } from "@/components/card-recipes";
import { readResultFilterValues, replaceResultFilterUrl, writeResultFilterValues } from "@/lib/result-filter-url";

function presetHref(query: string) {
  return appModeHomeHref("formulation", { query, run: true, focus: true });
}

function EmptySearchResults({ query }: { query: string }) {
  return (
    <div className={cn(formulationCard, "grid justify-items-center gap-3 px-5 py-12 text-center")}>
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-[color:var(--surface-subtle)] text-[color:var(--decoration-soft)]">
        <Search className="h-6 w-6" aria-hidden />
      </span>
      <div className="grid gap-1">
        <h2 className="text-lg font-extrabold text-[color:var(--text-heading)]">No mechanism matched “{query}”</h2>
        <p className="max-w-xl text-sm font-medium leading-6 text-[color:var(--text-muted)]">
          Try a patient phrase, sequence, coping response, or clinical clue—for example “I keep going over it” or “I was
          not really there”.
        </p>
      </div>
      <Link
        href={consolidatedModeSearchPath("formulation")}
        className="inline-flex min-h-tap items-center gap-2 rounded-lg bg-[color:var(--command)] px-4 text-sm font-semibold text-[color:var(--command-contrast)]"
      >
        Clear search
      </Link>
    </div>
  );
}

function FormulationResults({ query }: { query: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Many-of-N. A mechanism carries 3.92 domains on average, so a radio set
  // claimed the reader could not hold Affect and Risk at once, which is false.
  const domainValues = useMemo(() => new Set(formulationLibraryDomainsInUse), []);
  const domains = useMemo(
    () => new Set(readResultFilterValues(searchParams, "domain", domainValues)),
    [domainValues, searchParams],
  );
  const filterPanelId = useId();
  const [filterOpen, setFilterOpen] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const rankingReady = deferredQuery === query;
  // The one frame where the live query has text but the deferred one has not
  // caught up. `results` deliberately reports nothing there rather than scoring
  // the whole catalogue, so the counts must say the same thing — otherwise the
  // sheet shows "0 showing" beside nine non-zero counts, which is the exact
  // disagreement between a filter and its own predicate that this contract
  // exists to remove.
  const pendingRanking = Boolean(query.trim()) && !deferredQuery.trim();
  const searchQuery = query.trim() ? deferredQuery : "";
  // Nothing typed is browsing, not a search: the list is A to Z with no "Top
  // match", so it never reads as the app having picked something for a patient.
  // The sort is display-only; the search library's ranking is untouched.
  const browsing = !query.trim();
  const results = useMemo(() => {
    // Cleared live query should restore the full browse catalogue immediately.
    if (!query.trim())
      return [...searchFormulationMechanismIndex("", { domains })].sort((left, right) =>
        left.mechanism.name.localeCompare(right.mechanism.name, "en", { sensitivity: "base" }),
      );
    // Empty deferred while live query has text would score every mechanism —
    // treat that lag as "no results yet" instead of dumping the full catalogue.
    if (!deferredQuery.trim()) return [];
    return searchFormulationMechanismIndex(deferredQuery, { domains, interpretNaturalLanguage: true });
  }, [domains, deferredQuery, query]);
  const hasUniqueTopMatch =
    !browsing && results.length > 0 && (results.length < 2 || results[0].score !== results[1].score);
  // Contextual factors rank separately and always sit below the mechanisms, so
  // a housing or delirium record can never displace a mechanism from the top of
  // the list the mode is named for. Empty query browses the whole set.
  const conceptResults = useMemo(() => {
    if (!query.trim())
      return [...searchFormulationConcepts("", { domains })].sort((left, right) =>
        left.concept.title.localeCompare(right.concept.title, "en", { sensitivity: "base" }),
      );
    if (!deferredQuery.trim()) return [];
    return searchFormulationConcepts(deferredQuery, { domains, interpretNaturalLanguage: true });
  }, [domains, deferredQuery, query]);

  const toggleDomain = useCallback(
    (value: string) => {
      replaceResultFilterUrl((params) => {
        const next = new Set(readResultFilterValues(params, "domain", domainValues));
        if (!next.delete(value)) next.add(value);
        writeResultFilterValues(params, "domain", next, domainValues);
      });
    },
    [domainValues],
  );

  // "How many would I have if I ticked this as well" — the same predicate as the
  // filter, run with the candidate added. Under OR-within-group adding an option
  // WIDENS, so a count derived by narrowing the current subset would disagree
  // with what the click actually does. See docs/filter-contract.md section 3.
  const domainGroup = useMemo(
    () =>
      resultFilterFacetGroup({
        id: "domain",
        label: "Domain",
        description: "Domains combine with OR. Sections organise the taxonomy without changing that predicate.",
        selected: domains,
        optionSections: formulationDomainGroups.map((section) => ({
          id: section.id,
          label: section.label,
          description: section.description,
          optionValues: section.domains.filter((domain) => domainValues.has(domain)),
        })),
        options: formulationLibraryDomainsInUse.map((item) => {
          // Counts both halves of the result list, because ticking the option
          // widens both. A count derived from the mechanisms alone would
          // disagree with what the click actually does on every concept-only
          // domain — see docs/filter-contract.md section 3.
          const candidateDomains = new Set([...domains, item]);
          const withCandidate = pendingRanking
            ? 0
            : searchFormulationMechanismIndex(searchQuery, {
                domains: candidateDomains,
                interpretNaturalLanguage: true,
              }).length +
              searchFormulationConcepts(searchQuery, {
                domains: candidateDomains,
                interpretNaturalLanguage: true,
              }).length;
          return {
            value: item,
            label: item,
            hint: String(withCandidate),
            // A zero here is a consequence of the current query, not a
            // permanently empty option — the derived list already removed
            // those. It stays visible and focusable as a dead end so a reader
            // who has narrowed to nothing can see which choice did it, rather
            // than being offered a tick that silently yields an empty list.
            // Never applied to an option already selected: that would make an
            // active constraint unremovable — and never during the deferred
            // lag, where a zero means "not scored yet", not "nothing matches",
            // and would flash all nine options inert for a frame.
            disabled: !pendingRanking && withCandidate === 0 && !domains.has(item),
          };
        }),
        onToggle: toggleDomain,
      }),
    [domains, domainValues, pendingRanking, searchQuery, toggleDomain],
  );
  const appliedFilters: AppliedFilterChip[] = [...domains].map((domain) => ({
    id: `domain-${domain}`,
    groupLabel: "Domain",
    valueLabel: domain,
    onRemove: () => toggleDomain(domain),
  }));
  const clearDomains = () =>
    replaceResultFilterUrl((params) => {
      params.delete("domain");
    });

  return (
    <FormulationPageShell>
      <SearchResultsHeaderBand
        modeId="formulation"
        query={query}
        emptyQuerySubject="Formulation mechanisms"
        // Both halves: the domain filter narrows mechanisms and contextual
        // concepts alike, so a count of mechanisms alone would shrink by less
        // than the list the reader is looking at.
        matchCount={results.length + conceptResults.length}
        resultNoun={results.length + conceptResults.length === 1 ? "record" : "records"}
        // This is `useDeferredValue` lag over static data, not a network request:
        // the previous count is still on screen and still correct, so it stays
        // visible with a pulse rather than collapsing to a skeleton. Safe here
        // precisely because nothing identity-scoped is being held across the gap.
        status={rankingReady ? "ready" : "refetching"}
        headingLevel={1}
        filterLabel="Filter formulation mechanisms"
        appliedFilters={appliedFilters}
        onClearFilters={domains.size > 0 ? clearDomains : undefined}
        // One compact badged trigger replaces the two-column grid of selects, so
        // the band collapses to one line here too.
        mobileControlsPlacement="inline"
        mobileControls={
          <ResultFilterTrigger
            panelId={filterPanelId}
            testId="formulation-filter-trigger-phone"
            title="Filter formulation mechanisms"
            open={filterOpen}
            activeCount={domains.size}
            onToggle={() => setFilterOpen((current) => !current)}
          />
        }
        // The same control the sheet renders, so the two breakpoints cannot
        // drift. The preset row that used to sit here has moved below the band:
        // it replaced the query rather than narrowing it, which a control
        // labelled "Filter" must not do.
        filterControls={
          <ResultFilterTrigger
            panelId={filterPanelId}
            testId="formulation-filter-trigger-desktop"
            title="Filter formulation mechanisms"
            open={filterOpen}
            activeCount={domains.size}
            onToggle={() => setFilterOpen((current) => !current)}
          />
        }
      />

      {/* Phone-only by construction: the trigger that opens it lives in the
          ribbon's `mobileControls` slot, which the band hides from `sm` up. One
          group now — the `pattern` group that used to sit above it called
          `router.push` and replaced the query, discarding the search and its
          results with no warning and no undo. Those presets are searches, so
          they render as searches below the band. */}
      <ResultFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        panelId={filterPanelId}
        testId="formulation-filter-panel"
        title="Filter formulation mechanisms"
        groups={[domainGroup]}
        onClearAll={domains.size === 0 ? undefined : clearDomains}
        summary={{
          count: results.length + conceptResults.length,
          noun: results.length + conceptResults.length === 1 ? "record" : "records",
        }}
      />

      {/* Evicted from the filter sheet, and all five rather than the first four:
          the old `.slice(0, 4)` left one preset unreachable at every breakpoint.
          Framed as a new search, which is what picking one does. */}
      <AnswerSuggestionChips
        label="Try another pattern"
        labelPlacement="above"
        layout="scroll"
        testId="formulation-pattern-suggestions"
        suggestions={formulationSearchPresets.map((preset) => preset.label)}
        onPick={(label) => {
          const preset = formulationSearchPresets.find((item) => item.label === label);
          if (preset) router.push(presetHref(preset.query));
        }}
      />

      {results.length === 0 && conceptResults.length === 0 && rankingReady ? (
        <EmptySearchResults query={query} />
      ) : results.length === 0 ? null : (
        <section aria-label={browsing ? "Formulation mechanisms, A to Z" : "Mechanism matches"}>
          {/* Compact rows (Clinical audit, 13 Oct 2026, item 12), the same row
              Therapy search uses: one hairline card with divided rows, the whole
              row opens the mechanism, and Use and Open stay as small 48px
              buttons. Patient language, clues and formulation use are on the
              mechanism's own page, where they are shown in full. */}
          <ul
            data-testid="formulation-result-list"
            className="m-0 list-none divide-y divide-[color:var(--border)] overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-0"
          >
            {results.map(({ mechanism }, index) => {
              const topMatch = index === 0 && hasUniqueTopMatch;
              return (
                <li
                  key={mechanism.id}
                  data-testid={topMatch ? "formulation-top-match" : undefined}
                  data-formulation-result-card
                  className="group relative px-4 py-3 transition-colors motion-reduce:transition-none sm:px-5 md:hover:bg-[color:var(--surface-subtle)]"
                >
                  {topMatch ? (
                    // Ranking order is not clinical fit: the caution travels with the tag.
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-2.5 py-0.5 text-2xs font-extrabold tracking-wide text-[color:var(--clinical-accent)] uppercase forced-colors:border-[CanvasText] forced-colors:text-[CanvasText]">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        Top match
                      </span>
                      <span className="text-xs font-semibold text-[color:var(--text-muted)]">
                        Review fit and alternatives
                      </span>
                    </div>
                  ) : null}
                  <div data-formulation-card-header className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <h2 className="m-0 text-base leading-snug font-semibold tracking-display text-[color:var(--text-heading)]">
                        <Link
                          href={`/formulation/${mechanism.id}`}
                          className={cn(
                            "rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
                            stretchedRowLinkClass,
                          )}
                        >
                          {mechanism.name}
                        </Link>
                      </h2>
                      <p className="m-0 mt-0.5 line-clamp-1 text-sm leading-snug text-[color:var(--text-muted)]">
                        {mechanism.summary}
                      </p>
                      <div className="mt-2">
                        <MechanismDomainChips values={mechanism.domains} limit={2} />
                      </div>
                    </div>
                    <div data-formulation-card-action className="-mr-2 flex shrink-0 items-center self-center">
                      <Link
                        href={`/formulation/builder?mechanism=${mechanism.id}`}
                        aria-label={`Use ${mechanism.name} in formulation`}
                        title="Use in formulation"
                        className="relative z-10 grid min-h-tap min-w-tap place-items-center rounded-lg text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                      >
                        <ListChecks className="size-icon-md shrink-0" aria-hidden />
                      </Link>
                      <Link
                        href={`/formulation/${mechanism.id}`}
                        aria-label={`Open ${mechanism.name}`}
                        className="relative z-10 grid min-h-tap min-w-tap place-items-center rounded-lg text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                      >
                        <ChevronRight className="size-icon-md shrink-0" aria-hidden />
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {conceptResults.length ? (
        <section aria-labelledby="formulation-context-matches" className="grid gap-3">
          <div>
            <h2 id="formulation-context-matches" className="text-lg font-extrabold text-[color:var(--text-heading)]">
              Contributing factors and context
            </h2>
            <p className="mt-1 max-w-3xl text-sm font-medium leading-6 text-[color:var(--text-muted)]">
              Biological, social and cultural material that belongs in the formulation but is not a psychological
              mechanism. A factor needs case evidence before it explains anything.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {conceptResults.map(({ concept }) => (
              <Link
                key={concept.id}
                href={`/formulation/${concept.id}`}
                data-formulation-concept-card
                className={cn(
                  formulationCard,
                  "grid content-start gap-1.5 p-4 transition hover:border-[color:var(--clinical-accent-border)] motion-reduce:transition-none",
                )}
              >
                <span className="text-sm font-extrabold text-[color:var(--text-heading)]">{concept.title}</span>
                <span className="text-xs font-medium leading-5 text-[color:var(--text-muted)]">{concept.summary}</span>
                <MechanismDomainChips values={concept.domains} limit={2} />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <UniversalSearchAlsoMatches modeId="formulation" query={query} />

      <FormulationSafetyNote />
    </FormulationPageShell>
  );
}

export function FormulationHomePage({
  query = "",
}: {
  query?: string;
  /** Kept so existing callers can pass it; empty queries now browse the catalogue. */
  autoRunSearch?: boolean;
}) {
  return <FormulationResults query={query.trim()} />;
}
