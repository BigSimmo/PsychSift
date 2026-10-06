"use client";

import Link from "next/link";
import { useId, useSyncExternalStore } from "react";

import { CATEGORY_OPTIONS, type CategoryFilter } from "@/components/cme/cme-log-shared";
import { cn, eyebrowText } from "@/components/ui-primitives";
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

const choiceRow =
  "flex min-h-tap items-center justify-between gap-3 rounded-lg border px-3 text-left text-sm text-[color:var(--text)] transition-colors duration-[var(--duration-instant)]";
const choiceIdle = "border-[color:var(--border)] hover:bg-[color:var(--surface-subtle)]";
const choicePressed =
  "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]";
const countText = "nums font-normal text-[color:var(--text-muted)]";

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
  /** Which part to show: the year picker's sheet, the category chip's sheet, or both (the `lg+` side column). */
  readonly section?: "year" | "category" | "all";
};

/**
 * The year (with another year by number) and the category: what narrows the
 * log but is not needed on every visit. On a phone the year button and the
 * category chip each open a sheet holding their own part; at `lg+` both sit
 * in a side column. Archived records are a link at the foot of the log.
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
}: CmeLogFilterPanelProps) {
  const yearInputId = useId();
  const years = navigationYears
    ? [...new Set([...navigationYears, ...availableYears])].sort((a, b) => b - a)
    : availableYears;
  const countFor = (year: number) =>
    visibleEntries.filter((entry) => entry.date.startsWith(`${year}-`) && Boolean(entry.archivedAt) === showArchived)
      .length;
  const categoryQuery = categoryFilter !== "all" ? `&category=${categoryFilter}` : "";

  return (
    <div className="grid gap-5 text-sm">
      {section !== "category" ? (
        <nav aria-label="Select year" data-testid="cme-log-year-tabs" className="grid gap-2">
          <p aria-hidden="true" className={eyebrowText}>
            Year
          </p>
          {hasAllYears ? (
            <button
              type="button"
              aria-pressed={allYears}
              onClick={() => onAllYears(true)}
              className={cn(choiceRow, allYears ? choicePressed : choiceIdle)}
            >
              All years · {visibleEntries.filter((entry) => Boolean(entry.archivedAt) === showArchived).length}
            </button>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            {years.map((year) => {
              const count = countFor(year);
              const selected = !allYears && effectiveYear === year;
              return navigationYears && year !== effectiveYear ? (
                <Link key={year} href={`/cme/log?year=${year}${categoryQuery}`} className={cn(choiceRow, choiceIdle)}>
                  <span>{year}</span> <span className={countText}>{count || "Open"}</span>
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
                  className={cn(choiceRow, selected ? choicePressed : choiceIdle)}
                >
                  <span>{year}</span> <span className={countText}>{count}</span>
                </button>
              );
            })}
          </div>
          {navigationYears ? (
            <form action="/cme/log" method="get" className="flex items-end gap-2" data-testid="cme-log-year-jump">
              <label className="grid min-w-0 flex-1 gap-1 font-medium text-[color:var(--text)]" htmlFor={yearInputId}>
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
                  className="block min-h-tap w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 nums font-normal"
                />
              </label>
              <button
                type="submit"
                className="inline-flex min-h-tap shrink-0 items-center rounded-lg border border-[color:var(--border)] px-4 font-medium text-[color:var(--text)]"
              >
                Open year
              </button>
            </form>
          ) : null}
        </nav>
      ) : null}

      {section !== "year" ? (
        <fieldset className="grid gap-2" data-testid="cme-log-filter">
          <legend className={cn(eyebrowText, "mb-2")}>Category</legend>
          {CATEGORY_OPTIONS.map((option) => {
            const pressed = categoryFilter === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={pressed}
                onClick={() => onCategory(option.value)}
                className={cn(choiceRow, pressed ? choicePressed : choiceIdle)}
              >
                <span>{option.label}</span>{" "}
                <span className={countText}>
                  {option.value === "all"
                    ? yearEntries.length
                    : yearEntries.filter((entry) =>
                        entry.allocations.some((allocation) => allocation.category === option.value),
                      ).length}
                </span>
              </button>
            );
          })}
        </fieldset>
      ) : null}
    </div>
  );
}
