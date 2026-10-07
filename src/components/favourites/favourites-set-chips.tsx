"use client";

import { ArrowDownUp, Check, Folder, PenLine, Plus, Trash2 } from "lucide-react";

import { UNSORTED_SET_NAME, type FavouriteSetChip } from "@/components/favourites/favourites-view-model";
import { cn } from "@/components/ui-primitives";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

/**
 * The set chips, wrapping onto a second line when they need it. A chip narrows
 * the list to that set; tapping the chip that is already the only one chosen
 * goes back to All. All counts everything, work pages included; the set chips
 * count only clinical items, because work pages never go into a set.
 */
export function FavouritesSetChips({
  chips,
  totalCount,
  selectedSets,
  onSelect,
  onNewSet,
}: {
  chips: FavouriteSetChip[];
  totalCount: number;
  selectedSets: ReadonlySet<string>;
  onSelect: (name: string | null) => void;
  /** Omitted when the clinician cannot create sets (demo mode or every name used). */
  onNewSet?: () => void;
}) {
  return (
    <div role="group" aria-label="Filter by set" data-testid="favourites-set-chips" className="work-chips -my-1.5">
      <button
        type="button"
        className="work-chip"
        aria-pressed={selectedSets.size === 0}
        aria-label={`All favourites, ${totalCount}`}
        onClick={() => onSelect(null)}
      >
        All
        <span className="work-chip__count">{totalCount}</span>
      </button>
      {chips.map((chip) => (
        <button
          key={chip.name}
          type="button"
          className="work-chip"
          aria-pressed={selectedSets.has(chip.name)}
          aria-label={`${chip.name}, ${chip.count} ${chip.count === 1 ? "favourite" : "favourites"}`}
          onClick={() => onSelect(selectedSets.size === 1 && selectedSets.has(chip.name) ? null : chip.name)}
        >
          {chip.name}
          <span className="work-chip__count">{chip.count}</span>
        </button>
      ))}
      {onNewSet ? (
        <button type="button" onClick={onNewSet} className="work-chip">
          <Plus aria-hidden="true" strokeWidth={2.2} />
          New set
        </button>
      ) : null}
    </div>
  );
}

/** Shown when one set is chosen: its name and count, with Reorder and Rename. */
export function FavouritesSetBar({
  name,
  count,
  reordering,
  onToggleReorder,
  onRename,
  onDelete,
}: {
  name: string;
  count: number;
  reordering: boolean;
  /** Omitted when the order cannot change (fewer than two saved items, or examples). */
  onToggleReorder?: () => void;
  /** Omitted for Unsorted and example sets. */
  onRename?: () => void;
  /** Omitted for Unsorted and example sets. Its favourites move to Unsorted. */
  onDelete?: () => void;
}) {
  return (
    <section
      aria-label={`${name} set`}
      data-testid="favourites-set-bar"
      className="work-card flex min-w-0 items-center gap-3 py-1.5 pl-3 pr-1.5"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
        <Folder className="size-icon-md" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-bold text-[color:var(--work-ink)]">{name}</span>
        <span className="nums text-xs text-[color:var(--text-muted)]">
          {count} {count === 1 ? "item" : "items"}
          {name === UNSORTED_SET_NAME ? " not in a set" : ""}
        </span>
      </span>
      {onRename ? (
        <button
          type="button"
          onClick={onRename}
          aria-label={`Rename ${name}`}
          className={cn(
            "grid size-tap shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] active:bg-[color:var(--work-wash)]",
            focusRing,
          )}
        >
          <PenLine className="size-icon-md" aria-hidden="true" />
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${name} set`}
          className={cn(
            "grid size-tap shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] active:bg-[color:var(--danger-soft)] active:text-[color:var(--danger)]",
            focusRing,
          )}
        >
          <Trash2 className="size-icon-md" aria-hidden="true" />
        </button>
      ) : null}
      {onToggleReorder ? (
        <button
          type="button"
          onClick={onToggleReorder}
          aria-pressed={reordering}
          className={cn(
            "inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-bold",
            reordering
              ? "bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
              : "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
            focusRing,
          )}
        >
          {reordering ? (
            <Check className="size-icon-sm" aria-hidden="true" />
          ) : (
            <ArrowDownUp className="size-icon-sm" aria-hidden="true" />
          )}
          {reordering ? "Done" : "Reorder"}
        </button>
      ) : null}
    </section>
  );
}
