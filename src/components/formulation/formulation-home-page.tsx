"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useDeferredValue, useId, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Lightbulb, ListChecks, MessageSquareQuote, Search, Target } from "lucide-react";

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
import { cn, eyebrowText } from "@/components/ui-primitives";
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
        <section
          aria-label={browsing ? "Formulation mechanisms, A to Z" : "Mechanism matches"}
          className="grid gap-4 sm:gap-5"
        >
          {results.map(({ mechanism }, index) => (
            <article
              key={mechanism.id}
              data-testid={index === 0 && hasUniqueTopMatch ? "formulation-top-match" : undefined}
              data-formulation-result-card
              className={cn(
                formulationCard,
                "group relative overflow-hidden rounded-xl border-[color:var(--border-strong)] shadow-[var(--e2)] transition hover:border-[color:var(--clinical-accent-border)] motion-reduce:transition-none",
                index === 0 &&
                  hasUniqueTopMatch &&
                  "border-[color:var(--clinical-accent)] ring-1 ring-[color:var(--clinical-accent)]/10",
              )}
            >
              <div
                aria-hidden
                data-formulation-card-accent
                className={cn(
                  "h-1 w-full bg-[color:var(--clinical-accent-border)]",
                  index === 0 && hasUniqueTopMatch && "bg-[color:var(--clinical-accent)]",
                )}
              />
              <div
                data-formulation-card-header
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4 sm:p-5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                    <h2 className="text-xl font-extrabold tracking-tight text-[color:var(--text-heading)] sm:text-2xl">
                      <Link
                        href={`/formulation/${mechanism.id}`}
                        className={cn(
                          "transition hover:text-[color:var(--clinical-accent)] focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none",
                          // The whole card opens the mechanism. The title carries it
                          // because its text names the result; both actions on the
                          // title row stay separate controls on top of it.
                          stretchedRowLinkClass,
                        )}
                      >
                        {mechanism.name}
                      </Link>
                    </h2>
                    {index === 0 && hasUniqueTopMatch ? (
                      <>
                        {/* The banner this replaces spent a whole row saying what a
                            chip says on the title line. The caution beside it is the
                            part worth keeping: ranking order is not clinical fit. */}
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--clinical-accent)] px-2.5 py-1 text-2xs font-extrabold uppercase tracking-label text-[color:var(--clinical-accent-contrast)]">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          Top match
                        </span>
                        <span className="hidden text-xs font-semibold text-[color:var(--text-muted)] sm:inline">
                          Review fit and alternatives
                        </span>
                      </>
                    ) : null}
                  </div>
                  <p className="mt-1.5 max-w-3xl text-sm font-medium leading-6 text-[color:var(--text-muted)]">
                    {mechanism.summary}
                  </p>
                </div>

                {/* Both actions sit on the title row rather than in a footer band of
                    their own: the old strip cost a full card row per result to hold
                    one button the heading already linked to. */}
                <div data-formulation-card-action className="flex shrink-0 items-center gap-2">
                  <Link
                    href={`/formulation/builder?mechanism=${mechanism.id}`}
                    aria-label={`Use ${mechanism.name} in formulation`}
                    className="relative z-10 inline-flex min-h-tap flex-1 items-center justify-center gap-2 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-4 text-sm font-semibold text-[color:var(--text)] transition hover:border-[color:var(--clinical-accent-border)] hover:text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none sm:flex-none"
                  >
                    <ListChecks className="h-4 w-4 shrink-0" aria-hidden />
                    Use
                  </Link>
                  <Link
                    href={`/formulation/${mechanism.id}`}
                    aria-label={`Open ${mechanism.name}`}
                    className="relative z-10 inline-flex min-h-tap flex-1 items-center justify-center gap-2 rounded-lg border border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] px-4 text-sm font-semibold text-[color:var(--clinical-accent-contrast)] shadow-[var(--shadow-inset)] transition hover:bg-[color:var(--clinical-accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none sm:flex-none sm:px-5"
                  >
                    Open
                    <ArrowRight
                      className="h-4 w-4 shrink-0 transition group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                      aria-hidden
                    />
                  </Link>
                </div>
              </div>

              {/* One band instead of three: the clue keeps its tinted panel, and the
                  supporting lines sit beside it rather than under two more rules. */}
              <div
                data-formulation-card-details
                className="grid border-t border-[color:var(--border)] sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.62fr)]"
              >
                <div className="grid content-start gap-3 px-4 py-3.5 sm:px-5 sm:py-4">
                  <MechanismDomainChips values={mechanism.domains} limit={3} />
                  <div className="flex items-start gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color:var(--info-soft)] text-[color:var(--info)]">
                      <MessageSquareQuote className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className={eyebrowText}>Patient language</p>
                      <p className="mt-1 text-sm font-medium leading-5 text-[color:var(--text-muted)]">
                        “{mechanism.patientPhrases[0]}”
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid content-start gap-3.5 border-t border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 py-3.5 sm:border-l sm:border-t-0 sm:px-5 sm:py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[color:var(--clinical-accent)]">
                      <Target className="h-4 w-4 shrink-0" aria-hidden />
                      <p className={eyebrowText}>Look for</p>
                    </div>
                    <p className="mt-1.5 text-sm font-semibold leading-5 text-[color:var(--text-heading)]">
                      {mechanism.clinicalClues[0]}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[color:var(--clinical-accent)]">
                      <Lightbulb className="h-4 w-4 shrink-0" aria-hidden />
                      <p className={eyebrowText}>Formulation use</p>
                    </div>
                    <p className="mt-1 text-sm font-medium leading-5 text-[color:var(--text-muted)]">
                      {mechanism.formulationUse}
                    </p>
                  </div>
                </div>
              </div>
            </article>
          ))}
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
