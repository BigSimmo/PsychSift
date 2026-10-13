"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowRight, Search } from "lucide-react";

import { filterCompareCatalog, padCompareIds, slotLetters } from "@/components/compare/filter-catalog";
import type { CompareCatalogItem, CompareStarterChip } from "@/components/compare/types";
import { cn, searchShell, searchShellInput } from "@/components/ui-primitives";

export function CompareCatalogPicker({
  items,
  query,
  onQueryChange,
  selectedIds,
  maxCount,
  activeSlot,
  onActiveSlotChange,
  onChoose,
  onDone,
  onReset,
  searchPlaceholder,
  emptyHint,
  announcement,
  filterLocally = true,
  title,
  titleId,
  starters,
  hideActions = false,
}: {
  items: readonly CompareCatalogItem[];
  query: string;
  onQueryChange: (query: string) => void;
  selectedIds: readonly (string | null | undefined)[];
  maxCount?: number;
  activeSlot: number;
  onActiveSlotChange?: (index: number) => void;
  onChoose: (id: string) => void;
  onDone?: () => void;
  onReset?: () => void;
  searchPlaceholder: string;
  emptyHint?: string;
  announcement?: string;
  filterLocally?: boolean;
  title?: string;
  titleId?: string;
  starters?: readonly CompareStarterChip[];
  /**
   * Leave Done and Reset out of the body. The phone sheet passes them as its pinned
   * footer instead (see `ComparePickerActions`), so they stay on screen while the list
   * scrolls above them.
   */
  hideActions?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const highlightScope = `${query}::${activeSlot}`;
  const [highlightState, setHighlightState] = useState({ scope: highlightScope, index: 0 });
  // Keep highlight scoped to the current query/slot during render — do not reset in an effect.
  if (highlightState.scope !== highlightScope) {
    setHighlightState({ scope: highlightScope, index: 0 });
  }
  const highlight = highlightState.scope === highlightScope ? highlightState.index : 0;
  const count = maxCount ?? Math.max(selectedIds.length, 1);
  const slots = padCompareIds(selectedIds, count);
  const labels = slotLetters(count);
  const hits = useMemo(
    () => (filterLocally ? filterCompareCatalog(items, query) : items).slice(0, 12),
    [filterLocally, items, query],
  );
  const taken = new Set(slots.filter((id): id is string => Boolean(id)));
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [activeSlot]);

  function choose(id: string) {
    if (taken.has(id) && slots[activeSlot] !== id) return;
    onChoose(id);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!hits.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightState({ scope: highlightScope, index: (highlight + 1) % hits.length });
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightState({ scope: highlightScope, index: (highlight - 1 + hits.length) % hits.length });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[highlight];
      if (hit) choose(hit.id);
    }
  }

  return (
    <div className="grid gap-3">
      {/* The heading stays in the tree for structure and for anything pointing at
          `titleId`, but it is not drawn: every caller wraps this picker in
          `ComparePickerShell`, which already prints the same title above it — on
          desktop as the panel heading, on a phone as the sheet's. Two identical
          headings, one under the other, read as a rendering fault. */}
      {title ? (
        <h2 id={titleId} className="sr-only">
          {title}
        </h2>
      ) : null}
      {labels.length > 1 && onActiveSlotChange ? (
        <div
          className={cn(
            "grid items-center gap-2",
            labels.length === 2 ? "grid-cols-2" : labels.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3",
          )}
          role="tablist"
          aria-label="Active comparison slot"
        >
          {labels.map((label, index) => {
            const selected = slots[index];
            const item = selected ? itemById.get(selected) : undefined;
            return (
              <button
                key={`${label}-${index}`}
                type="button"
                role="tab"
                aria-selected={activeSlot === index}
                onClick={() => onActiveSlotChange(index)}
                className={cn(
                  "grid min-h-tap grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-xl border px-2.5 text-left text-xs font-bold transition-colors",
                  activeSlot === index
                    ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)]"
                    : "border-[color:var(--border)] bg-[color:var(--surface)] hover:border-[color:var(--clinical-accent-border)]",
                )}
              >
                <span
                  className={cn(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-full border text-2xs font-extrabold",
                    activeSlot === index
                      ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--surface)] text-[color:var(--clinical-accent)]"
                      : "border-[color:var(--border-strong)] bg-[color:var(--surface-inset)] text-[color:var(--text-muted)]",
                  )}
                >
                  {label}
                </span>
                <span
                  className={cn(
                    "truncate",
                    item?.title ? "text-[color:var(--text-heading)]" : "text-[color:var(--text-muted)]",
                  )}
                >
                  {item?.title ?? "Choose"}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      <label htmlFor={inputId} className={searchShell}>
        <Search className="size-icon-sm text-[color:var(--decoration-soft)]" aria-hidden="true" />
        <span className="sr-only">{searchPlaceholder}</span>
        <input
          ref={inputRef}
          id={inputId}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={searchPlaceholder}
          className={cn(searchShellInput, "text-base sm:text-sm")}
        />
      </label>
      {!query.trim() && starters?.length ? (
        <div className="flex flex-wrap gap-2">
          {starters.map((chip) => (
            <Link
              key={chip.id}
              href={chip.href}
              className="inline-flex min-h-tap items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-xs font-bold"
            >
              {chip.label}
            </Link>
          ))}
        </div>
      ) : null}
      <div
        className="max-h-[24rem] overflow-y-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]"
        role="listbox"
        // The options are named; the list they belong to was not, so a screen
        // reader announced the items without ever saying what was being chosen.
        // Point at the sr-only heading above rather than inventing a second name.
        aria-labelledby={title && titleId ? titleId : undefined}
        aria-label={title && titleId ? undefined : "Catalogue results"}
      >
        {hits.length === 0 ? (
          <p className="px-3 py-6 text-sm text-[color:var(--text-muted)]">{emptyHint ?? "No matching items."}</p>
        ) : (
          hits.map((item, index) => {
            const duplicate = taken.has(item.id) && slots[activeSlot] !== item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={highlight === index}
                onClick={() => choose(item.id)}
                disabled={duplicate}
                className={cn(
                  "group grid min-h-[4.5rem] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[color:var(--border)] px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-[color:var(--surface-subtle)] disabled:cursor-not-allowed disabled:opacity-45",
                  highlight === index && !duplicate ? "bg-[color:var(--surface-subtle)]" : null,
                )}
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm text-[color:var(--text-heading)]">{item.title}</strong>
                    {item.tag ? (
                      <span className="inline-flex items-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-2 py-0.5 text-3xs font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
                        {item.tag}
                      </span>
                    ) : null}
                  </span>
                  {item.snippet ? (
                    <span className="mt-1 line-clamp-2 block text-xs leading-4 text-[color:var(--text-muted)]">
                      {item.snippet}
                    </span>
                  ) : null}
                </span>
                <ArrowRight
                  className="h-4 w-4 shrink-0 text-[color:var(--decoration-soft)] transition-colors group-hover:text-[color:var(--clinical-accent)]"
                  aria-hidden="true"
                />
              </button>
            );
          })
        )}
      </div>
      {!hideActions ? <ComparePickerActions onDone={onDone} onReset={onReset} /> : null}
      <p className="sr-only" aria-live="polite">
        {announcement ?? ""}
      </p>
    </div>
  );
}

/** Done and Reset for the compare picker: inline on wider screens, the pinned sheet footer on phones. */
export function ComparePickerActions({ onDone, onReset }: { onDone?: () => void; onReset?: () => void }) {
  if (!onDone && !onReset) return null;
  return (
    <div className="flex items-center justify-end gap-2">
      {onReset ? (
        <button
          type="button"
          onClick={onReset}
          className="mr-auto inline-flex min-h-tap items-center rounded-lg px-2 text-sm font-semibold text-[color:var(--text-muted)] hover:text-[color:var(--text-heading)]"
        >
          Reset
        </button>
      ) : null}
      {onDone ? (
        <button
          type="button"
          onClick={onDone}
          className="inline-flex min-h-tap items-center justify-center rounded-lg bg-[color:var(--command)] px-6 text-sm font-bold text-[color:var(--command-contrast)] transition-colors hover:bg-[color:var(--command-hover)]"
        >
          Done
        </button>
      ) : null}
    </div>
  );
}
