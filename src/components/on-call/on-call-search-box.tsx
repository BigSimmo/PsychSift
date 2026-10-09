"use client";

import { ChevronRight, SearchX } from "lucide-react";
import { useMemo, useState } from "react";

import { OnCallEntryRow } from "@/components/on-call/on-call-entry-row";
import { OnCallPrivateFlag } from "@/components/on-call/on-call-private-flag";
import {
  ON_CALL_VIEW_ICONS,
  ON_CALL_VIEW_TITLES,
  type OnCallPageView,
} from "@/components/on-call/on-call-section-identity";
import { focusOnCallEntryFromHash } from "@/components/on-call/on-call-page-anchors";
import { onCallEntryHref, onCallViewForEntry } from "@/components/on-call/on-call-entry-view";
import { OnCallEmptyState } from "@/components/on-call/kit/empty-state";
import { SearchField } from "@/components/ui/text-field";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import {
  ON_CALL_SEARCH_RESULT_LIMIT,
  onCallSearchSummary,
  searchOnCallEntries,
  type OnCallSearchResult,
} from "@/lib/on-call/entry-search";
import { type OnCallEntry } from "@/lib/on-call/entry-model";
import { onCallPrimaryNumber, onCallTelHref } from "@/lib/on-call/home-modules";

/**
 * One box across the whole of On Call.
 *
 * The mode is seven pages of the owner's own reference material, and until now
 * the only way to reach a number was to know which page held it. This is the
 * shortcut: type, and every page answers at once, each result still wearing the
 * glyph of the page it is on so the reader can see WHERE the answer came from
 * before they tap it. "The page it is on" is not always "the section it is
 * stored in" — Compliance and Who's who are views over `logistics` and
 * `contacts` — so every destination, heading and glyph in here goes through
 * `onCallViewForEntry`.
 *
 * Deliberately quiet when idle. An empty box renders no list, no placeholder
 * rows and no "start typing" card — the home this sits on is a dashboard for
 * the shift, and furniture above its modules pushes them below the fold for a
 * reader who was not searching at all.
 *
 * The matching itself is `src/lib/on-call/entry-search.ts`; nothing in here
 * decides what a match is.
 */

/** Row shape shared by the dialable and the non-dialable case. */
function SearchResultRow({ result }: { result: OnCallSearchResult }) {
  const { entry } = result;
  // The same private treatment Contacts and the home use: a personal number is
  // withheld from the screen, not from the owner — they can still open the
  // entry to read it. See `on-call-home.tsx`, the Recent module, which sets
  // `number` to null on `entry.isPersonal` for exactly this reason. A search
  // box is the MOST over-shoulder-readable surface in the mode, so this is not
  // a nicety here.
  const number = entry.isPersonal ? null : onCallPrimaryNumber(entry);
  const telHref = number?.label === "Ext" || number?.label === "Pager" ? undefined : onCallTelHref(number?.value);
  const summary = onCallSearchSummary(entry);
  // The page this row is RENDERED on, which is not always the section it is
  // stored in: Compliance and Who's who are views over `logistics` and
  // `contacts`. `ON_CALL_SECTION_HREFS[entry.section]` sent a compliance
  // requirement to the Admin page, where it is not in the list — a search that
  // finds the thing and then navigates away from it.

  return (
    <OnCallEntryRow
      title={entry.title}
      subtitle={summary ?? undefined}
      href={onCallEntryHref(entry)}
      onActivate={() => requestAnimationFrame(focusOnCallEntryFromHash)}
      testId={`on-call-search-row-${entry.slug}`}
      trailing={
        telHref && number ? (
          <span className="flex items-center gap-2">
            <span className="nums text-sm font-normal text-[color:var(--text-heading)]">{number.value}</span>
            {/* The row opens this exact record; the chevron is decoration. */}
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-full bg-[color:var(--command)] text-[color:var(--command-contrast)]"
            >
              <ChevronRight aria-hidden="true" className="size-icon-sm" />
            </span>
          </span>
        ) : (
          <ChevronRight aria-hidden="true" className={cn("size-icon-sm shrink-0", textMuted)} />
        )
      }
    >
      {entry.isPersonal ? <OnCallPrivateFlag compact /> : null}
    </OnCallEntryRow>
  );
}

/**
 * Results for one page, under that page's own name and glyph.
 *
 * Keyed by view rather than by section so a compliance requirement is announced
 * as Compliance and a role explainer as Who's who. Grouping by section labelled
 * both of them with the name of a page they are not on, which is worse than no
 * grouping at all: the heading is the reader's evidence of WHERE the answer
 * came from before they tap it.
 */
function SearchResultGroup({ view, results }: { view: OnCallPageView; results: readonly OnCallSearchResult[] }) {
  const Icon = ON_CALL_VIEW_ICONS[view];
  return (
    <section
      aria-label={ON_CALL_VIEW_TITLES[view]}
      data-testid={`on-call-search-group-${view}`}
      className="grid grid-cols-[minmax(0,1fr)] gap-2"
    >
      <h3 className={cn(eyebrowText, "flex items-center gap-1.5")}>
        <Icon aria-hidden="true" className="size-icon-xs" />
        {ON_CALL_VIEW_TITLES[view]}
      </h3>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {results.map((result) => (
          <SearchResultRow key={result.entry.id} result={result} />
        ))}
      </div>
    </section>
  );
}

/**
 * Group in result order, so the best-matching page leads.
 *
 * `result.section` is deliberately not the key. It is the stored section, and
 * two of this mode's pages are views over one — grouping by it files a
 * compliance requirement under Admin. `onCallViewForEntry` is the one place
 * that mapping lives.
 */
function groupByView(results: readonly OnCallSearchResult[]): Array<[OnCallPageView, OnCallSearchResult[]]> {
  const groups = new Map<OnCallPageView, OnCallSearchResult[]>();
  for (const result of results) {
    const view = onCallViewForEntry(result.entry);
    const existing = groups.get(view);
    if (existing) existing.push(result);
    else groups.set(view, [result]);
  }
  return [...groups.entries()];
}

export function OnCallSearchBox({ entries }: { entries: readonly OnCallEntry[] }) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const results = useMemo(() => searchOnCallEntries(entries, query), [entries, query]);
  const groups = useMemo(() => groupByView(results), [results]);

  // The count goes to assistive technology only. Putting `aria-live` on the
  // visible list would re-read every row on every keystroke, which is the
  // opposite of useful; a short sentence off-screen says the one thing a
  // sighted reader can already see at a glance.
  const announcement =
    trimmed.length === 0
      ? ""
      : results.length === 0
        ? `Nothing matched “${trimmed}”.`
        : `${results.length} result${results.length === 1 ? "" : "s"} for “${trimmed}”.`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3" data-testid="on-call-search">
      <SearchField
        label="Search On Call"
        placeholder="Search numbers, wards, scenarios"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onClear={() => setQuery("")}
        clearLabel="Clear the On Call search"
        autoComplete="off"
      />

      <p role="status" aria-live="polite" data-testid="on-call-search-status" className="sr-only">
        {announcement}
      </p>

      {trimmed.length > 0 && results.length === 0 ? (
        <OnCallEmptyState
          icon={SearchX}
          title={`Nothing matched “${trimmed}”`}
          body="Try a shorter word, a ward name, or part of the number."
          testId="on-call-search-empty"
          // Announced above already; a second live region would say it twice.
          live="off"
        />
      ) : null}

      {results.length > 0 ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4" data-testid="on-call-search-results">
          {groups.map(([view, viewResults]) => (
            <SearchResultGroup key={view} view={view} results={viewResults} />
          ))}
          {/* Honest about the cap rather than quietly showing a partial list as
              though it were the whole answer. */}
          {results.length === ON_CALL_SEARCH_RESULT_LIMIT ? (
            <p className={cn(textMuted, "text-xs")} data-testid="on-call-search-capped">
              Showing the first {ON_CALL_SEARCH_RESULT_LIMIT} matches. Add a word to narrow them.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
