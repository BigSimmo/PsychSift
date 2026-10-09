"use client";

import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Folder,
  GripVertical,
  MoreHorizontal,
  Pin,
  PinOff,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { FavouriteExampleTag } from "@/components/clinical-dashboard/favourite-example-tag";
import { FavouriteTypeTile } from "@/components/favourites/favourite-type-tile";
import { favouriteKindLabel } from "@/components/favourites/favourites-launchpad";
import {
  favouriteScopeOf,
  isSourceBacked,
  recentTimeLabel,
  type FavouriteItem,
  type FavouritesView,
} from "@/components/favourites/favourites-view-model";
import { stretchedRowLinkClass } from "@/components/card-recipes";
import { useSwipeRow } from "@/components/favourites/use-swipe-row";
import { WorkTag } from "@/components/mode-kit/work";
import { cn } from "@/components/ui-primitives";

export type FavouriteRowMode = "browse" | "select" | "reorder";

/** Each action revealed by a left swipe is 68px wide: Pin, Move and Remove, or Pin and Remove for a work page. */
const SWIPE_ACTION_WIDTH = 68;

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

function RowBody({
  item,
  view,
  showSet,
  time,
  metaId,
}: {
  item: FavouriteItem;
  view: FavouritesView;
  showSet: boolean;
  /** Recent view only: when it was last opened, first on the meta line. */
  time: string;
  /** Lets the row's control describe itself with this line, which its label would otherwise hide. */
  metaId?: string;
}) {
  const isWork = favouriteScopeOf(item) === "work";
  const kind = favouriteKindLabel(item);
  const lead = view === "type" && !isWork ? item.description : kind;
  // A work page or number has no set: it shows its work area or digits instead, and where it lives.
  const setLabel = showSet && !isWork ? ` · ${item.set}` : "";
  return (
    <>
      <FavouriteTypeTile item={item} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-start gap-1.5">
          <span className="line-clamp-2 min-w-0 text-sm font-bold leading-snug text-[color:var(--work-ink)]">
            {item.title}
          </span>
          {item.example ? <FavouriteExampleTag /> : null}
        </span>
        {item.note ? (
          <span className="block min-w-0 truncate text-xs text-[color:var(--text-muted)]">{item.note}</span>
        ) : null}
        <span id={metaId} className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="flex min-w-0 items-center gap-1 text-xs font-medium text-[color:var(--text-muted)]">
            {item.pinned ? (
              <>
                <Pin className="size-icon-xs shrink-0 text-[color:var(--clinical-accent)]" aria-hidden="true" />
                <span className="sr-only">Pinned to My Day.</span>
              </>
            ) : null}
            {isSourceBacked(item) ? (
              <>
                <ShieldCheck className="size-icon-xs shrink-0 text-[color:var(--success)]" aria-hidden="true" />
                <span className="sr-only">Source-backed.</span>
              </>
            ) : null}
            <span className="min-w-0 truncate">
              {time ? <span className="nums">{time} · </span> : null}
              {item.numberId && item.phone ? <span className="font-mono">{item.phone} · </span> : null}
              {lead}
              {setLabel}
            </span>
          </span>
          {isWork ? <WorkTag tone="neutral">This phone</WorkTag> : null}
        </span>
      </span>
    </>
  );
}

export function FavouriteRow({
  item,
  view,
  now,
  showSet,
  mode,
  selected = false,
  workspaceSelected = false,
  swipeOpen,
  onSwipeOpenChange,
  canMutate,
  canMove = canMutate,
  onOpen,
  onSelectForWorkspace,
  onShowActions,
  onTogglePin,
  onMove,
  onRemove,
  onToggleSelected,
  reorder,
}: {
  item: FavouriteItem;
  view: FavouritesView;
  now: number;
  /** False inside a set, where naming the set on every row is noise. */
  showSet: boolean;
  mode: FavouriteRowMode;
  selected?: boolean;
  /** The row whose details the xl item workspace is showing. */
  workspaceSelected?: boolean;
  swipeOpen: boolean;
  onSwipeOpenChange: (open: boolean) => void;
  /** Saved items can be pinned and removed; demo examples cannot. */
  canMutate: boolean;
  /** Saved account items can also be moved to a set; work pages cannot. */
  canMove?: boolean;
  onOpen: (item: FavouriteItem) => void;
  onSelectForWorkspace: (item: FavouriteItem) => void;
  onShowActions: (item: FavouriteItem) => void;
  onTogglePin: (item: FavouriteItem) => void;
  onMove: (item: FavouriteItem) => void;
  onRemove: (item: FavouriteItem) => void;
  onToggleSelected: (item: FavouriteItem) => void;
  reorder?: {
    canMoveUp: boolean;
    canMoveDown: boolean;
    pending: boolean;
    onMove: (item: FavouriteItem, direction: -1 | 1) => void;
    /** Pointer drag from the grip. Keyboard users keep the up and down buttons. */
    onDragStart?: (item: FavouriteItem, event: ReactPointerEvent<HTMLElement>) => void;
    /** Vertical offset while this row, or a row passing it, is being dragged. */
    dragY?: number;
    dragging?: boolean;
  };
}) {
  const swipeEnabled = mode === "browse" && canMutate;
  const swipe = useSwipeRow({
    enabled: swipeEnabled,
    open: swipeOpen && swipeEnabled,
    onOpenChange: onSwipeOpenChange,
    revealWidth: SWIPE_ACTION_WIDTH * (canMove ? 3 : 2),
  });
  const time = mode === "browse" && view === "recent" ? recentTimeLabel(item.openedAt, now) : "";
  const metaId = `favourite-meta-${item.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  // The row clips its swipe tray, so focus outlines sit inside the edge.
  const insetFocus = "focus-visible:-outline-offset-2";

  return (
    <li data-testid={`favourite-row-${item.id}`} className="relative isolate overflow-hidden">
      {swipeEnabled ? (
        // Duplicates of sheet actions for the swipe gesture, so kept out of the
        // tab order and the accessibility tree: the actions button is the path.
        <div aria-hidden="true" className="absolute inset-y-0 right-0 flex" data-swipe-tray>
          <button
            type="button"
            tabIndex={-1}
            onClick={() => {
              onSwipeOpenChange(false);
              onTogglePin(item);
            }}
            className="flex w-17 flex-col items-center justify-center gap-1 bg-[color:var(--clinical-accent)] text-2xs font-bold text-[color:var(--clinical-accent-contrast)]"
          >
            {item.pinned ? (
              <PinOff className="size-icon-md" aria-hidden="true" />
            ) : (
              <Pin className="size-icon-md" aria-hidden="true" />
            )}
            {item.pinned ? "Unpin" : "Pin"}
          </button>
          {canMove ? (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => {
                onSwipeOpenChange(false);
                onMove(item);
              }}
              className="flex w-17 flex-col items-center justify-center gap-1 bg-[color:var(--text-muted)] text-2xs font-bold text-[color:var(--surface)]"
            >
              <Folder className="size-icon-md" aria-hidden="true" />
              Move
            </button>
          ) : null}
          <button
            type="button"
            tabIndex={-1}
            onClick={() => {
              onSwipeOpenChange(false);
              onRemove(item);
            }}
            className="flex w-17 flex-col items-center justify-center gap-1 bg-[color:var(--danger-solid)] text-2xs font-bold text-[color:var(--danger-solid-contrast)]"
          >
            <Trash2 className="size-icon-md" aria-hidden="true" />
            Remove
          </button>
        </div>
      ) : null}

      <div
        {...swipe.rowHandlers}
        style={{
          transform: reorder?.dragY
            ? `translateY(${reorder.dragY}px)`
            : swipe.offset
              ? `translateX(${swipe.offset}px)`
              : undefined,
        }}
        data-row-id={item.id}
        className={cn(
          "relative flex min-h-tap items-center gap-1 bg-[color:var(--work-surface)] pl-3 pr-1 touch-pan-y",
          !swipe.dragging &&
            !reorder?.dragging &&
            "transition-transform duration-[var(--duration-base)] ease-out motion-reduce:transition-none",
          reorder?.dragging && "z-[5] shadow-[var(--work-shadow-float)]",
          workspaceSelected && "xl:bg-[color:var(--clinical-accent-soft)]",
        )}
      >
        {mode === "select" && !canMutate ? (
          <div className="flex min-w-0 flex-1 items-center gap-3 py-2 pr-12">
            <RowBody item={item} view={view} showSet={showSet} time={time} metaId={metaId} />
          </div>
        ) : mode === "select" ? (
          <button
            type="button"
            aria-pressed={selected}
            aria-label={`Select ${item.title}`}
            aria-describedby={metaId}
            onClick={() => onToggleSelected(item)}
            className={cn(
              "flex min-h-tap min-w-0 flex-1 items-center gap-3 rounded-md py-2 pr-2 text-left",
              focusRing,
              insetFocus,
            )}
          >
            <RowBody item={item} view={view} showSet={showSet} time={time} metaId={metaId} />
            {/* The tick sits at the row's end, where the actions button sits while browsing. */}
            <span
              aria-hidden="true"
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-md border-2",
                selected
                  ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
                  : "border-[color:var(--work-line-strong)] text-transparent",
              )}
            >
              <Check className="size-icon-xs" strokeWidth={3} aria-hidden="true" />
            </span>
          </button>
        ) : mode === "reorder" ? (
          <div className="flex min-w-0 flex-1 items-center gap-3 py-2">
            {reorder?.onDragStart ? (
              <span
                aria-hidden="true"
                data-drag-handle
                onPointerDown={(event) => {
                  if (!reorder.pending) reorder.onDragStart?.(item, event);
                }}
                className="-ml-2 grid h-12 w-8 shrink-0 cursor-grab touch-none place-items-center text-[color:var(--text-muted)] active:cursor-grabbing"
              >
                <GripVertical className="size-icon-md" aria-hidden="true" />
              </span>
            ) : null}
            <RowBody item={item} view={view} showSet={showSet} time={time} metaId={metaId} />
          </div>
        ) : (
          <>
            {/* xl opens the item workspace beside the list; below xl the row is a
                plain link, so a phone tap always opens the item and never only
                selects it. */}
            <button
              type="button"
              onClick={() => onSelectForWorkspace(item)}
              aria-label={`Select ${item.title} for workspace`}
              aria-pressed={workspaceSelected}
              aria-describedby={metaId}
              className={cn(
                "hidden min-w-0 max-w-full items-center gap-2.5 rounded-md text-left xl:flex",
                "flex-1 gap-3 py-2",
                focusRing,
                insetFocus,
              )}
            >
              <RowBody item={item} view={view} showSet={showSet} time={time} metaId={metaId} />
            </button>
            <Link
              href={item.href}
              onClick={() => onOpen(item)}
              aria-label={`Open ${item.title}`}
              aria-describedby={metaId}
              draggable={false}
              className={cn(
                "block min-w-0 max-w-full rounded-md text-left xl:hidden",
                "flex-1 py-2",
                focusRing,
                insetFocus,
                stretchedRowLinkClass,
              )}
            >
              <span className="flex min-w-0 items-center gap-3">
                <RowBody item={item} view={view} showSet={showSet} time={time} metaId={metaId} />
              </span>
            </Link>
          </>
        )}

        {mode === "reorder" && reorder ? (
          <span className="flex shrink-0 items-center" data-no-swipe>
            <button
              type="button"
              aria-label={`Move ${item.title} up`}
              // aria-disabled, not disabled: a disabled button drops keyboard
              // focus to the page, and the moved row's button must keep it.
              aria-disabled={!reorder.canMoveUp || reorder.pending}
              data-reorder-id={item.id}
              data-direction={-1}
              onClick={() => {
                if (reorder.canMoveUp && !reorder.pending) reorder.onMove(item, -1);
              }}
              className={cn(
                "grid size-tap place-items-center rounded-lg text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] aria-disabled:text-[color:var(--disabled)]",
                focusRing,
              )}
            >
              <ArrowUp className="size-icon-md" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={`Move ${item.title} down`}
              aria-disabled={!reorder.canMoveDown || reorder.pending}
              data-reorder-id={item.id}
              data-direction={1}
              onClick={() => {
                if (reorder.canMoveDown && !reorder.pending) reorder.onMove(item, 1);
              }}
              className={cn(
                "grid size-tap place-items-center rounded-lg text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] aria-disabled:text-[color:var(--disabled)]",
                focusRing,
              )}
            >
              <ArrowDown className="size-icon-md" aria-hidden="true" />
            </button>
          </span>
        ) : null}

        {mode === "browse" ? (
          <button
            type="button"
            data-no-swipe
            data-row-actions
            aria-haspopup="dialog"
            aria-label={`More actions for ${item.title}`}
            onClick={() => {
              if (swipeOpen) onSwipeOpenChange(false);
              onShowActions(item);
            }}
            className={cn(
              "relative z-10 grid size-tap shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] active:bg-[color:var(--work-wash)]",
              focusRing,
              insetFocus,
            )}
          >
            <MoreHorizontal className="size-icon-md" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </li>
  );
}
