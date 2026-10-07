"use client";

import { ChevronDown, ChevronUp, Pin, PinOff } from "lucide-react";
import { useId, useState } from "react";

import { FavouriteTypeTile } from "@/components/favourites/favourite-type-tile";
import type { FavouriteItem } from "@/components/favourites/favourites-view-model";
import {
  sheetCard,
  sheetFootnote,
  sheetIconButton,
  sheetRow,
  SheetRowText,
  sheetSectionLabel,
  SwitchTrack,
} from "@/components/favourites/number-sheets";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet } from "@/components/ui/sheet";
import { cn, textMuted } from "@/components/ui-primitives";
import {
  resetFavouritesLayout,
  setFavouritesLayout,
  useFavouritesLayout,
  type FavouritesListView,
  type FavouritesScope,
  type FavouritesSectionId,
} from "@/lib/favourites/favourites-local";

const SECTION_LABEL: Record<FavouritesSectionId, string> = {
  continue: "Continue",
  shelf: "On My Day",
  numbers: "Numbers",
  clinical: "Clinical",
  work: "Work pages",
};

const SCOPE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "clinical", label: "Clinical" },
  { value: "work", label: "Work" },
] as const satisfies ReadonlyArray<{ value: FavouritesScope; label: string }>;

const VIEW_OPTIONS = [
  { value: "recent", label: "Recent" },
  { value: "az", label: "A to Z" },
  { value: "type", label: "Type" },
] as const satisfies ReadonlyArray<{ value: FavouritesListView; label: string }>;

const SHELF_OPTIONS = [
  { value: "4", label: "4 tiles" },
  { value: "8", label: "8 tiles" },
] as const;

function moved<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const next = [...list];
  const target = index + by;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/**
 * How the Favourites page is laid out: which sections show and in what order,
 * which tab it opens on, the list order and how many tiles My Day shows. Every
 * change saves at once, on this phone.
 */
export function CustomiseFavouritesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Customise Favourites"
      description="Changes save as you make them."
      closeLabel="Close customise favourites"
      testId="customise-favourites-sheet"
      bodyClassName="p-3 pb-6"
    >
      <div data-work-frame="sheet">
        <CustomiseBody />
      </div>
    </Sheet>
  );
}

function CustomiseBody() {
  const layout = useFavouritesLayout();
  const ids = useId();
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState("");

  return (
    <div className="grid gap-5">
      <section aria-labelledby={`${ids}-sections`}>
        <h3 id={`${ids}-sections`} className={sheetSectionLabel}>
          Sections
        </h3>
        <ul className={cn(sheetCard, "m-0 list-none p-0")}>
          {layout.order.map((id, index) => {
            const label = SECTION_LABEL[id];
            const shown = !layout.hidden.includes(id);
            return (
              <li key={id} className="flex items-center gap-1 pr-1" data-testid={`customise-section-${id}`}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={shown}
                  aria-label={`Show ${label}`}
                  className={cn(sheetRow, "flex-1")}
                  onClick={() =>
                    setFavouritesLayout({
                      hidden: shown ? [...layout.hidden, id] : layout.hidden.filter((hiddenId) => hiddenId !== id),
                    })
                  }
                >
                  <SheetRowText title={label} sub={shown ? undefined : "Hidden"} />
                  <SwitchTrack on={shown} />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${label} up`}
                  className={sheetIconButton}
                  disabled={index === 0}
                  onClick={() => setFavouritesLayout({ order: moved(layout.order, index, -1) })}
                >
                  <ChevronUp aria-hidden="true" className="size-icon-md" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${label} down`}
                  className={sheetIconButton}
                  disabled={index === layout.order.length - 1}
                  onClick={() => setFavouritesLayout({ order: moved(layout.order, index, 1) })}
                >
                  <ChevronDown aria-hidden="true" className="size-icon-md" />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby={`${ids}-scope`} className="grid gap-1.5">
        <h3 id={`${ids}-scope`} className={cn(sheetSectionLabel, "pb-0")}>
          Opens on
        </h3>
        <SegmentedControl
          ariaLabelledBy={`${ids}-scope`}
          layout="equal"
          value={layout.scope}
          options={SCOPE_OPTIONS}
          onChange={(scope) => setFavouritesLayout({ scope })}
        />
      </section>

      <section aria-labelledby={`${ids}-view`} className="grid gap-1.5">
        <h3 id={`${ids}-view`} className={cn(sheetSectionLabel, "pb-0")}>
          Sort by
        </h3>
        <SegmentedControl
          ariaLabelledBy={`${ids}-view`}
          layout="equal"
          value={layout.view}
          options={VIEW_OPTIONS}
          onChange={(view) => setFavouritesLayout({ view })}
        />
      </section>

      <section aria-labelledby={`${ids}-shelf`} className="grid gap-1.5">
        <h3 id={`${ids}-shelf`} className={cn(sheetSectionLabel, "pb-0")}>
          On My Day shows
        </h3>
        <SegmentedControl
          ariaLabelledBy={`${ids}-shelf`}
          layout="equal"
          value={layout.shelfSize === 4 ? "4" : "8"}
          options={SHELF_OPTIONS}
          onChange={(size) => setFavouritesLayout({ shelfSize: size === "4" ? 4 : 8 })}
        />
      </section>

      {confirming ? (
        <div
          className="grid gap-2 rounded-2xl border border-[color:var(--border)] p-3"
          data-testid="reset-layout-confirm"
        >
          <p className="m-0 text-sm font-semibold text-[color:var(--text-heading)]">
            Put sections, order and tiles back to how they started?
          </p>
          <p className={cn("m-0 text-xs", textMuted)}>Your favourites, numbers, names and notes stay as they are.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              Keep layout
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                const saved = resetFavouritesLayout();
                setConfirming(false);
                setStatus(saved ? "Layout reset" : "This phone did not save that.");
              }}
            >
              Reset
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          block
          onClick={() => {
            setStatus("");
            setConfirming(true);
          }}
        >
          Reset layout
        </Button>
      )}
      <p className={sheetFootnote}>Layout is kept on this phone.</p>
      <span className="sr-only" role="status" aria-live="polite">
        {status}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------- arrange */

const ADD_LIMIT = 8;

/**
 * Put the My Day pins in the order you want, unpin one, or pin something new.
 * The order is kept as `layout.pinOrder`, on this phone.
 */
export function ArrangeShelfSheet({
  open,
  onClose,
  pinned,
  unpinned,
  pinLimit,
  onTogglePin,
}: {
  open: boolean;
  onClose: () => void;
  pinned: readonly FavouriteItem[];
  unpinned: readonly FavouriteItem[];
  pinLimit: number;
  onTogglePin: (item: FavouriteItem) => void;
}) {
  const ids = useId();
  const full = pinned.length >= pinLimit;
  const reasonId = `${ids}-full`;
  const candidates = unpinned.slice(0, ADD_LIMIT);

  function move(index: number, by: -1 | 1) {
    setFavouritesLayout({ pinOrder: moved(pinned, index, by).map((item) => item.id) });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Arrange My Day"
      description={`${pinned.length} pinned of ${pinLimit}`}
      closeLabel="Close arrange My Day"
      testId="arrange-shelf-sheet"
      bodyClassName="p-3 pb-6"
    >
      <div data-work-frame="sheet" className="grid gap-5">
        <section aria-labelledby={`${ids}-pinned`}>
          <h3 id={`${ids}-pinned`} className={sheetSectionLabel}>
            Pinned, in this order
          </h3>
          {pinned.length ? (
            <ul className={cn(sheetCard, "m-0 list-none p-0")}>
              {pinned.map((item, index) => (
                <li
                  key={item.id}
                  className="flex min-h-12 items-center gap-2 pl-3 pr-1"
                  data-testid={`arrange-pinned-${item.id}`}
                >
                  <FavouriteTypeTile item={item} />
                  <span className="grid min-w-0 flex-1 text-sm font-bold text-[color:var(--text-heading)]">
                    <span className="truncate">{item.shortTitle ?? item.title}</span>
                    <span className="truncate text-xs font-medium text-[color:var(--text-muted)]">
                      {item.areaName ?? item.type}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Move ${item.title} up`}
                    className={sheetIconButton}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ChevronUp aria-hidden="true" className="size-icon-md" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${item.title} down`}
                    className={sheetIconButton}
                    disabled={index === pinned.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ChevronDown aria-hidden="true" className="size-icon-md" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Unpin ${item.title}`}
                    className={sheetIconButton}
                    onClick={() => onTogglePin(item)}
                  >
                    <PinOff aria-hidden="true" className="size-icon-md" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={cn("m-0 px-1 text-sm", textMuted)}>Nothing pinned yet. Pin one below.</p>
          )}
        </section>

        {candidates.length ? (
          <section aria-labelledby={`${ids}-add`}>
            <h3 id={`${ids}-add`} className={sheetSectionLabel}>
              Add to My Day
            </h3>
            {full ? (
              <p id={reasonId} className={cn("m-0 px-1 pb-1.5 text-xs", textMuted)}>
                My Day holds {pinLimit} pins. Unpin one first.
              </p>
            ) : null}
            <ul className={cn(sheetCard, "m-0 list-none p-0")}>
              {candidates.map((item) => (
                <li key={item.id} className="flex min-h-12 items-center gap-2 pl-3 pr-1">
                  <FavouriteTypeTile item={item} />
                  <span className="grid min-w-0 flex-1 text-sm font-bold text-[color:var(--text-heading)]">
                    <span className="truncate">{item.title}</span>
                    <span className="truncate text-xs font-medium text-[color:var(--text-muted)]">
                      {item.areaName ?? item.type}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Pin ${item.title}`}
                    aria-describedby={full ? reasonId : undefined}
                    className={cn(
                      sheetRow,
                      "w-auto shrink-0 gap-1.5 rounded-lg px-3 disabled:cursor-not-allowed disabled:text-[color:var(--disabled)]",
                    )}
                    disabled={full}
                    onClick={() => onTogglePin(item)}
                  >
                    <Pin aria-hidden="true" className="size-icon-sm" />
                    Pin
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <p className={sheetFootnote}>The order is kept on this phone.</p>
      </div>
    </Sheet>
  );
}
