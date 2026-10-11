"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Info, LayoutGrid, List, SearchX } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { SearchResultsHeaderBand } from "@/components/clinical-dashboard/search-results-header-band";
import { UniversalSearchAlsoMatches } from "@/components/clinical-dashboard/universal-search-also-matches";
import {
  ResultFilterSheet,
  ResultFilterTrigger,
  resultFilterGroup,
  type ResultFilterOption,
} from "@/components/clinical-dashboard/result-filter-control";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { FactsheetListRow } from "@/components/factsheets/factsheet-list-row";
import {
  categoryTheme,
  factsheetCategories,
  factsheetDetailHref,
  filterFactsheets,
  type Factsheet,
} from "@/components/factsheets/factsheets-data";
import { factsheetGlyph } from "@/components/factsheets/factsheets-icons";
import { pageHeadingEyebrowClass, pageHeadingTitleClass } from "@/components/ui/page-header";
import { cn } from "@/components/ui-primitives";

type ViewMode = "list" | "cards";

function searchHref(query: string, category?: string) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (category) params.set("category", category);
  const suffix = params.toString();
  return suffix ? `/factsheets/search?${suffix}` : "/factsheets/search";
}

export function FactsheetsSearchPage({
  query,
  category,
  expansions = [],
  results,
}: {
  query: string;
  category?: string;
  expansions?: readonly string[];
  results: Factsheet[];
}) {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("list");
  const activeCategory = factsheetCategories.find((entry) => entry === category);
  const filterPanelId = useId();
  const categoryDeadEndNoteId = useId();
  const [filterOpen, setFilterOpen] = useState(false);

  // Category genuinely narrows within the current search — `filterFactsheets`
  // ANDs query and category — unlike services' quick filters or formulation's
  // old pattern presets, which replaced the query outright. So this is a real
  // lens (docs/filter-contract.md section 1), not something to evict.
  //
  // Query-matched, category-UNfiltered, so a hint answers "how many for this
  // category, at the current query". Derive the option list from those matches:
  // unrelated zero-member categories do not exist. A selected category that the
  // query has narrowed to zero stays visible as a disabled, explained dead end
  // so URL state remains truthful and the available options provide an escape.
  const queryMatches = useMemo(() => filterFactsheets(query, undefined, expansions), [expansions, query]);
  const categoryOptions = useMemo<ReadonlyArray<ResultFilterOption<string>>>(() => {
    const categoryCounts = new Map<string, number>();
    for (const sheet of queryMatches) {
      categoryCounts.set(sheet.category, (categoryCounts.get(sheet.category) ?? 0) + 1);
    }

    const options: ResultFilterOption<string>[] = [{ value: "all", label: "All", hint: String(queryMatches.length) }];
    for (const entry of factsheetCategories) {
      const count = categoryCounts.get(entry) ?? 0;
      if (count === 0 && entry !== activeCategory) continue;
      options.push({
        value: entry,
        label: entry,
        hint: String(count),
        disabled: count === 0,
      });
    }
    return options;
  }, [activeCategory, queryMatches]);
  const activeCategoryIsDeadEnd = Boolean(
    activeCategory && categoryOptions.find((option) => option.value === activeCategory)?.disabled,
  );
  const activeCategoryDeadEndMessage = activeCategoryIsDeadEnd
    ? `No results in ${activeCategory} for this search. Choose All or another available category.`
    : undefined;
  const applyCategory = (value: string) => {
    const option = categoryOptions.find((entry) => entry.value === value);
    if (!option || option.disabled) return;
    setFilterOpen(false);
    router.replace(searchHref(query, value === "all" ? undefined : value), { scroll: false });
  };

  return (
    <div
      data-testid="factsheets-search-page"
      className="mx-auto w-full max-w-reading px-4 py-6 pb-4 sm:px-6 sm:py-8 lg:px-8"
    >
      <p className={pageHeadingEyebrowClass}>Find a sheet</p>
      <h1 className={cn("mt-1.5", pageHeadingTitleClass)}>Search patient information</h1>

      <SearchResultsHeaderBand
        modeId="factsheets"
        query={query}
        matchCount={results.length}
        className="mt-4"
        filterLabel="Filter factsheets by category"
        // A compact badged trigger, so it shares the count line.
        mobileControlsPlacement="inline"
        mobileControls={
          <ResultFilterTrigger
            panelId={filterPanelId}
            testId="factsheet-filter-trigger-phone"
            title="Filter factsheets"
            open={filterOpen}
            activeCount={activeCategory ? 1 : 0}
            onToggle={() => setFilterOpen((current) => !current)}
          />
        }
        // The same control the sheet renders below, sharing `categoryOptions` —
        // the two breakpoints used to disagree on renderer (raw `<Link>` chips
        // here, a real radiogroup in the sheet) even though the VALUES already
        // agreed. One shared array is what stops that drifting again.
        filterControls={
          <div className="grid min-w-0 gap-1.5">
            <SegmentedControl
              label="Category"
              value={activeCategory ?? "all"}
              onChange={applyCategory}
              options={categoryOptions}
              ariaDescribedBy={activeCategoryDeadEndMessage ? categoryDeadEndNoteId : undefined}
            />
            {activeCategoryDeadEndMessage ? (
              <p
                id={categoryDeadEndNoteId}
                data-testid="factsheet-category-dead-end"
                className="text-xs font-medium leading-5 text-[color:var(--text-muted)]"
              >
                {activeCategoryDeadEndMessage}
              </p>
            ) : null}
          </div>
        }
      />

      <div className="mt-3 flex items-center justify-end gap-2" data-testid="factsheets-view-toolbar">
        <span className="text-3xs font-extrabold uppercase tracking-kicker text-[color:var(--text-muted)]">View</span>
        <div
          role="group"
          aria-label="Result view"
          className="inline-flex min-h-tap overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-inset)] sm:min-h-10"
        >
          {(["list", "cards"] as const).map((mode) => {
            const isActive = view === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                aria-pressed={isActive}
                className={cn(
                  "inline-flex min-h-tap items-center gap-1.5 px-2.5 text-xs font-bold capitalize transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:min-h-10",
                  mode === "cards" && "border-l border-[color:var(--border)]",
                  isActive
                    ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                    : "text-[color:var(--text-muted)] hover:text-[color:var(--text)]",
                )}
              >
                {mode === "list" ? (
                  <List className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span className="max-[389px]:sr-only">{mode}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Phone-only by construction: the trigger that opens it lives in the
          ribbon's `mobileControls` slot, which the band hides from `sm` up.
          Selecting a category is replacement navigation here, so the sheet closes
          before the route updates and repeated filtering does not pollute Back. */}
      <ResultFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        panelId={filterPanelId}
        testId="factsheet-filter-panel"
        title="Filter factsheets"
        groups={[
          resultFilterGroup({
            id: "category",
            label: "Category",
            description: activeCategoryDeadEndMessage,
            value: activeCategory ?? "all",
            options: categoryOptions,
            onChange: applyCategory,
          }),
        ]}
        onClearAll={activeCategory ? () => applyCategory("all") : undefined}
        summary={{ count: results.length, noun: results.length === 1 ? "factsheet" : "factsheets" }}
      />

      {results.length === 0 ? (
        <section className="mt-4 grid justify-items-center gap-3 rounded-xl border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-inset)] px-4 py-12 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--decoration-soft)]">
            <SearchX className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-base font-bold text-[color:var(--text-heading)]">No factsheets found</p>
            <p className="mt-1 text-sm-minus font-medium text-[color:var(--text-muted)]">
              Try a broader topic, or browse the full library.
            </p>
          </div>
          <Link
            href="/factsheets/search"
            className="inline-flex min-h-tap items-center rounded-lg bg-[color:var(--command)] px-4 text-sm font-bold text-[color:var(--command-contrast)] shadow-[var(--e1)] transition hover:bg-[color:var(--command-hover)]"
          >
            Browse sheets
          </Link>
        </section>
      ) : view === "list" ? (
        <section
          aria-label="Factsheet results"
          className="mt-4 overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-inset)]"
        >
          {results.map((sheet) => (
            <FactsheetListRow key={sheet.slug} sheet={sheet} />
          ))}
        </section>
      ) : (
        <section aria-label="Factsheet results" className="mt-4 grid gap-3.5 sm:grid-cols-2">
          {results.map((sheet) => {
            const theme = categoryTheme(sheet.category);
            return (
              <Link
                key={sheet.slug}
                href={factsheetDetailHref(sheet.slug)}
                data-testid="factsheets-result"
                className="group flex flex-col rounded-xl border border-[color:var(--border)] border-t-[3px] bg-[color:var(--surface)] p-4 shadow-[var(--e2)] transition hover:border-[color:var(--border-strong)] hover:shadow-[var(--shadow-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                style={{ borderTopColor: theme.accent }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="grid h-10 w-10 place-items-center rounded-xl"
                    style={{ backgroundColor: theme.soft, color: theme.accent }}
                  >
                    {factsheetGlyph(sheet.icon, "h-5 w-5")}
                  </span>
                  <span
                    className="rounded-md px-2 py-1 text-2xs font-bold"
                    style={{ backgroundColor: theme.soft, color: theme.accent }}
                  >
                    {sheet.category}
                  </span>
                </div>
                <h3 className="mt-3.5 text-base-minus font-bold text-[color:var(--text-heading)] group-hover:text-[color:var(--clinical-accent)]">
                  {sheet.title}
                  {sheet.brand ? (
                    <span className="font-medium text-[color:var(--text-muted)]"> {sheet.brand}</span>
                  ) : null}
                </h3>
                <p className="mt-2 flex-1 text-pretty text-sm-minus leading-5 text-[color:var(--text-muted)]">
                  {sheet.summary}
                </p>
                <p className="mt-3.5 text-xs font-bold text-[color:var(--text-muted)]">
                  {sheet.audience} · {sheet.readTime}
                </p>
              </Link>
            );
          })}
        </section>
      )}

      <UniversalSearchAlsoMatches modeId="factsheets" query={query} className="mt-5" />

      <aside className="mt-5 flex gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--info)]" aria-hidden="true" />
        <p className="text-sm-minus leading-5 text-[color:var(--text-muted)]">
          <strong className="font-bold text-[color:var(--text-heading)]">Content status:</strong> These sheets are dated
          demonstration content with public source links. Connect only governance-approved patient information before
          publication.
        </p>
      </aside>
    </div>
  );
}
