"use client";

import Link from "next/link";
import { useId, useSyncExternalStore } from "react";

import { Check } from "lucide-react";

import {
  ATTENTION_FILTERS,
  CATEGORY_OPTIONS,
  type CategoryFilter,
  type CmeLogAttention,
} from "@/components/cme/cme-log-shared";
import { CmeDot, CmeToggleRow } from "@/components/cme/cme-work-kit";
import type { CmeEntry } from "@/lib/cme/types";

const WIDE_QUERY = "(min-width: 1024px)";

function subscribeWide(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/**
 * True at `lg+`, where the log's filters sit in a side column instead of a
 * sheet. The server snapshot is `true` so the first paint already holds the
 * column on a wide screen (it is `hidden lg:block`, so a phone never shows
 * it); a phone drops it on hydration. Where `matchMedia` is missing (jsdom),
 * the log uses the sheet alone.
 */
export function useWideLogLayout(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => typeof window.matchMedia === "function" && window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

export type CmeLogFilterPanelProps = {
  readonly availableYears: readonly number[];
  readonly navigationYears?: readonly number[];
  readonly effectiveYear: number;
  readonly setYear: number;
  readonly allYears: boolean;
  readonly onAllYears: (value: boolean) => void;
  readonly onSelectYear: (year: number) => void;
  /** Every entry the year counts read from, override-applied. */
  readonly visibleEntries: readonly CmeEntry[];
  /** The selected year's entries (archived or active, matching `showArchived`). */
  readonly yearEntries: readonly CmeEntry[];
  readonly hasAllYears: boolean;
  readonly categoryFilter: CategoryFilter;
  readonly onCategory: (value: CategoryFilter) => void;
  /** Counts read active or archived records, matching the list. */
  readonly showArchived: boolean;
  /** Which part to show: the category chip's sheet, or the whole filter (the Filter sheet and the `lg+` column). */
  readonly section?: "year" | "category" | "all";
  /** The three audit questions, as chips with a tick when on (the whole filter only). */
  readonly attention?: {
    readonly value: CmeLogAttention | null;
    readonly onChange: (value: CmeLogAttention | null) => void;
  };
  /** The Show archived switch (the whole filter only). */
  readonly onShowArchived?: (value: boolean) => void;
};

/** The short names the chips draw; the full name is read out. */
const CATEGORY_CHIP_SHORT: Record<CategoryFilter, string> = {
  all: "All",
  educational: "Educational",
  reviewing: "Reviewing",
  measuring: "Outcomes",
};

const SEG_ITEM = "cpd-seg__item min-h-tap";
const CHIP = "work-chip min-h-12";

/**
 * The log's filter (work-mode redesign, owner request 6 Oct 2026, mock-up
 * cpd_filter): the year as a segmented switch, the category as chips with
 * their dots, the three audit questions as chips with a tick and a count,
 * and a Show archived switch. On a phone it sits in the Filter sheet (the
 * category chip opens just its own part); at `lg+` it sits in a side column.
 */
export function CmeLogFilterPanel({
  availableYears,
  navigationYears,
  effectiveYear,
  setYear,
  allYears,
  onAllYears,
  onSelectYear,
  visibleEntries,
  yearEntries,
  hasAllYears,
  categoryFilter,
  onCategory,
  showArchived,
  section = "all",
  attention,
  onShowArchived,
}: CmeLogFilterPanelProps) {
  const yearInputId = useId();
  const years = navigationYears
    ? [...new Set([...navigationYears, ...availableYears])].sort((a, b) => b - a)
    : availableYears;
  const categoryQuery = categoryFilter !== "all" ? `&category=${categoryFilter}` : "";
  // The switch reads oldest to newest, as the mock-up draws "2025 | 2026".
  const ordered = [...years].sort((a, b) => a - b);

  return (
    <div className="grid gap-4 text-sm">
      {section !== "category" ? (
        <nav aria-label="Select year" data-testid="cme-log-year-tabs" className="grid gap-2">
          <p aria-hidden="true" className="work-label m-0">
            Year
          </p>
          <div className="cpd-seg flex-wrap">
            {ordered.map((year) => {
              const selected = !allYears && effectiveYear === year;
              return navigationYears && year !== effectiveYear ? (
                <Link key={year} href={`/cme/log?year=${year}${categoryQuery}`} className={SEG_ITEM}>
                  <span className="nums font-normal">{year}</span>
                </Link>
              ) : (
                <button
                  key={year}
                  type="button"
                  aria-pressed={selected}
                  aria-current={navigationYears && selected ? "page" : undefined}
                  onClick={() => {
                    onAllYears(false);
                    if (!navigationYears) onSelectYear(year);
                  }}
                  className={SEG_ITEM}
                >
                  <span className="nums font-normal">{year}</span>
                </button>
              );
            })}
            {hasAllYears ? (
              <button type="button" aria-pressed={allYears} onClick={() => onAllYears(true)} className={SEG_ITEM}>
                All years ·{" "}
                <span className="nums font-normal">
                  {visibleEntries.filter((entry) => Boolean(entry.archivedAt) === showArchived).length}
                </span>
              </button>
            ) : null}
          </div>
          {navigationYears ? (
            <form action="/cme/log" method="get" className="flex items-end gap-2" data-testid="cme-log-year-jump">
              <label
                className="grid min-w-0 flex-1 gap-1 text-xs font-semibold text-[color:var(--text-muted)]"
                htmlFor={yearInputId}
              >
                Open another year
                <input
                  key={setYear}
                  id={yearInputId}
                  name="year"
                  type="number"
                  inputMode="numeric"
                  min="2000"
                  max="2100"
                  defaultValue={setYear}
                  className="nums block min-h-tap w-full rounded-[var(--work-radius-field)] border border-[color:var(--work-line-strong)] bg-[color:var(--work-surface)] px-3 text-sm font-normal text-[color:var(--text-heading)]"
                />
              </label>
              <button type="submit" className="work-button min-h-tap shrink-0" data-variant="secondary">
                Open year
              </button>
            </form>
          ) : null}
        </nav>
      ) : null}

      {section !== "year" ? (
        <fieldset className="m-0 grid gap-1 border-0 p-0" data-testid="cme-log-filter">
          <legend className="work-label mb-1 p-0">Category</legend>
          <div className="work-chips">
            {CATEGORY_OPTIONS.map((option) => {
              const pressed = categoryFilter === option.value;
              const count =
                option.value === "all"
                  ? yearEntries.length
                  : yearEntries.filter((entry) =>
                      entry.allocations.some((allocation) => allocation.category === option.value),
                    ).length;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => onCategory(option.value)}
                  className={CHIP}
                >
                  {option.value !== "all" ? <CmeDot cat={option.value} /> : null}
                  <span aria-hidden="true">{CATEGORY_CHIP_SHORT[option.value]}</span>
                  <span className="sr-only">{`${option.label}, ${count}`}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {section === "all" && attention && !showArchived ? (
        <fieldset className="m-0 grid gap-1 border-0 p-0" data-testid="cme-log-filter-attention">
          <legend className="work-label mb-1 p-0">Needs attention</legend>
          <div className="work-chips">
            {ATTENTION_FILTERS.map((filter) => {
              const pressed = attention.value === filter.value;
              const count = yearEntries.filter(filter.matches).length;
              return (
                <button
                  key={filter.value}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => attention.onChange(pressed ? null : filter.value)}
                  className={CHIP}
                >
                  {pressed ? <Check aria-hidden="true" strokeWidth={2.4} /> : null}
                  {filter.label}
                  <span className="work-chip__count nums font-normal">{count}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {section === "all" && onShowArchived ? (
        <div className="work-card">
          <CmeToggleRow
            label="Show archived"
            sub="Archived activities add nothing to totals"
            checked={showArchived}
            onChange={onShowArchived}
            testId="cme-log-filter-archived"
          />
        </div>
      ) : null}
    </div>
  );
}
