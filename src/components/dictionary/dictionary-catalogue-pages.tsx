"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpenText,
  Check,
  ChevronDown,
  Filter,
  GitCompareArrows,
  Layers3,
  Search,
  X,
} from "lucide-react";

import {
  ResultFilterSheet,
  ResultFilterTrigger,
  resultFilterFacetGroup,
  resultFilterGroup,
  type ResultFilterOption,
} from "@/components/clinical-dashboard/result-filter-control";
import { SearchResultsHeaderBand } from "@/components/clinical-dashboard/search-results-header-band";
import { UniversalSearchAlsoMatches } from "@/components/clinical-dashboard/universal-search-also-matches";
import { DesktopComposerPortalSlot } from "@/components/desktop-composer-portal-slot";
import { DictionaryResultRow } from "@/components/dictionary/dictionary-result-row";
import { InPageNavHeader } from "@/components/in-page-nav/in-page-nav-header";
import { type PageSection } from "@/components/in-page-nav/page-section-index";
import { useInPageSectionNav } from "@/components/in-page-nav/use-in-page-section-nav";
import {
  InformationPageFooter,
  InformationPageHeader,
  InformationPageShell,
} from "@/components/information-page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn, searchShell, searchShellInput } from "@/components/ui-primitives";
import {
  allDictionaryEntries,
  dictionaryBrowseLetter,
  dictionaryCatalogue,
  dictionaryClearedQueryKeys,
  dictionaryKindLabel,
  dictionaryTopicEntries,
  findDictionaryTopic,
  parseDictionaryCatalogueParams,
  type DictionaryCatalogueScope,
  type DictionaryCatalogueSort,
} from "@/lib/dictionary";
import {
  dictionaryEntryKinds,
  dictionarySources,
  dictionaryTopics,
  type DictionaryEntryKind,
} from "@/lib/dictionary-data";
import { desktopPageComposerSlotId, modeHomeComposerReservePendingValue } from "@/lib/mode-home-composer";

const scopeOptions = [
  { value: "definitions", label: "Terms" },
  { value: "abbreviations", label: "Abbreviations" },
] as const satisfies ReadonlyArray<{ value: DictionaryCatalogueScope; label: string }>;

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

const topicDetailSections = [
  { id: "dictionary-topic-terms", label: "Terms", icon: BookOpenText },
  {
    id: "dictionary-topic-details",
    label: "Collection details",
    icon: Layers3,
    targetIds: ["dictionary-topic-details-phone", "dictionary-topic-details-desktop"],
  },
] as const satisfies readonly PageSection[];

function useDictionaryUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const replace = (edit: (params: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams.toString());
    edit(next);
    const suffix = next.toString();
    router.replace(`${pathname}${suffix ? `?${suffix}` : ""}`, { scroll: false });
  };
  const setOne = (key: string, value: string, defaultValue?: string) =>
    replace((next) => {
      if (!value || value === defaultValue) next.delete(key);
      else next.set(key, value);
    });
  const toggleMany = (key: string, value: string) =>
    replace((next) => {
      const values = new Set(next.getAll(key));
      next.delete(key);
      if (values.has(value)) values.delete(value);
      else values.add(value);
      for (const selected of values) next.append(key, selected);
    });
  return { searchParams, replace, setOne, toggleMany };
}

/**
 * What the catalogue counted, singular at one.
 *
 * "1 abbreviations for tardive dyskinesia" is the sort of line a reader stops
 * on, and the scope decides the noun: the same list is terms or abbreviations
 * depending on which segment is pressed.
 */
function catalogueNoun(scope: DictionaryCatalogueScope, count: number) {
  if (scope === "abbreviations") return count === 1 ? "abbreviation" : "abbreviations";
  return count === 1 ? "term" : "terms";
}

/**
 * The clinical dictionary catalogue — one destination for the whole list.
 *
 * `/dictionary/search` and `/dictionary/browse` were two routes over one
 * catalogue, listing the same entries as the same rows from the same data, and a
 * reader who typed a term while on Browse had to change tab to see it. They are
 * merged here: an empty query shows everything, a typed query narrows the same
 * list, and clearing it restores the catalogue. `/dictionary/browse` survives
 * only as a redirect for existing links.
 *
 * The Filter band is always on this page (count, optional query, Filter). Compact
 * Terms / Abbreviations and A–Z sit under that band. From `sm` up, the shared
 * composer portals into this page under mode nav and above the Filter band.
 * Phones keep the usual compact bottom dock. Do not add a second search field —
 * `docs/search-chrome-behaviour.md`'s one-composer-per-page rule is a hard
 * constraint with committed tests behind it.
 */
export function DictionaryCataloguePage() {
  const { searchParams, replace, setOne, toggleMany } = useDictionaryUrl();
  const serializedSearchParams = searchParams.toString();
  const params = useMemo(
    () => parseDictionaryCatalogueParams(new URLSearchParams(serializedSearchParams)),
    [serializedSearchParams],
  );
  const searching = params.q.length > 0;
  const [filterOpen, setFilterOpen] = useState(false);
  const [letterOpen, setLetterOpen] = useState(false);

  const hits = useMemo(() => dictionaryCatalogue(params), [params]);
  // Both counts come from the same predicate as the list, so a segment's number
  // is what pressing it actually returns (docs/filter-contract.md). While a
  // query runs they are the matches for that query, not the catalogue totals.
  const scopeCounts = useMemo(
    () =>
      Object.fromEntries(
        scopeOptions.map((option) => [option.value, dictionaryCatalogue({ ...params, scope: option.value }).length]),
      ) as Record<DictionaryCatalogueScope, number>,
    [params],
  );
  // Letters the current scope and facets can actually fill. The rest stay
  // visible — the alphabet is a fixed mental model — but inert, so the index can
  // never strand the reader on an empty page.
  const letterCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const hit of dictionaryCatalogue({ ...params, letter: "all" })) {
      const initial = dictionaryBrowseLetter(hit);
      counts.set(initial, (counts.get(initial) ?? 0) + 1);
    }
    return counts;
  }, [params]);
  const letterTotal = useMemo(
    () => [...letterCounts.values()].reduce((total, count) => total + count, 0),
    [letterCounts],
  );
  // Sort lives in the sheet but is not a filter: it reorders rather than
  // narrows, so counting it in the badge would claim results were withheld.
  const activeCount = params.topics.length + params.kinds.length + params.sources.length;
  const noun = catalogueNoun(params.scope, hits.length);

  const clearFilters = () =>
    replace((next) => {
      for (const key of ["topic", "kind", "source"]) next.delete(key);
    });
  // Clearing the query drops `run` with it, because the shell re-derives the
  // composer's value from the URL on every search-string change and a leftover
  // submitted marker would restore the results view the reader just dismissed.
  // Letter and facets stay: they remain visible under the band / in Filter.
  const clearQuery = () =>
    replace((next) => {
      for (const key of dictionaryClearedQueryKeys) next.delete(key);
    });

  const sortOptions: ResultFilterOption<DictionaryCatalogueSort>[] = [
    // Relevance ranks against a query. With none, `entryScore` gives every entry
    // the same flat score, so offering it would be an option that reorders
    // nothing while looking like it might.
    ...(searching ? [{ value: "relevance" as const, label: "Best match" }] : []),
    { value: "az", label: "A–Z" },
    { value: "za", label: "Z–A" },
  ];

  const groups = [
    resultFilterGroup({
      id: "sort",
      label: "Sort",
      value: params.sort,
      options: sortOptions,
      onChange: (value) => setOne("sort", value, searching ? "relevance" : "az"),
      note: "one only",
    }),
    resultFilterFacetGroup({
      id: "topics",
      label: "Topics",
      description: "Select one or more governed collections.",
      selected: new Set(params.topics),
      options: dictionaryTopics.map((topic) => ({
        value: topic.slug,
        label: topic.title,
        hint: String(dictionaryCatalogue({ ...params, topics: [topic.slug] }).length),
      })),
      onToggle: (value) => toggleMany("topic", value),
    }),
    resultFilterFacetGroup({
      id: "kinds",
      label: "Entry kind",
      selected: new Set(params.kinds),
      options: dictionaryEntryKinds.map((kind) => ({
        value: kind,
        label: dictionaryKindLabel(kind),
        hint: String(dictionaryCatalogue({ ...params, kinds: [kind] }).length),
      })),
      onToggle: (value) => toggleMany("kind", value),
    }),
    resultFilterFacetGroup({
      id: "sources",
      // Labelled by the source's own title, not its organisation: five of the
      // twelve sources are published by Healthdirect Australia, so an
      // organisation label rendered five identical options that each filtered to
      // a different single document.
      label: "Source",
      selected: new Set(params.sources),
      options: dictionarySources.map((source) => ({
        value: source.id,
        label: source.title,
        searchText: `${source.title} ${source.organisation}`,
        hint: String(dictionaryCatalogue({ ...params, sources: [source.id] }).length),
      })),
      onToggle: (value) => toggleMany("source", value),
    }),
  ];

  const letterGroups = [
    resultFilterGroup({
      id: "letter",
      label: "Jump to letter",
      value: params.letter,
      options: [
        { value: "all", label: "All letters", hint: String(letterTotal) },
        ...alphabet.map((letter) => ({
          value: letter,
          label: letter,
          hint: String(letterCounts.get(letter) ?? 0),
          disabled: !letterCounts.has(letter),
        })),
      ],
      onChange: (value) => {
        setOne("letter", value, "all");
        setLetterOpen(false);
      },
      note: "one only",
    }),
  ];

  const appliedFilters = [
    ...params.topics.map((slug) => ({
      id: `topic-${slug}`,
      groupLabel: "Topic",
      valueLabel: findDictionaryTopic(slug)?.title ?? slug,
      onRemove: () => toggleMany("topic", slug),
    })),
    ...params.kinds.map((kind) => ({
      id: `kind-${kind}`,
      groupLabel: "Kind",
      valueLabel: dictionaryKindLabel(kind),
      onRemove: () => toggleMany("kind", kind),
    })),
    ...params.sources.map((sourceId) => ({
      id: `source-${sourceId}`,
      groupLabel: "Source",
      valueLabel: dictionarySources.find((source) => source.id === sourceId)?.title ?? sourceId,
      onRemove: () => toggleMany("source", sourceId),
    })),
  ];

  /* One equal-layout rail: both catalogue scopes have identical geometry while
     the shared primitive owns radio semantics, arrow-key navigation, focus and
     the 48px tap target. Responsive compact widths give the longer
     Abbreviations label enough room as the shared control's padding grows,
     without letting either segment size itself from its text and leave the
     control visually lopsided. */
  const scopeToggle = (
    <div data-testid="dictionary-scope-toggle" className="w-56 shrink-0 min-[360px]:w-64 sm:w-72">
      <SegmentedControl
        label="Show"
        value={params.scope}
        onChange={(value) => setOne("view", value, "definitions")}
        options={scopeOptions.map((option) => ({
          ...option,
          hint: String(scopeCounts[option.value]),
        }))}
        ariaControls="dictionary-catalogue-results"
        layout="equal"
      />
    </div>
  );

  /* Phone A–Z: compact to match the toggle. The desktop rail below is the same
     control at a width that can afford 27 chips. */
  const letterChip = (
    <button
      type="button"
      onClick={() => setLetterOpen((open) => !open)}
      aria-haspopup="dialog"
      aria-expanded={letterOpen}
      aria-controls={letterOpen ? "dictionary-letter-sheet" : undefined}
      data-testid="dictionary-letter-chip"
      title="Jump to a letter"
      className={cn(
        "inline-flex min-h-tap min-w-tap shrink-0 items-center justify-center gap-0.5 overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-inset)] px-2 text-xs font-semibold leading-none text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)] sm:hidden",
        focusRing,
      )}
    >
      {params.letter === "all" ? "A–Z" : params.letter}
      <ChevronDown className="size-icon-xs shrink-0 text-[color:var(--text-muted)]" aria-hidden="true" />
      <span className="sr-only">
        {params.letter === "all" ? " · jump to a letter" : ` · jump to a letter, currently ${params.letter}`}
      </span>
    </button>
  );

  const filterTrigger = (slot: "desktop" | "phone") => (
    <ResultFilterTrigger
      panelId="dictionary-filter-sheet"
      testId={`dictionary-filter-trigger-${slot}`}
      open={filterOpen}
      activeCount={activeCount}
      onToggle={() => setFilterOpen((value) => !value)}
      title="Filter the dictionary catalogue"
      labelVisibility="always"
    />
  );

  /* Clears the query from the band's own line, which is where the reader is
     looking when they decide they are done with it. Filter stays in the band. */
  const clearQueryControl = (
    <button
      type="button"
      onClick={clearQuery}
      data-testid="dictionary-clear-query"
      className={cn(
        "search-band-ghost grid min-h-tap min-w-tap shrink-0 place-items-center rounded-lg border border-[color:var(--border)] text-[color:var(--text-muted)] transition-colors hover:text-[color:var(--text)] motion-reduce:transition-none sm:min-h-10 sm:min-w-10",
        focusRing,
      )}
    >
      <X className="size-icon-md" aria-hidden="true" />
      <span className="sr-only">Clear the search and restore the catalogue</span>
    </button>
  );

  return (
    <>
      <InformationPageShell testId="dictionary-catalogue-main" width="bleed" gap={false}>
        {/* A result view, not a mode home: this is the shared PAGE composer slot,
            so the catalogue gets the compact pill alone at sm+ — no rotating "Try
            ..." line, Prompts rail, or privacy line, exactly like /forms/search and
            /documents/search. The slot is page-owned rather than shell-owned only so
            it sits under the mode nav and above the Filter band; GlobalSearchShell
            suppresses its own copy for this route. Padding comes from the composer's
            own `px-4 py-3`, so the slot adds none. */}
        <DesktopComposerPortalSlot
          id={desktopPageComposerSlotId}
          data-testid="dictionary-catalogue-composer"
          data-composer-reserve={modeHomeComposerReservePendingValue}
          className="desktop-page-composer-slot mx-auto hidden w-full min-w-0 sm:block sm:min-h-0 sm:data-[composer-reserve=pending]:min-h-[var(--spacing-mode-home-composer-wide)] sm:[&:not(:empty)]:min-h-[var(--spacing-mode-home-composer-wide)]"
        />
        <h1 className="sr-only">Dictionary catalogue</h1>
        {/* The original Filter band stays on browse and search. Compact Terms /
            Abbreviations and A–Z sit centred underneath it on phones. */}
        <div className="mx-auto w-full max-w-[var(--content-width-catalogue)] px-4 pb-2 pt-3 sm:px-6 sm:pb-3 sm:pt-0">
          <SearchResultsHeaderBand
            modeId="dictionary"
            query={params.q}
            matchCount={hits.length}
            status="ready"
            resultNoun={noun}
            hideEmptyQuery
            emptyQueryLabel="Dictionary catalogue filters"
            utilityControls={
              <>
                {searching ? clearQueryControl : null}
                <span className="hidden shrink-0 sm:flex">{filterTrigger("desktop")}</span>
              </>
            }
            mobileControls={filterTrigger("phone")}
            mobileControlsPlacement="inline"
            appliedFilters={appliedFilters}
            onClearFilters={activeCount ? clearFilters : undefined}
          />
          <div className="mt-2 flex flex-nowrap items-center justify-center gap-1.5">
            {scopeToggle}
            {letterChip}
          </div>
          {/* Wraps rather than scrolls: 27 chips overrun the 76rem container by
              a chip's width, and a rail that clips Z is worse than a rail that
              takes two rows on the narrower desktop widths. */}
          <nav aria-label="Browse by letter" className="mt-2 hidden flex-wrap gap-1 sm:flex">
            {["all", ...alphabet].map((value) => {
              const empty = value !== "all" && !letterCounts.has(value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-current={params.letter === value ? "page" : undefined}
                  disabled={empty}
                  onClick={() => setOne("letter", value, "all")}
                  className={cn(
                    "grid min-h-tap min-w-tap place-items-center rounded-md border text-xs font-semibold sm:min-h-10 sm:min-w-10",
                    params.letter === value
                      ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
                      : empty
                        ? "border-[color:var(--border)] text-[color:var(--disabled)]"
                        : "border-[color:var(--border)] text-[color:var(--clinical-accent)] hover:bg-[color:var(--surface-subtle)]",
                  )}
                >
                  {value === "all" ? "All" : value}
                </button>
              );
            })}
          </nav>
        </div>
        <div
          id="dictionary-catalogue-results"
          className="mx-auto w-full max-w-[var(--content-width-catalogue)] px-0 py-3 sm:px-6 sm:py-4"
        >
          {hits.length ? (
            <section
              aria-label="Dictionary catalogue"
              className="border-y border-[color:var(--border)] sm:overflow-hidden sm:rounded-xl sm:border-x sm:bg-[color:var(--surface)]"
            >
              {hits.map((hit) => {
                const key =
                  hit.type === "entry"
                    ? `entry-${hit.entry.slug}`
                    : hit.type === "topic"
                      ? `topic-${hit.topic.slug}`
                      : `abbr-${hit.abbreviation}`;
                return <DictionaryResultRow key={key} hit={hit} />;
              })}
            </section>
          ) : (
            // The empty state wears the same card as the result list. Bare on
            // the page background it read as a rendering failure rather than an
            // answer, and the advice named a filter even when none was applied.
            <div className="border-y border-[color:var(--border)] px-4 py-12 text-center sm:rounded-xl sm:border-x sm:bg-[color:var(--surface)]">
              {searching ? (
                <Search className="mx-auto size-icon-xl text-[color:var(--decoration-soft)]" aria-hidden="true" />
              ) : (
                <BookOpenText className="mx-auto size-icon-xl text-[color:var(--decoration-soft)]" aria-hidden="true" />
              )}
              {/* The noun follows the scope, exactly as the count line does: an
                  abbreviations list reporting "No terms under Z" names a
                  catalogue the reader is not looking at. */}
              <h2 className="mt-3 text-lg font-extrabold text-[color:var(--text-heading)]">
                {searching
                  ? params.letter === "all"
                    ? "No matching dictionary entries"
                    : `No matching dictionary entries under ${params.letter}`
                  : params.letter === "all"
                    ? `No ${catalogueNoun(params.scope, 0)} match these filters`
                    : `No ${catalogueNoun(params.scope, 0)} under ${params.letter}`}
              </h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-[color:var(--text-muted)]">
                {searching
                  ? params.letter === "all"
                    ? activeCount
                      ? "Keep the search term and remove a filter, or try a broader term."
                      : "Try a broader term, check the spelling, or clear the search to browse the catalogue."
                    : activeCount
                      ? "Keep the search term, show all letters, or remove a filter."
                      : "Show all letters, try a broader term, or clear the search to browse the catalogue."
                  : params.letter === "all"
                    ? "Remove a filter, or switch between terms and abbreviations."
                    : "Choose another letter, or widen the filters."}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {searching ? (
                  <button
                    type="button"
                    onClick={clearQuery}
                    className="min-h-tap rounded-lg px-4 text-sm font-semibold text-[color:var(--clinical-accent)]"
                  >
                    Clear the search
                  </button>
                ) : null}
                {params.letter === "all" ? null : (
                  <button
                    type="button"
                    onClick={() => setOne("letter", "all", "all")}
                    className="min-h-tap rounded-lg px-4 text-sm font-semibold text-[color:var(--clinical-accent)]"
                  >
                    Show all letters
                  </button>
                )}
                {activeCount ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="min-h-tap rounded-lg px-4 text-sm font-semibold text-[color:var(--clinical-accent)]"
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>
        {/* The catalogue shell is `bleed`, so every band owns its own container.
            Without one this cross-mode tray stretched the full viewport while
            the result list above it stayed inside the catalogue width, which
            read as a wider, longer panel bolted onto the page. Same container as
            the header band and the results, so its edges line up with theirs. */}
        <div className="mx-auto w-full max-w-[var(--content-width-catalogue)] px-4 sm:px-6">
          <UniversalSearchAlsoMatches modeId="dictionary" query={params.q} className="mt-4" />
        </div>
        <InformationPageFooter>
          All published entries link a source · Specialist clinical approval remains pending
        </InformationPageFooter>
      </InformationPageShell>
      <ResultFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        panelId="dictionary-filter-sheet"
        testId="dictionary-filter-sheet"
        title="Filter and sort"
        description="Facets narrow the current list; Terms / Abbreviations and A–Z remain on the page under this band."
        groups={groups}
        onClearAll={activeCount ? clearFilters : undefined}
        summary={{ count: hits.length, noun }}
        primaryActionLabel={`Show ${hits.length} ${noun}`}
        onApply={() => setFilterOpen(false)}
        chromeResetKey={params.q}
      />
      <ResultFilterSheet
        open={letterOpen}
        onClose={() => setLetterOpen(false)}
        panelId="dictionary-letter-sheet"
        testId="dictionary-letter-sheet"
        title="Jump to letter"
        description="Letters with no entry in the current scope stay visible but are not selectable."
        groups={letterGroups}
        summary={{ count: hits.length, noun }}
        onApply={() => setLetterOpen(false)}
      />
    </>
  );
}

function topicMatches(topicSlug: string, query: string, kinds: readonly DictionaryEntryKind[]) {
  const topic = findDictionaryTopic(topicSlug);
  if (!topic) return false;
  const entries = dictionaryTopicEntries(topic);
  if (kinds.length && !entries.some((entry) => kinds.includes(entry.kind))) return false;
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return `${topic.title} ${topic.description} ${entries.map((entry) => entry.term).join(" ")}`
    .toLocaleLowerCase()
    .includes(needle);
}

export function DictionaryTopicsPage() {
  const { searchParams, replace, setOne, toggleMany } = useDictionaryUrl();
  const query = searchParams.get("q") ?? "";
  const kinds = searchParams
    .getAll("kind")
    .filter((kind): kind is DictionaryEntryKind => dictionaryEntryKinds.includes(kind as DictionaryEntryKind));
  const sort = searchParams.get("sort") === "za" ? "za" : "az";
  const [filterOpen, setFilterOpen] = useState(false);
  // Clears both narrowing inputs: `kind` from the filter sheet and a `q` carried
  // in from a deep link. Either one alone can empty the list, so a Clear that
  // only dropped `kind` would leave a `?q=` visitor stuck on an empty page.
  const clearTopicFilters = () =>
    replace((next) => {
      next.delete("kind");
      next.delete("q");
    });
  const visible = dictionaryTopics
    .filter((topic) => topicMatches(topic.slug, query, kinds))
    .sort((a, b) => (sort === "az" ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title)));
  const groups = [
    resultFilterFacetGroup({
      id: "kinds",
      label: "Entry kind",
      selected: new Set(kinds),
      options: dictionaryEntryKinds.map((kind) => ({ value: kind, label: dictionaryKindLabel(kind) })),
      onToggle: (value) => toggleMany("kind", value),
    }),
  ];
  return (
    <>
      <InformationPageShell width="bleed" gap={false} testId="dictionary-topics-main">
        <div className="mx-auto grid w-full max-w-[var(--content-width-catalogue)] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:py-8">
          {/* A `div`, not a `main`: `InformationPageShell` already renders the
              route's `<main>`, and a nested one is a duplicate landmark. */}
          <div className="min-w-0">
            <InformationPageHeader eyebrow="Governed collections" title="Topics" />
            {/* The page-level topic search was removed: twelve collections fit on
                one screen, and the universal composer already searches the whole
                dictionary. Kind filtering and sort stay, as a compact toolbar. */}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-b border-[color:var(--border)] pb-3">
              <p className="mr-auto text-sm font-bold text-[color:var(--text-muted)]">
                <span className="nums text-[color:var(--text-heading)]">{visible.length}</span>{" "}
                {visible.length === 1 ? "collection" : "collections"}
              </p>
              <button
                type="button"
                onClick={() => setFilterOpen(true)}
                className="inline-flex min-h-tap items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm font-semibold text-[color:var(--text)] hover:border-[color:var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:min-h-10"
              >
                <Filter className="size-icon-sm" aria-hidden="true" />
                Filter
                {kinds.length ? <span className="nums text-[color:var(--clinical-accent)]">{kinds.length}</span> : null}
              </button>
              <button
                type="button"
                onClick={() => setOne("sort", sort === "az" ? "za" : "az", "az")}
                className="inline-flex min-h-tap items-center gap-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm font-semibold text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:min-h-10"
              >
                {sort === "az" ? "A–Z" : "Z–A"}
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <section className="border-b border-[color:var(--border)]" aria-label="Clinical topics">
              {visible.map((topic) => {
                const entries = dictionaryTopicEntries(topic);
                return (
                  <Link
                    key={topic.slug}
                    href={`/dictionary/topics/${topic.slug}`}
                    className="group grid min-h-[6rem] grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-[color:var(--border)] py-3 last:border-b-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
                      <Layers3 className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-base font-extrabold text-[color:var(--text-heading)] group-hover:text-[color:var(--clinical-accent)]">
                        {topic.title}
                      </span>
                      <span className="mt-0.5 block text-sm leading-5 text-[color:var(--text-muted)]">
                        {topic.description}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs font-semibold text-[color:var(--text-muted)]">
                        <span className="text-[color:var(--clinical-accent)]">{entries.length} terms</span>
                        {entries.slice(0, 3).map((entry) => (
                          <span
                            key={entry.slug}
                            className="rounded-md bg-[color:var(--surface-inset)] px-1.5 py-0.5 text-3xs"
                          >
                            {entry.aliases.find((alias) => alias.kind === "abbreviation")?.value ?? entry.term}
                          </span>
                        ))}
                      </span>
                    </span>
                    <ArrowRight className="size-icon-sm text-[color:var(--clinical-accent)]" aria-hidden="true" />
                  </Link>
                );
              })}
              {/* Reachable from a `?kind=`/`?q=` deep link. Without this the
                  section collapsed to a bare rule under "0 collections". */}
              {visible.length ? null : (
                <div className="px-4 py-12 text-center">
                  <Layers3 className="mx-auto size-icon-xl text-[color:var(--decoration-soft)]" aria-hidden="true" />
                  <h2 className="mt-3 text-lg font-extrabold text-[color:var(--text-heading)]">
                    No matching collections
                  </h2>
                  <p className="mx-auto mt-1 max-w-md text-sm text-[color:var(--text-muted)]">
                    {kinds.length
                      ? "No governed collection carries a term of that kind."
                      : "Nothing in the governed collections matches that search."}
                  </p>
                  {kinds.length || query ? (
                    <button
                      type="button"
                      onClick={clearTopicFilters}
                      className="mt-4 min-h-tap rounded-lg px-4 text-sm font-semibold text-[color:var(--clinical-accent)]"
                    >
                      Show all collections
                    </button>
                  ) : null}
                </div>
              )}
            </section>
            <div className="mt-3 grid border-y border-[color:var(--border)] lg:hidden">
              <DisclosureLink
                title="Browse by kind"
                summary={`${dictionaryEntryKinds.length} entry kinds`}
                href="/dictionary/search"
              />
              <DisclosureLink
                title="Common comparisons"
                summary="MSE vs MMSE · Delirium vs dementia"
                href="/dictionary/compare"
              />
            </div>
          </div>
          <aside className="hidden border-l border-[color:var(--border)] pl-6 lg:block">
            <h2 className="text-sm font-extrabold text-[color:var(--text-heading)]">Browse by kind</h2>
            <div className="mt-2 grid">
              {dictionaryEntryKinds.map((kind) => (
                <Link
                  key={kind}
                  href={`/dictionary/search?kind=${kind}`}
                  className="flex min-h-tap items-center justify-between border-b border-[color:var(--border)] text-sm font-semibold text-[color:var(--clinical-accent)]"
                >
                  {dictionaryKindLabel(kind)}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              ))}
            </div>
            <h2 className="mt-8 text-sm font-extrabold text-[color:var(--text-heading)]">Common comparisons</h2>
            <div className="mt-2 grid">
              <DisclosureLink
                title="MSE vs MMSE"
                summary="Assessment and measurement"
                href="/dictionary/compare?a=mental-state-examination&b=mini-mental-state-examination"
              />
              <DisclosureLink
                title="Delirium vs dementia"
                summary="Cognition"
                href="/dictionary/compare?a=delirium&b=dementia"
              />
              <DisclosureLink
                title="Mood vs affect"
                summary="Mental state examination"
                href="/dictionary/compare?a=mood&b=affect"
              />
            </div>
          </aside>
        </div>
        <InformationPageFooter>
          {dictionaryTopics.length} source-governed collections · {allDictionaryEntries.length} canonical entries
        </InformationPageFooter>
      </InformationPageShell>
      <ResultFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        panelId="dictionary-topic-filters"
        testId="dictionary-topic-filters"
        title="Filter topics"
        groups={groups}
        onClearAll={kinds.length ? clearTopicFilters : undefined}
        summary={{ count: visible.length, noun: visible.length === 1 ? "topic" : "topics" }}
        onApply={() => setFilterOpen(false)}
      />
    </>
  );
}

function DisclosureLink({ title, summary, href }: { title: string; summary: string; href: string }) {
  return (
    <Link
      href={href}
      className="grid min-h-tap grid-cols-[minmax(0,1fr)_auto] items-center border-b border-[color:var(--border)] py-2.5 last:border-b-0"
    >
      <span>
        <span className="block text-sm font-bold text-[color:var(--text-heading)]">{title}</span>
        <span className="block text-xs text-[color:var(--text-muted)]">{summary}</span>
      </span>
      <ArrowRight className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden="true" />
    </Link>
  );
}

export function DictionaryTopicDetailPage({ topicSlug }: { topicSlug: string }) {
  const topic = findDictionaryTopic(topicSlug);
  const router = useRouter();
  const sectionNav = useInPageSectionNav(topicDetailSections);
  const { searchParams, replace, setOne, toggleMany } = useDictionaryUrl();
  const query = (searchParams.get("q") ?? "").trim().toLocaleLowerCase();
  const kinds = searchParams
    .getAll("kind")
    .filter((kind): kind is DictionaryEntryKind => dictionaryEntryKinds.includes(kind as DictionaryEntryKind));
  const sort = searchParams.get("sort") === "za" ? "za" : "az";
  const [filterOpen, setFilterOpen] = useState(false);
  if (!topic) return null;
  const entries = dictionaryTopicEntries(topic)
    .filter(
      (entry) =>
        (!query ||
          `${entry.term} ${entry.definition} ${entry.aliases.map((alias) => alias.value).join(" ")}`
            .toLocaleLowerCase()
            .includes(query)) &&
        (!kinds.length || kinds.includes(entry.kind)),
    )
    .sort((a, b) => (sort === "az" ? a.term.localeCompare(b.term) : b.term.localeCompare(a.term)));
  const grouped = dictionaryEntryKinds
    .map((kind) => ({ kind, entries: entries.filter((entry) => entry.kind === kind) }))
    .filter((group) => group.entries.length);
  const groups = [
    resultFilterFacetGroup({
      id: "kinds",
      label: "Entry kind",
      selected: new Set(kinds),
      options: Array.from(new Set(dictionaryTopicEntries(topic).map((entry) => entry.kind))).map((kind) => ({
        value: kind,
        label: dictionaryKindLabel(kind),
      })),
      onToggle: (value) => toggleMany("kind", value),
    }),
  ];
  return (
    <>
      <InPageNavHeader
        back={{ href: "/dictionary/topics", label: "Back to topics" }}
        title={topic.title}
        sections={sectionNav.sections}
        activeId={sectionNav.activeId}
        onSelectSection={sectionNav.selectSection}
        primaryAction={{
          label: "Compare terms",
          icon: GitCompareArrows,
          onClick: () => router.push("/dictionary/compare"),
        }}
        actionsTitle="Collection actions"
        actionsDescription="Continue from this governed topic collection."
        actionsNoun="collection"
        testIdPrefix="dictionary-topic-detail"
        actions={
          <div className="grid">
            <Link
              href="/dictionary/compare"
              className="flex min-h-tap items-center gap-2 rounded-lg px-3 text-sm font-semibold hover:bg-[color:var(--surface-subtle)]"
            >
              <GitCompareArrows className="size-icon-sm text-[color:var(--clinical-accent)]" aria-hidden="true" />
              Compare terms
            </Link>
            <Link
              href="/dictionary/sources"
              className="flex min-h-tap items-center gap-2 rounded-lg px-3 text-sm font-semibold hover:bg-[color:var(--surface-subtle)]"
            >
              <BookOpenText className="size-icon-sm text-[color:var(--clinical-accent)]" aria-hidden="true" />
              How sources are governed
            </Link>
          </div>
        }
      />
      <InformationPageShell width="bleed" gap={false} testId="dictionary-topic-detail-main">
        <div className="mx-auto grid w-full max-w-[var(--content-width-catalogue)] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:py-8">
          <div id="dictionary-topic-terms" className="min-w-0 scroll-mt-page-section">
            <PageHeader
              title={topic.title}
              description={topic.description}
              meta={
                <p className="inline-flex items-center gap-3 text-xs font-semibold text-[color:var(--text-muted)]">
                  <span>{topic.entrySlugs.length} terms</span>
                  <span className="inline-flex items-center gap-1 text-[color:var(--success)]">
                    <Check className="h-4 w-4" aria-hidden="true" />
                    Source linked
                  </span>
                </p>
              }
            />
            <div className="mt-5 flex gap-2">
              <label className={cn(searchShell, "min-w-0 flex-1 sm:min-h-10")}>
                <Search className="size-icon-sm text-[color:var(--decoration-soft)]" aria-hidden="true" />
                <span className="sr-only">Search this topic</span>
                <input
                  defaultValue={searchParams.get("q") ?? ""}
                  onChange={(event) => setOne("q", event.target.value)}
                  placeholder="Search this topic"
                  className={cn(searchShellInput, "text-base sm:text-sm")}
                />
              </label>
              <button
                type="button"
                onClick={() => setFilterOpen(true)}
                className="inline-flex min-h-tap items-center gap-2 rounded-lg border border-[color:var(--border)] px-3 text-sm font-semibold sm:min-h-10"
              >
                <Filter className="size-icon-sm" aria-hidden="true" />
                Filter{kinds.length ? ` ${kinds.length}` : ""}
              </button>
              <button
                type="button"
                onClick={() => setOne("sort", sort === "az" ? "za" : "az", "az")}
                className="hidden min-h-tap items-center gap-1 rounded-lg border border-[color:var(--border)] px-3 text-sm font-semibold sm:inline-flex sm:min-h-10"
              >
                {sort === "az" ? "A–Z" : "Z–A"}
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-5 grid gap-6">
              {grouped.map((group) => (
                <section key={group.kind} aria-labelledby={`group-${group.kind}`}>
                  <h2
                    id={`group-${group.kind}`}
                    className="border-b border-[color:var(--border)] pb-2 text-sm font-extrabold uppercase tracking-kicker text-[color:var(--text-muted)]"
                  >
                    {dictionaryKindLabel(group.kind)}
                  </h2>
                  <div>
                    {group.entries.map((entry) => (
                      <DictionaryResultRow
                        key={entry.slug}
                        hit={{ type: "entry", entry, score: 10, reason: topic.title }}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <div
              id="dictionary-topic-details-phone"
              className="mt-5 grid scroll-mt-page-section border-y border-[color:var(--border)] lg:hidden"
            >
              <details className="border-b border-[color:var(--border)]">
                <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between py-2.5 text-sm font-semibold">
                  About this collection
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </summary>
                <div className="pb-4 text-sm leading-6 text-[color:var(--text-muted)]">
                  <p>{topic.description}</p>
                  <p className="mt-2">Australian terminology · Updated 18 Aug 2026</p>
                </div>
              </details>
              <details className="border-b border-[color:var(--border)]">
                <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between py-2.5 text-sm font-semibold">
                  Related topics
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </summary>
                <div className="grid pb-2">
                  {topic.relatedTopicSlugs.map((slug) => {
                    const related = findDictionaryTopic(slug);
                    return related ? (
                      <DisclosureLink
                        key={slug}
                        title={related.title}
                        summary={`${related.entrySlugs.length} terms`}
                        href={`/dictionary/topics/${slug}`}
                      />
                    ) : null;
                  })}
                </div>
              </details>
              <details>
                <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between py-2.5 text-sm font-semibold">
                  Common comparisons
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </summary>
                <div className="grid pb-2">
                  {topic.curatedComparisons.map(([a, b]) => (
                    <DisclosureLink
                      key={`${a}-${b}`}
                      title={`${allDictionaryEntries.find((entry) => entry.slug === a)?.term ?? a} vs ${allDictionaryEntries.find((entry) => entry.slug === b)?.term ?? b}`}
                      summary="Open comparison"
                      href={`/dictionary/compare?a=${a}&b=${b}`}
                    />
                  ))}
                </div>
              </details>
            </div>
          </div>
          <aside
            id="dictionary-topic-details-desktop"
            aria-label="Collection details"
            className="hidden scroll-mt-page-section border-l border-[color:var(--border)] pl-6 lg:block"
          >
            <h2 className="text-sm font-extrabold text-[color:var(--text-heading)]">About this collection</h2>
            <dl className="mt-3 grid gap-3 text-sm">
              <div>
                <dt className="text-xs font-bold text-[color:var(--text-muted)]">Scope</dt>
                <dd className="mt-1 text-[color:var(--text)]">{topic.description}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold text-[color:var(--text-muted)]">Region</dt>
                <dd className="mt-1 text-[color:var(--text)]">Australian terminology</dd>
              </div>
              <div>
                <dt className="text-xs font-bold text-[color:var(--text-muted)]">Updated</dt>
                <dd className="mt-1 text-[color:var(--text)]">18 Aug 2026</dd>
              </div>
            </dl>
            <h2 className="mt-8 text-sm font-extrabold text-[color:var(--text-heading)]">Related topics</h2>
            {topic.relatedTopicSlugs.map((slug) => {
              const related = findDictionaryTopic(slug);
              return related ? (
                <DisclosureLink
                  key={slug}
                  title={related.title}
                  summary={`${related.entrySlugs.length} terms`}
                  href={`/dictionary/topics/${slug}`}
                />
              ) : null;
            })}
            <h2 className="mt-8 text-sm font-extrabold text-[color:var(--text-heading)]">Common comparisons</h2>
            {topic.curatedComparisons.map(([a, b]) => (
              <DisclosureLink
                key={`${a}-${b}`}
                title={`${allDictionaryEntries.find((entry) => entry.slug === a)?.term ?? a} vs ${allDictionaryEntries.find((entry) => entry.slug === b)?.term ?? b}`}
                summary="Open comparison"
                href={`/dictionary/compare?a=${a}&b=${b}`}
              />
            ))}
          </aside>
        </div>
        <InformationPageFooter>
          Collection scope is descriptive · It is not a clinical lesson or care pathway
        </InformationPageFooter>
      </InformationPageShell>
      <ResultFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        panelId="dictionary-topic-detail-filters"
        testId="dictionary-topic-detail-filters"
        title={`Filter ${topic.title}`}
        groups={groups}
        onClearAll={kinds.length ? () => replace((next) => next.delete("kind")) : undefined}
        summary={{ count: entries.length, noun: entries.length === 1 ? "term" : "terms" }}
        onApply={() => setFilterOpen(false)}
      />
    </>
  );
}
