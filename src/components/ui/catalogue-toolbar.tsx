"use client";

import type { ChangeEvent, ReactNode } from "react";
import { Filter, Search } from "lucide-react";

import { cn } from "@/components/ui-primitives";
import { AppliedFilters, type AppliedFilter } from "@/components/ui/applied-filters";
import { TextField } from "@/components/ui/text-field";
import { Select } from "@/components/ui/select";

export type CatalogueToolbarSearchProps = {
  query: string;
  onQueryChange: (query: string) => void;
  placeholder?: string;
  label?: string;
  hideLabel?: boolean;
  disabled?: boolean;
  className?: string;
};

export type CatalogueToolbarSortProps = {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  label?: string;
  hideLabel?: boolean;
  disabled?: boolean;
  className?: string;
};

export type CatalogueToolbarFilterTriggerProps = {
  open?: boolean;
  onToggle: () => void;
  activeCount?: number;
  label?: string;
  panelId?: string;
  testId?: string;
  disabled?: boolean;
};

export type CatalogueToolbarProps = {
  /** Search control configuration or custom node. */
  search?: CatalogueToolbarSearchProps | ReactNode;
  /** Sort select configuration or custom node. */
  sort?: CatalogueToolbarSortProps | ReactNode;
  /** Filter trigger configuration or custom trigger. */
  filterTrigger?: CatalogueToolbarFilterTriggerProps | ReactNode;
  /** Active filter chips shown below or alongside the toolbar. */
  appliedFilters?: readonly AppliedFilter[];
  /** Callback when the user clears all applied filters. */
  onClearFilters?: () => void;
  /** Match count / results readout. */
  matchCount?: number;
  /** Noun for match count (e.g. "mechanism", "specifier", "differential"). */
  noun?: string;
  /** Status of the catalogue search. */
  status?: "ready" | "loading" | "refetching" | "error" | "unauthorized";
  /** Additional action items (e.g. Compare, View toggle, Create/Build). */
  actions?: ReactNode;
  /** Children rendered in the main controls row or below. */
  children?: ReactNode;
  className?: string;
  testId?: string;
};

function isSearchProps(search: CatalogueToolbarSearchProps | ReactNode): search is CatalogueToolbarSearchProps {
  return typeof search === "object" && search !== null && "query" in search && "onQueryChange" in search;
}

function isSortProps(sort: CatalogueToolbarSortProps | ReactNode): sort is CatalogueToolbarSortProps {
  return typeof sort === "object" && sort !== null && "value" in sort && "onChange" in sort && "options" in sort;
}

function isFilterTriggerProps(
  filter: CatalogueToolbarFilterTriggerProps | ReactNode,
): filter is CatalogueToolbarFilterTriggerProps {
  return typeof filter === "object" && filter !== null && "onToggle" in filter;
}

/**
 * Standardized Catalogue Toolbar (`<CatalogueToolbar />`) component.
 *
 * Consolidates search, sort, filter triggers, applied filter chips, and action
 * controls into a single coherent, accessible responsive bar for catalogue surfaces
 * (Differentials, Formulations, Specifiers, Services, Factsheets).
 */
export function CatalogueToolbar({
  search,
  sort,
  filterTrigger,
  appliedFilters = [],
  onClearFilters,
  matchCount,
  noun = "item",
  status = "ready",
  actions,
  children,
  className,
  testId = "catalogue-toolbar",
}: CatalogueToolbarProps) {
  const pluralNoun = noun.endsWith("s") ? noun : `${noun}s`;
  const singularNoun = noun;
  const countLabel =
    typeof matchCount === "number" ? `${matchCount} ${matchCount === 1 ? singularNoun : pluralNoun}` : null;

  return (
    <div data-testid={testId} className={cn("flex flex-col gap-3", className)}>
      {/* Primary Toolbar Row */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
          {/* Search control */}
          {search ? (
            <div className="min-w-[200px] flex-1 max-w-md">
              {isSearchProps(search) ? (
                <TextField
                  label={search.label ?? `Search ${pluralNoun}`}
                  hideLabel={search.hideLabel ?? true}
                  icon={Search}
                  value={search.query}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => search.onQueryChange(e.target.value)}
                  placeholder={search.placeholder ?? `Search ${pluralNoun}…`}
                  disabled={search.disabled}
                  className={cn("font-semibold", search.className)}
                />
              ) : (
                search
              )}
            </div>
          ) : null}

          {/* Sort control */}
          {sort ? (
            <div className="min-w-[140px] shrink-0">
              {isSortProps(sort) ? (
                <Select
                  label={sort.label ?? `Sort ${pluralNoun}`}
                  hideLabel={sort.hideLabel ?? true}
                  value={sort.value}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => sort.onChange(e.target.value)}
                  options={[...sort.options]}
                  disabled={sort.disabled}
                  className={cn("font-semibold", sort.className)}
                />
              ) : (
                sort
              )}
            </div>
          ) : null}

          {/* Filter trigger button */}
          {filterTrigger ? (
            <div className="shrink-0">
              {isFilterTriggerProps(filterTrigger) ? (
                <button
                  type="button"
                  data-testid={filterTrigger.testId ?? "catalogue-filter-trigger"}
                  aria-expanded={filterTrigger.open}
                  aria-controls={filterTrigger.panelId}
                  disabled={filterTrigger.disabled}
                  onClick={filterTrigger.onToggle}
                  className={cn(
                    "inline-flex min-h-tap items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-bold transition",
                    filterTrigger.open || (filterTrigger.activeCount ?? 0) > 0
                      ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-heading)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)]",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
                  )}
                >
                  <Filter className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{filterTrigger.label ?? "Filter"}</span>
                  {(filterTrigger.activeCount ?? 0) > 0 ? (
                    <span
                      data-testid="catalogue-filter-badge"
                      className="grid h-5 min-w-5 place-items-center rounded-full bg-[color:var(--clinical-accent)] px-1 text-3xs font-black text-[color:var(--clinical-accent-contrast)]"
                    >
                      {filterTrigger.activeCount}
                    </span>
                  ) : null}
                </button>
              ) : (
                filterTrigger
              )}
            </div>
          ) : null}

          {/* Optional inline custom children */}
          {children}
        </div>

        {/* Right side: Count readout & Actions */}
        <div className="flex items-center gap-3 shrink-0">
          {countLabel ? (
            <span
              data-testid="catalogue-match-count"
              data-status={status}
              className={cn(
                "text-xs font-semibold text-[color:var(--text-muted)]",
                status === "refetching" && "opacity-75 animate-pulse",
              )}
            >
              {countLabel}
            </span>
          ) : null}

          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      </div>

      <AppliedFilters
        filters={appliedFilters}
        onClearAll={onClearFilters}
        className="pt-1"
        testId="catalogue-applied-filters"
        chipTestId="catalogue-applied-chip"
        clearTestId="catalogue-clear-filters"
      />
    </div>
  );
}
