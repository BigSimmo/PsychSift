"use client";

import Link from "next/link";

import { FavouriteExampleTag } from "@/components/clinical-dashboard/favourite-example-tag";
import { FavouriteTypeTile } from "@/components/favourites/favourite-type-tile";
import { continueWhenLabel, type FavouriteItem } from "@/components/favourites/favourites-view-model";
import { cn } from "@/components/ui-primitives";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

/** "Opened 08:44" today, otherwise "opened yesterday at 16:12" or "opened on Mon". */
function openedLabel(openedAt: number | null, now: number): string {
  if (openedAt === null) return "opened recently";
  const when = continueWhenLabel(openedAt, now);
  return `opened ${when.startsWith("today at ") ? when.slice("today at ".length) : when}`;
}

/** What a favourite is, in a few words: its type, or its work area for a work page. */
export function favouriteKindLabel(item: FavouriteItem): string {
  return item.type === "Work page" ? (item.areaName ?? "Work page") : item.type;
}

/**
 * Continue: the last favourite opened, one tap away. A flat white card; the
 * whole card is the link, and the tinted Open pill only shows where to tap.
 */
export function FavouritesContinueCard({
  item,
  now,
  onOpen,
}: {
  item: FavouriteItem;
  now: number;
  onOpen: (item: FavouriteItem) => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={() => onOpen(item)}
      aria-label={`Continue ${item.title}`}
      data-testid="favourites-continue-strip"
      className={cn("work-card flex min-h-tap min-w-0 items-center gap-3 py-2.5 pl-3 pr-1.5", focusRing)}
    >
      <FavouriteTypeTile item={item} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-2xs font-bold uppercase tracking-eyebrow text-[color:var(--clinical-accent)]">
          Continue
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="line-clamp-2 min-w-0 text-sm font-bold leading-snug text-[color:var(--work-ink)]">
            {item.title}
          </span>
          {item.example ? <FavouriteExampleTag /> : null}
        </span>
        <span className="nums truncate text-xs text-[color:var(--text-muted)]">
          {favouriteKindLabel(item)} · {openedLabel(item.openedAt, now)}
        </span>
      </span>
      <span aria-hidden="true" className="work-button shrink-0" data-variant="tinted">
        Open
      </span>
    </Link>
  );
}
