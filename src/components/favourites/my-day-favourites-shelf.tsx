"use client";

import { Heart, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState } from "react";

import { AddWorkPageSheet } from "@/components/favourites/add-work-page-sheet";
import { FavouritesShelf } from "@/components/favourites/favourites-shelf";
import { favouriteScopeOf, shelfItems } from "@/components/favourites/favourites-view-model";
import { useFavouritesShelf } from "@/components/favourites/use-favourites-shelf";
import { useNumberSheets } from "@/components/favourites/use-number-sheets";
import { WorkButton } from "@/components/mode-kit/work";
import { useFavouritesLayout } from "@/lib/favourites/favourites-local";

/**
 * The Favourites shelf on My Day Today (owner request 7 Oct 2026: one saved
 * list, shown in Favourites and on My Day). A section label with "All N" to
 * the My Day Favourites page, then the same eight tiles the Favourites page
 * draws, in the same order.
 *
 * Signed out, only this phone's saved work pages and numbers show, and
 * nothing at all when there are none. A number's tile opens Call and Copy.
 * The shelf holds four or eight tiles, pins in the order the person arranged
 * them (both set in Customise Favourites, kept on this phone). A failed clinical read keeps the work pages and says
 * so in one amber line with Retry.
 */
export function MyDayFavouritesShelf() {
  const { items, status, signedIn, retry, recordOpen } = useFavouritesShelf();
  const layout = useFavouritesLayout();
  const headingId = useId();
  const [adding, setAdding] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Signed out, clinical items are not this reader's: keep only the work pages and numbers on this phone.
  const visible = signedIn ? items : items.filter((item) => favouriteScopeOf(item) === "work");
  const shelf = shelfItems(visible, layout.shelfSize, layout.pinOrder);
  const numberSheets = useNumberSheets(visible);
  const loading = signedIn && status === "loading" && visible.length === 0;
  const failed = signedIn && (status === "error" || status === "partial" || status === "unauthorized");

  if (!signedIn && visible.length === 0) return null;

  const openAdd = () => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAdding(true);
  };

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={loading || undefined}
      className="grid gap-1.5"
      data-testid="my-day-favourites"
    >
      {/* WorkSectionLabel's look, with the link written out so route checks can see where it goes. */}
      <div className="work-label">
        <h2 id={headingId} className="m-0 text-inherit font-inherit">
          Favourites
        </h2>
        {visible.length > 0 ? (
          <Link href="/my-day/favourites" className="work-label__link" data-testid="my-day-favourites-all">
            {`All ${visible.length}`}
          </Link>
        ) : null}
      </div>

      {loading ? (
        <>
          <span role="status" className="sr-only">
            Loading favourites
          </span>
          <ShelfSkeleton />
        </>
      ) : shelf.length > 0 ? (
        <FavouritesShelf
          items={shelf}
          onOpen={recordOpen}
          onOpenNumber={numberSheets.openNumber}
          onAdd={openAdd}
          limit={layout.shelfSize}
          aria-labelledby={headingId}
          testId="my-day-favourites-shelf"
        />
      ) : failed ? null : (
        <div
          className="work-card flex min-w-0 items-center gap-2.5 py-1.5 pl-3 pr-1.5"
          data-testid="my-day-favourites-empty"
        >
          <Heart aria-hidden="true" strokeWidth={2} className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" />
          <p className="m-0 min-w-0 flex-1 text-sm leading-snug text-[color:var(--work-ink)]">
            Save a service, form or work page to keep it here.
          </p>
          <WorkButton variant="secondary" onClick={openAdd} testId="my-day-favourites-add">
            Add
          </WorkButton>
        </div>
      )}

      {failed ? (
        <div
          role="alert"
          className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs font-semibold text-[color:var(--warning-text)]"
          data-testid="my-day-favourites-failed"
        >
          <TriangleAlert aria-hidden="true" strokeWidth={2.2} className="size-icon-xs shrink-0" />
          <span className="min-w-0">Some favourites did not load</span>
          <button
            type="button"
            onClick={retry}
            className="work-label__link min-h-tap px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]"
            data-testid="my-day-favourites-retry"
          >
            Retry
          </button>
        </div>
      ) : null}

      {numberSheets.sheets}
      <AddWorkPageSheet
        open={adding}
        onClose={() => setAdding(false)}
        returnFocusTarget={() => returnFocusRef.current}
      />
    </section>
  );
}

/** Eight round placeholders, four to a row, the size of the shelf they stand in for. */
function ShelfSkeleton() {
  return (
    <div
      aria-hidden="true"
      data-testid="my-day-favourites-loading"
      className="work-card grid grid-cols-4 gap-x-1 gap-y-2 px-1.5 py-2.5"
    >
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="flex min-h-tap flex-col items-center gap-1.5 px-0.5 py-1.5">
          <span className="size-10 rounded-full bg-[color:var(--work-wash)] motion-safe:animate-pulse" />
          <span className="h-2.5 w-3/4 rounded-full bg-[color:var(--work-wash)] motion-safe:animate-pulse" />
          <span className="h-2 w-1/2 rounded-full bg-[color:var(--work-wash)] motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}
