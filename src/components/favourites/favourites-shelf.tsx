"use client";

import Link from "next/link";
import { Pin, Plus } from "lucide-react";
import { useRef, type MouseEvent, type PointerEvent } from "react";

import { FavouriteTypeTile } from "@/components/favourites/favourite-type-tile";
import type { FavouriteItem } from "@/components/favourites/favourites-view-model";
import { cn } from "@/components/ui-primitives";

/**
 * The Favourites shelf (owner request 7 Oct 2026): up to eight saved items as
 * round tiles, four to a row. The same component is drawn on My Day Today and
 * at the top of the Favourites page, from the same list and the same order
 * (`shelfItems`), so the two places can never disagree.
 *
 * A tap opens the item. Press and hold (or right-click on a touch device)
 * opens its actions where the host offers them.
 */

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

function tileSub(item: FavouriteItem): string {
  return item.type === "Work page" ? (item.areaName ?? "Work") : item.type;
}

function ShelfTile({
  item,
  onOpen,
  onShowActions,
}: {
  item: FavouriteItem;
  onOpen: (item: FavouriteItem) => void;
  onShowActions?: (item: FavouriteItem) => void;
}) {
  // The click that follows a long press must not also open the item.
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const firedRef = useRef(false);
  const pointerTypeRef = useRef("mouse");

  function cancel() {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  }

  const label = item.shortTitle ?? item.title;
  return (
    <li className="min-w-0">
      <Link
        href={item.href}
        draggable={false}
        aria-label={`${item.title}, ${tileSub(item)}${item.pinned ? ", pinned" : ""}`}
        data-testid="favourites-shelf-tile"
        onPointerDown={
          onShowActions
            ? (event: PointerEvent<HTMLAnchorElement>) => {
                pointerTypeRef.current = event.pointerType;
                if (event.button > 0) return;
                firedRef.current = false;
                cancel();
                hold.current = {
                  x: event.clientX,
                  y: event.clientY,
                  timer: setTimeout(() => {
                    hold.current = null;
                    firedRef.current = true;
                    setTimeout(() => {
                      firedRef.current = false;
                    }, 800);
                    onShowActions(item);
                  }, 500),
                };
              }
            : undefined
        }
        onPointerMove={(event) => {
          if (
            hold.current &&
            Math.abs(event.clientX - hold.current.x) + Math.abs(event.clientY - hold.current.y) > 10
          ) {
            cancel();
          }
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerLeave={cancel}
        onContextMenu={
          onShowActions
            ? (event) => {
                // On a desktop the right-click menu (open in new tab) stays native.
                if (pointerTypeRef.current !== "touch") return;
                event.preventDefault();
                cancel();
                onShowActions(item);
              }
            : undefined
        }
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          if (firedRef.current) {
            event.preventDefault();
            firedRef.current = false;
            return;
          }
          onOpen(item);
        }}
        className={cn(
          "flex min-h-tap w-full min-w-0 select-none flex-col items-center gap-1.5 rounded-xl px-0.5 py-1.5 text-center [-webkit-touch-callout:none] active:bg-[color:var(--work-wash)]",
          focusRing,
        )}
      >
        <span className="relative">
          <FavouriteTypeTile item={item} size="xl" />
          {item.pinned ? (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-[color:var(--work-surface)] text-[color:var(--clinical-accent)] ring-1 ring-[color:var(--work-line-strong)]"
            >
              <Pin className="size-2.5" strokeWidth={2.4} aria-hidden="true" />
            </span>
          ) : null}
        </span>
        <span className="block w-full min-w-0">
          <span className="line-clamp-2 break-words text-xs font-bold leading-tight text-[color:var(--work-ink)]">
            {label}
          </span>
          <span className="mt-0.5 block min-w-0 truncate text-2xs font-semibold text-[color:var(--text-muted)]">
            {item.example ? "Example" : tileSub(item)}
          </span>
        </span>
      </Link>
    </li>
  );
}

export type FavouritesShelfProps = {
  readonly items: readonly FavouriteItem[];
  readonly onOpen: (item: FavouriteItem) => void;
  readonly onShowActions?: (item: FavouriteItem) => void;
  /** A trailing "Add" tile, shown only while the shelf has room. */
  readonly onAdd?: () => void;
  readonly addLabel?: string;
  readonly limit?: number;
  readonly "aria-labelledby"?: string;
  readonly testId?: string;
};

export function FavouritesShelf({
  items,
  onOpen,
  onShowActions,
  onAdd,
  addLabel = "Add",
  limit = 8,
  testId = "favourites-shelf",
  ...rest
}: FavouritesShelfProps) {
  const shown = items.slice(0, limit);
  const showAdd = Boolean(onAdd) && shown.length < limit;
  return (
    <ul
      aria-labelledby={rest["aria-labelledby"]}
      data-testid={testId}
      className="work-card m-0 grid list-none grid-cols-4 gap-x-1 gap-y-2 px-1.5 py-2.5"
    >
      {shown.map((item) => (
        <ShelfTile key={item.id} item={item} onOpen={onOpen} onShowActions={onShowActions} />
      ))}
      {showAdd ? (
        <li className="min-w-0">
          <button
            type="button"
            onClick={onAdd}
            data-testid="favourites-shelf-add"
            className={cn(
              "flex min-h-tap w-full min-w-0 flex-col items-center gap-1.5 rounded-xl px-0.5 py-1.5 text-center active:bg-[color:var(--work-wash)]",
              focusRing,
            )}
          >
            <span
              aria-hidden="true"
              className="grid size-10 place-items-center rounded-full bg-[color:var(--work-surface)] text-[color:var(--text-muted)] ring-[1.5px] ring-inset ring-[color:var(--work-line-strong)]"
            >
              <Plus className="size-icon-md" strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="block w-full min-w-0">
              <span className="block text-xs font-bold leading-tight text-[color:var(--work-ink)]">{addLabel}</span>
              <span className="mt-0.5 block truncate text-2xs font-semibold text-[color:var(--text-muted)]">
                Work page
              </span>
            </span>
          </button>
        </li>
      ) : null}
    </ul>
  );
}
