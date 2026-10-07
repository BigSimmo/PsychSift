"use client";

import { ChevronRight, Heart, Phone, Pin, Plus, SlidersHorizontal, TriangleAlert, WifiOff } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useOptionalAccountData } from "@/components/account-data-provider";
import { AddWorkPageSheet } from "@/components/favourites/add-work-page-sheet";
import { FavouriteTypeTile } from "@/components/favourites/favourite-type-tile";
import {
  continueWhenLabel,
  favouriteScopeOf,
  groupForView,
  pickContinueItem,
  recentTimeLabel,
  type FavouriteItem,
} from "@/components/favourites/favourites-view-model";
import { useFavouritesShelf } from "@/components/favourites/use-favourites-shelf";
import { useNumberSheets } from "@/components/favourites/use-number-sheets";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeBandAction, PageTitleUnderBand, useModeBandHeading } from "@/components/mode-band/mode-band";
import {
  WorkBody,
  WorkButton,
  WorkCard,
  WorkChip,
  WorkChips,
  WorkEmpty,
  WorkIconCircle,
  WorkIconRow,
  WorkSectionLabel,
} from "@/components/mode-kit/work";
import { cn } from "@/components/ui-primitives";
import { useFavouritesLayout, type FavouritesScope } from "@/lib/favourites/favourites-local";

/**
 * My Day, Favourites (owner request 7 Oct 2026: one saved list, shown in
 * Favourites and on My Day). The whole saved list, to read and open: an
 * All / Clinical / Work switch, a Continue card, set chips, Recent / A to Z /
 * Type, and grouped rows. A saved number opens Call and Copy. Pinning, moving
 * and removing other favourites stay on the Favourites page, which this page
 * links to. The switch and the order start where Customise Favourites set them.
 *
 * Content only: the My Day work frame draws the band and tabs, so the page's
 * own h1 is for screen readers while the band is showing.
 */

type DayView = "recent" | "az" | "type";

const SCOPES: readonly { readonly value: FavouritesScope; readonly label: string }[] = [
  { value: "all", label: "All" },
  { value: "clinical", label: "Clinical" },
  { value: "work", label: "Work" },
];

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

/** "08:44 · Differential · Ward round": when, what, and which set. A number shows its digits instead of a kind. */
function rowMeta(item: FavouriteItem, now: number): string {
  const when = now > 0 ? recentTimeLabel(item.openedAt, now) : "";
  const set = favouriteScopeOf(item) === "work" || !item.setId ? "" : item.set;
  return [when, item.numberId ? "" : kindLabel(item), set].filter(Boolean).join(" · ");
}

/** A pill switch, one choice of a few, matching the Recent / A to Z / Type switch. */
function PillSwitch<T extends string>({
  label,
  value,
  options,
  onChange,
  counts,
  stretch = false,
  testId,
}: {
  label: string;
  value: T;
  options: readonly { readonly value: T; readonly label: string }[];
  onChange: (value: T) => void;
  counts?: Partial<Record<T, number>>;
  stretch?: boolean;
  testId: string;
}) {
  const labelId = useId();
  return (
    <>
      <span id={labelId} className="sr-only">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className={cn("rounded-full bg-[color:var(--work-wash)] p-0.5", stretch ? "flex w-full" : "inline-flex")}
        data-testid={testId}
      >
        {options.map((option) => {
          const checked = option.value === value;
          const count = counts?.[option.value];
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange(option.value)}
              className={cn(
                "relative rounded-full before:absolute before:-inset-y-2 before:inset-x-0",
                stretch && "flex-1",
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
                {count !== undefined ? (
                  <span aria-hidden="true" className="nums ml-1 font-semibold text-[color:var(--text-muted)]">
                    {count}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function RowText({ item, now }: { item: FavouriteItem; now: number }) {
  return (
    <span className="work-row__text">
      <span className="work-row__title">{item.title}</span>
      {item.note ? (
        <span className="block min-w-0 truncate text-xs text-[color:var(--text-muted)]">{item.note}</span>
      ) : null}
      <span className="work-row__sub flex min-w-0 flex-wrap items-center gap-x-1.5">
        {item.pinned ? (
          <>
            <Pin aria-hidden="true" strokeWidth={2.2} className="size-icon-xs shrink-0" />
            <span className="sr-only">Pinned, </span>
          </>
        ) : null}
        {item.numberId && item.phone ? (
          <span className="font-mono">
            {item.phone}
            <span aria-hidden="true"> ·</span>
          </span>
        ) : null}
        <span className="min-w-0">{rowMeta(item, now)}</span>
        {favouriteScopeOf(item) === "work" ? (
          <span className="rounded bg-[color:var(--work-wash)] px-1.5 text-2xs font-bold text-[color:var(--work-ink)]">
            This phone
          </span>
        ) : null}
      </span>
    </span>
  );
}

export function MyDayFavouritesPage() {
  const { items, status, signedIn, retry, recordOpen } = useFavouritesShelf();
  const accountData = useOptionalAccountData();
  const now = useSyncExternalStore(subscribeMinute, getMinuteNow, getServerNow);
  const online = useSyncExternalStore(subscribeOnline, getOnline, getServerOnline);
  const layout = useFavouritesLayout();
  // The switch and the order open where Customise Favourites set them, then follow the reader's taps.
  const [viewChoice, setView] = useState<DayView | null>(null);
  const [scopeChoice, setScope] = useState<FavouritesScope | null>(null);
  const view = viewChoice ?? layout.view;
  const scope = scopeChoice ?? layout.scope;
  const [setFilter, setSetFilter] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Signed out, only this phone's work pages and numbers are the reader's own.
  const visible = useMemo(
    () => (signedIn ? items : items.filter((item) => favouriteScopeOf(item) === "work")),
    [items, signedIn],
  );
  const scoped = useMemo(
    () => (scope === "all" ? visible : visible.filter((item) => favouriteScopeOf(item) === scope)),
    [visible, scope],
  );
  const numberSheets = useNumberSheets(visible);
  const loading = signedIn && status === "loading" && visible.length === 0;
  const failed = signedIn && (status === "error" || status === "partial" || status === "unauthorized");

  // Only the account's own sets, in its order, and only those holding something.
  const favouriteSets = accountData?.favouriteSets;
  const setChips = useMemo(() => {
    const sets = [...(favouriteSets ?? [])].sort((first, second) => first.sortOrder - second.sortOrder);
    // Sets hold clinical items only, so they never show under Work.
    if (scope === "work") return [];
    return sets.flatMap((set) => {
      const count = scoped.filter((item) => item.setId === set.id).length;
      return count > 0 ? [{ id: set.id, name: set.name, count }] : [];
    });
  }, [favouriteSets, scoped, scope]);
  // A set that has since emptied or gone falls back to All, never to a blank list.
  const activeSet = setFilter && setChips.some((chip) => chip.id === setFilter) ? setFilter : null;
  const filtered = activeSet ? scoped.filter((item) => item.setId === activeSet) : scoped;
  const groups = groupForView(filtered, view, now);
  const continueItem = now > 0 ? pickContinueItem(scoped) : null;
  const scopeCounts = {
    all: visible.length,
    clinical: visible.filter((item) => favouriteScopeOf(item) === "clinical").length,
    work: visible.filter((item) => favouriteScopeOf(item) === "work").length,
  };

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
              <div className="flex flex-wrap gap-2">
                <WorkButton variant="secondary" icon={Plus} onClick={openAdd} testId="my-day-favourites-page-add">
                  Add a work page
                </WorkButton>
                <WorkButton
                  variant="secondary"
                  icon={Phone}
                  onClick={numberSheets.addNumber}
                  testId="my-day-favourites-page-add-number"
                >
                  Add a number
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
            <PillSwitch
              label="Show favourites"
              value={scope}
              options={SCOPES}
              onChange={(next) => {
                setScope(next);
                setSetFilter(null);
              }}
              counts={scopeCounts}
              stretch
              testId="my-day-favourites-scope"
            />

            {scoped.length === 0 ? (
              scope === "work" ? (
                <div className="grid gap-2" data-testid="my-day-favourites-work-empty">
                  <WorkEmpty
                    icon={Heart}
                    title="No work pages or numbers yet"
                    body="Keep a roster, teaching page or ward number one tap away. They stay on this phone."
                  />
                  <WorkCard as="ul">
                    <li>
                      <button type="button" onClick={openAdd} className="work-row w-full text-left">
                        <WorkIconCircle icon={Plus} tone="neutral" />
                        <span className="work-row__text">
                          <span className="work-row__title">Add a work page</span>
                        </span>
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        onClick={numberSheets.addNumber}
                        className="work-row w-full text-left"
                        data-testid="my-day-favourites-add-number"
                      >
                        <WorkIconCircle icon={Phone} tone="neutral" />
                        <span className="work-row__text">
                          <span className="work-row__title">Add a number</span>
                        </span>
                      </button>
                    </li>
                  </WorkCard>
                </div>
              ) : (
                <div className="grid gap-2" data-testid="my-day-favourites-clinical-empty">
                  <WorkEmpty
                    icon={Heart}
                    title="No clinical favourites yet"
                    body="Tap the heart on a service, form, diagnosis or therapy to keep it here."
                  />
                  <WorkCard as="ul">
                    <li>
                      <WorkIconRow
                        icon={Heart}
                        title="Browse services"
                        sub="Save one to see it here"
                        href="/services"
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
                      <span className="truncate text-sm font-bold text-[color:var(--work-ink)]">
                        {continueItem.title}
                      </span>
                      <span className="truncate text-xs text-[color:var(--text-muted)]">
                        {`${kindLabel(continueItem)} · opened ${continueWhenLabel(continueItem.openedAt ?? now, now)}`}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="shrink-0 rounded-full bg-[color:var(--work-wash)] px-3 py-1.5 text-xs font-bold text-[color:var(--mode-identity)]"
                    >
                      {continueItem.numberId ? "Call" : "Open"}
                    </span>
                  </Link>
                ) : null}

                {setChips.length > 0 ? (
                  <WorkChips label="Sets">
                    <WorkChip
                      selected={activeSet === null}
                      onClick={() => setSetFilter(null)}
                      count={scoped.length}
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
                  <PillSwitch
                    label="Order favourites"
                    value={view}
                    options={VIEWS}
                    onChange={setView}
                    testId="my-day-favourites-view"
                  />
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
                          {item.numberId ? (
                            <button
                              type="button"
                              aria-haspopup="dialog"
                              onClick={() => numberSheets.openNumber(item)}
                              className="work-row w-full text-left"
                              data-testid="my-day-favourites-row"
                            >
                              <FavouriteTypeTile item={item} />
                              <RowText item={item} now={now} />
                              <ChevronRight aria-hidden="true" className="work-row__chev" strokeWidth={2} />
                            </button>
                          ) : (
                            <Link
                              href={item.href}
                              onClick={() => recordOpen(item)}
                              className="work-row"
                              data-testid="my-day-favourites-row"
                            >
                              <FavouriteTypeTile item={item} />
                              <RowText item={item} now={now} />
                              <ChevronRight aria-hidden="true" className="work-row__chev" strokeWidth={2} />
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </>
            )}
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
            {`Pin an item to keep it on Today. The first ${layout.shelfSize === 4 ? "four" : "eight"} sit there.`}
          </p>
        ) : null}

        {numberSheets.sheets}
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
