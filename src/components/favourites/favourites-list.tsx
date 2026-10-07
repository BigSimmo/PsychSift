"use client";

import { Folder, Pin, Trash2, X } from "lucide-react";
import { useState, type PointerEvent as ReactPointerEvent } from "react";

import { FavouriteRow, type FavouriteRowMode } from "@/components/favourites/favourite-row";
import {
  dragTargetIndex,
  moveEntry,
  type FavouriteGroup,
  type FavouriteItem,
  type FavouritesView,
} from "@/components/favourites/favourites-view-model";
import { WorkSectionLabel } from "@/components/mode-kit/work";
import { cn } from "@/components/ui-primitives";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

export type FavouritesListHandlers = {
  onOpen: (item: FavouriteItem) => void;
  onSelectForWorkspace: (item: FavouriteItem) => void;
  onShowActions: (item: FavouriteItem) => void;
  onTogglePin: (item: FavouriteItem) => void;
  onMove: (item: FavouriteItem) => void;
  onRemove: (item: FavouriteItem) => void;
  onToggleSelected: (item: FavouriteItem) => void;
};

/** The one list: grouped by day, type or nothing, one row per favourite. */
export function FavouritesList({
  groups,
  view,
  now,
  showSet,
  mode,
  selectedIds,
  workspaceItemId,
  openSwipeId,
  onOpenSwipeChange,
  canMutate,
  canMove = canMutate,
  handlers,
  reorder,
}: {
  groups: FavouriteGroup[];
  view: FavouritesView;
  now: number;
  showSet: boolean;
  mode: FavouriteRowMode;
  selectedIds: ReadonlySet<string>;
  workspaceItemId: string | null;
  openSwipeId: string | null;
  onOpenSwipeChange: (id: string | null) => void;
  canMutate: (item: FavouriteItem) => boolean;
  /** Whether an item can go into a set. Defaults to `canMutate`. */
  canMove?: (item: FavouriteItem) => boolean;
  handlers: FavouritesListHandlers;
  reorder?: {
    pending: boolean;
    onMove: (item: FavouriteItem, direction: -1 | 1) => void;
    /** Called once when a drag ends somewhere new, with the group's full new order. */
    onDrop?: (items: FavouriteItem[]) => void;
  };
}) {
  const [drag, setDrag] = useState<{ groupId: string; from: number; to: number; dy: number; height: number } | null>(
    null,
  );

  function startDrag(group: FavouriteGroup, from: number, event: ReactPointerEvent<HTMLElement>) {
    if (!reorder?.onDrop || event.button > 0) return;
    const handle = event.currentTarget;
    const list = handle.closest("ul");
    if (!list) return;
    event.preventDefault();
    const rects = [...list.querySelectorAll<HTMLElement>("[data-row-id]")].map((row) => row.getBoundingClientRect());
    const centers = rects.map((rect) => rect.top + rect.height / 2);
    const height = rects[from]?.height ?? 64;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    try {
      handle.setPointerCapture(pointerId);
    } catch {
      // Capture is an enhancement; the listeners below still follow the pointer.
    }
    setDrag({ groupId: group.id, from, to: from, dy: 0, height });
    let to = from;

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const dy = moveEvent.clientY - startY;
      to = dragTargetIndex(centers, from, (centers[from] ?? 0) + dy);
      setDrag({ groupId: group.id, from, to, dy, height });
    };
    const onEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      setDrag(null);
      if (endEvent.type === "pointerup" && to !== from) reorder.onDrop?.(moveEntry(group.items, from, to));
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  }

  function dragOffsetFor(groupId: string, index: number) {
    if (!drag || drag.groupId !== groupId) return 0;
    if (index === drag.from) return drag.dy;
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return -drag.height;
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return drag.height;
    return 0;
  }

  return (
    <div className="grid gap-2.5" data-testid="favourites-list">
      {/* Keeps the h3 group headings in a proper outline. */}
      <h2 className="sr-only">Saved favourites</h2>
      {groups.map((group) => (
        <section
          key={group.id}
          aria-labelledby={group.label ? `favourites-group-${group.id}` : undefined}
          aria-label={group.label ? undefined : "Favourites"}
          className="grid gap-1.5"
        >
          {group.label ? (
            <WorkSectionLabel
              as="h3"
              id={`favourites-group-${group.id}`}
              count={view === "type" ? <span className="nums">{group.items.length}</span> : undefined}
            >
              {group.label}
            </WorkSectionLabel>
          ) : null}
          <ul className="work-card work-rows">
            {group.items.map((item, index) => (
              <FavouriteRow
                key={item.id}
                item={item}
                view={view}
                now={now}
                showSet={showSet}
                mode={mode}
                selected={selectedIds.has(item.id)}
                workspaceSelected={workspaceItemId === item.id}
                swipeOpen={openSwipeId === item.id}
                onSwipeOpenChange={(open) => onOpenSwipeChange(open ? item.id : null)}
                canMutate={canMutate(item)}
                canMove={canMove(item)}
                {...handlers}
                reorder={
                  reorder
                    ? {
                        canMoveUp: index > 0,
                        canMoveDown: index < group.items.length - 1,
                        pending: reorder.pending,
                        onMove: reorder.onMove,
                        onDragStart: reorder.onDrop ? (_item, event) => startDrag(group, index, event) : undefined,
                        dragY: dragOffsetFor(group.id, index),
                        dragging: drag?.groupId === group.id && drag.from === index,
                      }
                    : undefined
                }
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Floating bar for Select mode: pin, move or remove everything ticked. A
 * floating layer, so it takes the work-mode glass; the actions inside are flat.
 * Move is offered only when something ticked can go into a set.
 */
export function FavouritesSelectBar({
  count,
  canMove = true,
  onPin,
  onMove,
  onRemove,
  onDone,
}: {
  count: number;
  /** False when nothing ticked can be moved, such as only work pages. */
  canMove?: boolean;
  onPin: () => void;
  onMove: () => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const none = count === 0;
  const action = cn(
    "inline-flex min-h-tap items-center gap-1.5 rounded-full px-3.5 text-sm font-bold disabled:text-[color:var(--disabled)]",
    focusRing,
  );
  return (
    <div
      role="group"
      aria-label="Selected favourites"
      data-testid="favourites-select-bar"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[var(--z-chrome)] mx-auto flex max-w-lg items-center gap-1 rounded-full border border-[color:var(--work-glass-line)] bg-[color:var(--work-glass-fill)] p-1 shadow-[var(--work-shadow-float)] backdrop-blur-xl"
    >
      <button
        type="button"
        onClick={onDone}
        aria-label="Leave select mode"
        className={cn(
          "grid size-tap shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] active:bg-[color:var(--work-wash)]",
          focusRing,
        )}
      >
        <X className="size-icon-md" aria-hidden="true" />
      </button>
      <span className="nums min-w-0 flex-1 truncate text-sm font-bold text-[color:var(--work-ink)]">
        {none ? "Tap to select" : `${count} selected`}
      </span>
      <button
        type="button"
        disabled={none}
        onClick={onPin}
        className={cn(action, "text-[color:var(--work-ink)] active:bg-[color:var(--work-wash)]")}
      >
        <Pin className="size-icon-sm max-[359px]:hidden" aria-hidden="true" />
        Pin
      </button>
      {canMove ? (
        <button
          type="button"
          disabled={none}
          onClick={onMove}
          className={cn(
            action,
            "bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)] disabled:bg-[color:var(--work-wash)]",
          )}
        >
          <Folder className="size-icon-sm max-[359px]:hidden" aria-hidden="true" />
          Move
        </button>
      ) : null}
      <button
        type="button"
        disabled={none}
        onClick={onRemove}
        aria-label={none ? "Remove selected" : `Remove ${count} selected`}
        className={cn(
          action,
          "min-w-tap justify-center text-[color:var(--danger)] active:bg-[color:var(--danger-soft)]",
        )}
      >
        <Trash2 className="size-icon-sm" aria-hidden="true" />
      </button>
    </div>
  );
}
