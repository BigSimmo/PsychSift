"use client";

import { ChevronRight, Heart, Pin, Plus, SlidersHorizontal, TriangleAlert, WifiOff } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useOptionalAccountData } from "@/components/account-data-provider";
import { AddWorkPageSheet } from "@/components/favourites/add-work-page-sheet";
import { FavouriteTypeTile } from "@/components/favourites/favourite-type-tile";
import {
  continueWhenLabel,
  groupForView,
  pickContinueItem,
  recentTimeLabel,
  type FavouriteItem,
} from "@/components/favourites/favourites-view-model";
import { useFavouritesShelf } from "@/components/favourites/use-favourites-shelf";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeBandAction, PageTitleUnderBand, useModeBandHeading } from "@/components/mode-band/mode-band";
import {
  WorkBody,
  WorkButton,
  WorkCard,
  WorkChip,
  WorkChips,
  WorkEmpty,
  WorkIconRow,
  WorkSectionLabel,
} from "@/components/mode-kit/work";
import { cn } from "@/components/ui-primitives";

/**
 * My Day, Favourites (owner request 7 Oct 2026: one saved list, shown in
 * Favourites and on My Day). The whole saved list, to read and open: a
 * Continue card, set chips, Recent / A to Z / Type, and grouped rows. Pinning,
 * moving and removing stay on the Favourites page, which this page links to.
 *
 * Content only: the My Day work frame draws the band and tabs, so the page's
 * own h1 is for screen readers while the band is showing.
 */

type DayView = "recent" | "az" | "type";

const VIEWS: readonly { readonly value: DayView; readonly label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "az", label: "A to Z" },
  { value: "type", label: "Type" },
];

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

function getMinuteNow() {
  return Math.floor(Date.now() / 60_000) * 60_000;
}
function subscribeMinute(onChange: () => void) {
  const timer = window.setInterval(onChange, 30_000);
  return () => window.clearInterval(timer);
}
const getServerNow = () => 0;

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}
const getOnline = () => navigator.onLine !== false;
const getServerOnline = () => true;

/** "Differential", or the work area's name for a work page ("On Call"). */
function kindLabel(item: FavouriteItem): string {
  return item.type === "Work page" ? (item.areaName ?? "Work page") : item.type;
}

/** "08:44 · Differential · Ward round": when, what, and which set. */
function rowMeta(item: FavouriteItem, now: number): string {
  const when = now > 0 ? recentTimeLabel(item.openedAt, now) : "";
  const set = item.workKey || !item.setId ? "" : item.set;
  return [when, kindLabel(item), set].filter(Boolean).join(" · ");
}

export function MyDayFavouritesPage() {
  const { items, status, signedIn, retry, recordOpen } = useFavouritesShelf();
  const accountData = useOptionalAccountData();
  const now = useSyncExternalStore(subscribeMinute, getMinuteNow, getServerNow);
  const online = useSyncExternalStore(subscribeOnline, getOnline, getServerOnline);
  const [view, setView] = useState<DayView>("recent");
  const [setFilter, setSetFilter] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const viewLabelId = useId();

  // Signed out, only this phone's work pages are the reader's own.
  const visible = useMemo(() => (signedIn ? items : items.filter((item) => Boolean(item.workKey))), [items, signedIn]);
  const loading = signedIn && status === "loading" && visible.length === 0;
  const failed = signedIn && (status === "error" || status === "partial" || status === "unauthorized");

  // Only the account's own sets, in its order, and only those holding something.
  const favouriteSets = accountData?.favouriteSets;
  const setChips = useMemo(() => {
    const sets = [...(favouriteSets ?? [])].sort((first, second) => first.sortOrder - second.sortOrder);
    return sets.flatMap((set) => {
      const count = visible.filter((item) => item.setId === set.id).length;
      return count > 0 ? [{ id: set.id, name: set.name, count }] : [];
    });
  }, [favouriteSets, visible]);
  // A set that has since emptied or gone falls back to All, never to a blank list.
  const activeSet = setFilter && setChips.some((chip) => chip.id === setFilter) ? setFilter : null;
  const filtered = activeSet ? visible.filter((item) => item.setId === activeSet) : visible;
  const groups = groupForView(filtered, view, now);
  const continueItem = now > 0 ? pickContinueItem(visible) : null;

  useModeBandHeading({
    title: "Favourites",
    eyebrow: loading
      ? "Loading"
      : visible.length === 0
        ? failed
          ? "Work pages only"
          : "Nothing saved yet"
        : `${visible.length} saved${online ? "" : " · offline"}`,
  });

  const openAdd = () => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAdding(true);
  };

  return (
    <InformationPageShell testId="my-day-favourites-main" width="bleed">
      <WorkBody testId="my-day-favourites-page">
        <PageTitleUnderBand className="m-0 text-2xl font-bold text-[color:var(--work-ink)]">
          Favourites
        </PageTitleUnderBand>
        <ModeBandAction>
          {(underBand) =>
            underBand ? (
              <button
                type="button"
                onClick={openAdd}
                aria-label="Add a work page"
                className="work-glass-button work-band__action"
                data-testid="my-day-favourites-band-add"
              >
                <Plus aria-hidden="true" className="size-icon-md" strokeWidth={2} />
              </button>
            ) : visible.length > 0 ? (
              <div>
                <WorkButton variant="secondary" icon={Plus} onClick={openAdd} testId="my-day-favourites-page-add">
                  Add a work page
                </WorkButton>
              </div>
            ) : null
          }
        </ModeBandAction>

        {!online ? (
          <p
            role="status"
            className="m-0 flex items-center gap-2 text-xs font-semibold text-[color:var(--text-muted)]"
            data-testid="my-day-favourites-offline"
          >
            <WifiOff aria-hidden="true" strokeWidth={2.2} className="size-icon-xs shrink-0" />
            Offline. Showing what this phone last saw.
          </p>
        ) : null}

        {failed ? (
          <div
            role="alert"
            className="work-card flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 py-1.5 pl-3 pr-1.5"
            data-testid="my-day-favourites-failed"
          >
            <TriangleAlert
              aria-hidden="true"
              strokeWidth={2.2}
              className="size-icon-sm shrink-0 text-[color:var(--warning-text)]"
            />
            <p className="m-0 min-w-0 flex-1 text-sm leading-snug text-[color:var(--work-ink)]">
              Your saved clinical items did not load. Work pages on this phone are below.
            </p>
            <WorkButton variant="secondary" onClick={retry} testId="my-day-favourites-retry">
              Retry
            </WorkButton>
          </div>
        ) : null}

        {loading ? (
          <>
            <span role="status" className="sr-only">
              Loading favourites
            </span>
            <RowsSkeleton />
          </>
        ) : visible.length === 0 ? (
          failed ? null : (
            <div className="grid gap-2" data-testid="my-day-favourites-empty">
              <WorkEmpty
                icon={Heart}
                title="Save what you open most"
                body="Tap the heart on a service, form, diagnosis or therapy, or add a work page, to keep it one tap away on My Day."
                action={
                  <WorkButton onClick={openAdd} testId="my-day-favourites-empty-add">
                    Add a work page
                  </WorkButton>
                }
              />
              <WorkCard as="ul">
                <li>
                  <WorkIconRow
                    icon={Heart}
                    title="Browse services"
                    sub="Save one to see it here"
                    href="/services"
                    testId="my-day-favourites-browse-services"
                  />
                </li>
              </WorkCard>
            </div>
          )
        ) : (
          <>
            {continueItem ? (
              <Link
                href={continueItem.href}
                onClick={() => recordOpen(continueItem)}
                className={cn("work-card flex min-h-tap min-w-0 items-center gap-2.5 px-3 py-2.5", focusRing)}
                data-testid="my-day-favourites-continue"
              >
                <FavouriteTypeTile item={continueItem} />
                <span className="grid min-w-0 flex-1">
                  <span className="text-2xs font-bold uppercase tracking-wider text-[color:var(--mode-identity)]">
                    Continue
                  </span>
                  <span className="truncate text-sm font-bold text-[color:var(--work-ink)]">{continueItem.title}</span>
                  <span className="truncate text-xs text-[color:var(--text-muted)]">
                    {`${kindLabel(continueItem)} · opened ${continueWhenLabel(continueItem.openedAt ?? now, now)}`}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="shrink-0 rounded-full bg-[color:var(--work-wash)] px-3 py-1.5 text-xs font-bold text-[color:var(--mode-identity)]"
                >
                  Open
                </span>
              </Link>
            ) : null}

            {setChips.length > 0 ? (
              <WorkChips label="Sets">
                <WorkChip
                  selected={activeSet === null}
                  onClick={() => setSetFilter(null)}
                  count={visible.length}
                  testId="my-day-favourites-set-all"
                >
                  All
                </WorkChip>
                {setChips.map((chip) => (
                  <WorkChip
                    key={chip.id}
                    selected={activeSet === chip.id}
                    onClick={() => setSetFilter(chip.id)}
                    count={chip.count}
                    testId="my-day-favourites-set-chip"
                  >
                    {chip.name}
                  </WorkChip>
                ))}
              </WorkChips>
            ) : null}

            <div className="flex items-center">
              <span id={viewLabelId} className="sr-only">
                Order favourites
              </span>
              <div
                role="radiogroup"
                aria-labelledby={viewLabelId}
                className="inline-flex rounded-full bg-[color:var(--work-wash)] p-0.5"
                data-testid="my-day-favourites-view"
              >
                {VIEWS.map((option) => {
                  const checked = option.value === view;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      onClick={() => setView(option.value)}
                      className={cn(
                        "relative rounded-full before:absolute before:-inset-y-2 before:inset-x-0",
                        focusRing,
                      )}
                    >
                      <span
                        className={cn(
                          "block rounded-full px-3 py-1.5 text-xs font-bold",
                          checked
                            ? "bg-[color:var(--work-surface)] text-[color:var(--work-ink)] shadow-sm"
                            : "text-[color:var(--text-muted)]",
                        )}
                      >
                        {option.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {groups.map((group) => (
              <section
                key={group.id}
                aria-label={group.label || "All favourites"}
                className="grid gap-1.5"
                data-testid="my-day-favourites-group"
              >
                {group.label ? <WorkSectionLabel as="h2">{group.label}</WorkSectionLabel> : null}
                <ul className="work-card work-rows m-0 list-none p-0">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        onClick={() => recordOpen(item)}
                        className="work-row"
                        data-testid="my-day-favourites-row"
                      >
                        <FavouriteTypeTile item={item} />
                        <span className="work-row__text">
                          <span className="work-row__title">{item.title}</span>
                          <span className="work-row__sub flex min-w-0 flex-wrap items-center gap-x-1.5">
                            {item.pinned ? (
                              <>
                                <Pin aria-hidden="true" strokeWidth={2.2} className="size-icon-xs shrink-0" />
                                <span className="sr-only">Pinned, </span>
                              </>
                            ) : null}
                            <span className="min-w-0">{rowMeta(item, now)}</span>
                            {item.workKey ? (
                              <span className="rounded bg-[color:var(--work-wash)] px-1.5 text-2xs font-bold text-[color:var(--work-ink)]">
                                This phone
                              </span>
                            ) : null}
                          </span>
                        </span>
                        <ChevronRight aria-hidden="true" className="work-row__chev" strokeWidth={2} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}

        {!loading ? (
          <WorkCard as="ul">
            <li>
              <WorkIconRow
                icon={SlidersHorizontal}
                tone="neutral"
                title="Manage sets and order in Favourites"
                href="/favourites"
                testId="my-day-favourites-manage"
              />
            </li>
          </WorkCard>
        ) : null}

        {visible.length > 0 ? (
          <p className="m-0 flex items-start gap-2 px-1 text-xs text-[color:var(--text-muted)]">
            <Pin aria-hidden="true" strokeWidth={2.2} className="mt-0.5 size-icon-xs shrink-0" />
            Pin an item to keep it on Today. The first eight sit there.
          </p>
        ) : null}

        <AddWorkPageSheet
          open={adding}
          onClose={() => setAdding(false)}
          returnFocusTarget={() => returnFocusRef.current}
        />
      </WorkBody>
    </InformationPageShell>
  );
}

function RowsSkeleton() {
  return (
    <div aria-hidden="true" className="work-card" data-testid="my-day-favourites-loading">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex min-h-tap items-center gap-2.5 px-3 py-2.5">
          <span className="size-9 shrink-0 rounded-full bg-[color:var(--work-wash)] motion-safe:animate-pulse" />
          <span className="grid flex-1 gap-1.5">
            <span className="h-2.5 w-3/5 rounded-full bg-[color:var(--work-wash)] motion-safe:animate-pulse" />
            <span className="h-2 w-2/5 rounded-full bg-[color:var(--work-wash)] motion-safe:animate-pulse" />
          </span>
        </div>
      ))}
    </div>
  );
}
