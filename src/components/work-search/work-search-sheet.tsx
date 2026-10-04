"use client";

import {
  Award,
  CalendarDays,
  ChevronRight,
  Clock,
  Folder,
  GraduationCap,
  Phone,
  RotateCcw,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import { useWorkSearchRecords } from "@/components/work-search/use-work-search-records";
import { Sheet } from "@/components/ui/sheet";
import { appModeHomeHref } from "@/lib/app-modes";
import { perthDateOf } from "@/lib/perth-time";
import { cn } from "@/components/ui-primitives";
import {
  workSearchAreaLabels,
  workSearchAreas,
  type WorkAreaRead,
  type WorkItem,
  type WorkSearchArea,
} from "@/lib/work-search/model";
import { searchWork, workComingUp, workSearchCounts, type WorkSearchHit } from "@/lib/work-search/search";

const AREA_ICONS: Readonly<Record<WorkSearchArea, LucideIcon>> = {
  roster: CalendarDays,
  teaching: GraduationCap,
  cme: Award,
  "my-work": Folder,
  "on-call": Phone,
};

/**
 * Recent searches, kept in this tab's memory only: never in browser storage,
 * because a shared ward computer cannot tell a typed patient name from a word.
 * Gone on reload or sign-out.
 */
let recentQueries: string[] = [];
const RECENT_LIMIT = 5;

function rememberQuery(query: string) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return;
  recentQueries = [trimmed, ...recentQueries.filter((value) => value.toLowerCase() !== trimmed.toLowerCase())].slice(
    0,
    RECENT_LIMIT,
  );
}

/** Forget recent searches, e.g. when the account changes. */
function clearWorkSearchRecents() {
  recentQueries = [];
}

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

function AreaTile({ area, small = false }: { area: WorkSearchArea; small?: boolean }) {
  const Icon = AREA_ICONS[area];
  return (
    <span
      data-mode-identity={area}
      className={cn(
        "grid shrink-0 place-items-center rounded-xl bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]",
        small ? "size-8" : "size-10",
      )}
    >
      <Icon aria-hidden="true" className={small ? "size-icon-sm" : "size-icon-md"} />
    </span>
  );
}

function SectionHeading({ children, action }: { children: string; action?: React.ReactNode }) {
  return (
    <div className="mb-2 mt-5 flex items-center justify-between gap-3 first:mt-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">{children}</h3>
      {action}
    </div>
  );
}

function ResultRow({
  item,
  showArea,
  onOpen,
}: {
  item: WorkItem;
  showArea: boolean;
  onOpen: () => void;
}) {
  return (
    <li>
      <Link
        href={item.href}
        onClick={onOpen}
        data-work-search-result=""
        className={cn(
          "flex min-h-12 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-[color:var(--surface-subtle)] motion-reduce:transition-none",
          focusRing,
        )}
      >
        <AreaTile area={item.area} small />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[color:var(--text-heading)]">{item.title}</span>
          {item.detail ? (
            <span className="block truncate text-xs text-[color:var(--text-muted)]">{item.detail}</span>
          ) : null}
        </span>
        {showArea ? (
          <span
            data-mode-identity={item.area}
            className="shrink-0 text-xs font-semibold text-[color:var(--mode-identity)]"
          >
            {workSearchAreaLabels[item.area]}
          </span>
        ) : null}
        <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" />
      </Link>
    </li>
  );
}

/** Arrow keys move between results; ArrowUp from the first goes back to the box. */
function moveFocus(event: KeyboardEvent<HTMLElement>, inputRef: RefObject<HTMLInputElement | null>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const scope = event.currentTarget.closest("[data-work-search-root]");
  const links = Array.from(scope?.querySelectorAll<HTMLAnchorElement>("[data-work-search-result]") ?? []);
  if (links.length === 0) return;
  const index = links.indexOf(document.activeElement as HTMLAnchorElement);
  event.preventDefault();
  if (event.key === "ArrowDown") links[Math.min(index + 1, links.length - 1)]?.focus();
  else if (index <= 0) inputRef.current?.focus();
  else links[index - 1]?.focus();
}

function AreaNotices({ areas, onRetry }: { areas: readonly WorkAreaRead[]; onRetry: () => void }) {
  const failed = areas.filter((area) => area.status === "failed").map((area) => workSearchAreaLabels[area.area]);
  // Admin and On Call share one read, so name it once.
  const names = [...new Set(failed)];
  if (names.length === 0) return null;
  return (
    <div
      role="status"
      className="mb-3 flex items-start gap-3 rounded-xl border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] p-3 text-sm text-[color:var(--text)]"
    >
      <p className="min-w-0 flex-1">
        {names.join(", ")} couldn&apos;t load, so {names.length === 1 ? "it isn't" : "they aren't"} searched yet.
        Nothing here means nothing is there.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          "inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-[color:var(--text-heading)] hover:bg-[color:var(--surface-subtle)]",
          focusRing,
        )}
      >
        <RotateCcw aria-hidden="true" className="size-icon-sm" />
        Retry
      </button>
    </div>
  );
}

export interface WorkSearchSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The work area the search was opened from: its results come first. */
  readonly currentArea: WorkSearchArea | null;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}

export function WorkSearchSheet({ open, onClose, currentArea, returnFocusRef }: WorkSearchSheetProps) {
  const [now] = useState(() => new Date());
  const today = perthDateOf(now);
  const records = useWorkSearchRecords(now);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WorkSearchArea | "all">("all");
  const [recents, setRecents] = useState(() => recentQueries);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(
    () => searchWork({ items: records.items, entries: records.entries }, query, { currentArea, today }),
    [records.items, records.entries, query, currentArea, today],
  );
  const counts = useMemo(() => workSearchCounts(hits), [hits]);
  const shown = filter === "all" ? hits : hits.filter((hit) => hit.item.area === filter);
  const comingUp = useMemo(
    () => workComingUp([...records.items, ...records.entries.map(({ item }) => item)], today),
    [records.items, records.entries, today],
  );
  const loading = records.areas.some((area) => area.status === "loading");
  const typed = query.trim().length > 0;

  const openResult = () => {
    rememberQuery(query);
    onClose();
  };
  const runRecent = (value: string) => {
    setQuery(value);
    inputRef.current?.focus();
  };

  const grouped = useMemo(() => {
    if (filter !== "all") return null;
    const order = currentArea ? [currentArea, ...workSearchAreas.filter((area) => area !== currentArea)] : workSearchAreas;
    return order
      .map((area) => ({ area, hits: shown.filter((hit) => hit.item.area === area) }))
      .filter((group) => group.hits.length > 0);
  }, [filter, shown, currentArea]);

  const resultList = (list: readonly WorkSearchHit[], showArea: boolean) => (
    <ul className="space-y-0.5" onKeyDown={(event) => moveFocus(event, inputRef)}>
      {list.map((hit) => (
        <ResultRow key={hit.item.id} item={hit.item} showArea={showArea} onOpen={openResult} />
      ))}
    </ul>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Search my work"
      closeLabel="Close search"
      initialFocusRef={inputRef}
      returnFocusRef={returnFocusRef}
      portal
      mobilePlacement="fullscreen"
      mobileSize="viewport"
      mobileHeaderSafeArea="padding"
      testId="work-search-sheet"
      headerBottom={
        <div className="w-full basis-full pt-3" data-work-search-root="">
          <form
            role="search"
            aria-label="Search my work"
            onSubmit={(event) => {
              event.preventDefault();
              rememberQuery(query);
              setRecents(recentQueries);
            }}
            className="flex min-h-12 items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 focus-within:border-[color:var(--clinical-accent-border)]"
          >
            <Search aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => moveFocus(event, inputRef)}
              placeholder="Shifts, CPD, forms, renewals..."
              aria-label="Search your shifts, teaching, CPD, admin and on-call information"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent py-2 text-base text-[color:var(--text-heading)] outline-none placeholder:text-[color:var(--text-muted)] [&::-webkit-search-cancel-button]:hidden"
            />
            {typed ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
                className={cn(
                  "grid size-tap shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] hover:text-[color:var(--text-heading)]",
                  focusRing,
                )}
              >
                <X aria-hidden="true" className="size-icon-sm" />
              </button>
            ) : null}
          </form>
          <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Filter by area">
            {(["all", ...workSearchAreas] as const).map((area) => {
              const selected = filter === area;
              const count = area === "all" ? hits.length : (counts[area] ?? 0);
              return (
                <button
                  key={area}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setFilter(area)}
                  data-mode-identity={area === "all" ? undefined : area}
                  className={cn(
                    "inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors motion-reduce:transition-none",
                    focusRing,
                    selected
                      ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text)] hover:bg-[color:var(--surface-subtle)]",
                  )}
                >
                  {area === "all" ? "All" : workSearchAreaLabels[area]}
                  {typed && count > 0 ? <span className="text-xs font-semibold opacity-80">{count}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      }
    >
      <div data-work-search-root="" className="pb-6">
        <p className="sr-only" aria-live="polite">
          {typed ? (loading ? "Searching." : `${shown.length} ${shown.length === 1 ? "result" : "results"}.`) : ""}
        </p>
        {records.sample ? (
          <p className="mb-3 rounded-xl bg-[color:var(--surface-subtle)] p-3 text-sm text-[color:var(--text-muted)]">
            <span className="font-semibold text-[color:var(--text-heading)]">Sample.</span> Sign in to search your own
            shifts, teaching, CPD and admin.
          </p>
        ) : null}
        <AreaNotices areas={records.areas} onRetry={records.retry} />

        {!typed ? (
          <>
            {comingUp.length > 0 ? (
              <>
                <SectionHeading>Coming up</SectionHeading>
                {resultList(
                  comingUp.map((item) => ({ item, rank: 0 })),
                  true,
                )}
              </>
            ) : null}
            <SectionHeading>Go to</SectionHeading>
            <ul className="grid grid-cols-5 gap-1">
              {workSearchAreas.map((area) => (
                <li key={area}>
                  <Link
                    href={appModeHomeHref(area)}
                    onClick={onClose}
                    className={cn(
                      "flex min-h-12 flex-col items-center gap-1.5 rounded-xl px-1 py-2 text-center text-xs font-semibold text-[color:var(--text)] hover:bg-[color:var(--surface-subtle)]",
                      focusRing,
                    )}
                  >
                    <AreaTile area={area} />
                    {workSearchAreaLabels[area]}
                  </Link>
                </li>
              ))}
            </ul>
            {recents.length > 0 ? (
              <>
                <SectionHeading
                  action={
                    <button
                      type="button"
                      onClick={() => {
                        clearWorkSearchRecents();
                        setRecents([]);
                      }}
                      className={cn(
                        "min-h-12 rounded-full px-3 text-sm font-semibold text-[color:var(--text-muted)] hover:text-[color:var(--text-heading)]",
                        focusRing,
                      )}
                    >
                      Clear
                    </button>
                  }
                >
                  Recent
                </SectionHeading>
                <ul className="space-y-0.5">
                  {recents.map((value) => (
                    <li key={value}>
                      <button
                        type="button"
                        onClick={() => runRecent(value)}
                        className={cn(
                          "flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left text-sm text-[color:var(--text)] hover:bg-[color:var(--surface-subtle)]",
                          focusRing,
                        )}
                      >
                        <Clock aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" />
                        <span className="min-w-0 flex-1 truncate">{value}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        ) : shown.length > 0 ? (
          grouped ? (
            grouped.map((group) => (
              <section key={group.area} aria-label={workSearchAreaLabels[group.area]}>
                <SectionHeading>{`${workSearchAreaLabels[group.area]} · ${group.hits.length}`}</SectionHeading>
                {resultList(group.hits, false)}
              </section>
            ))
          ) : (
            resultList(shown, false)
          )
        ) : loading ? (
          <p className="py-8 text-center text-sm text-[color:var(--text-muted)]">Searching your work...</p>
        ) : (
          <div className="py-8 text-center">
            <p className="text-base font-semibold text-[color:var(--text-heading)]">
              Nothing found for &ldquo;{query.trim()}&rdquo;
            </p>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">
              {filter === "all"
                ? "It isn't in your Roster, Teaching, CPD, Admin or On Call records."
                : `It isn't in ${workSearchAreaLabels[filter]}.`}
            </p>
            {filter !== "all" && hits.length > 0 ? (
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={cn(
                  "mt-3 min-h-12 rounded-full border border-[color:var(--border)] px-4 text-sm font-semibold text-[color:var(--text-heading)] hover:bg-[color:var(--surface-subtle)]",
                  focusRing,
                )}
              >
                Search all areas ({hits.length})
              </button>
            ) : null}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-[color:var(--text-muted)]">
          Searched on this device. Call notes, handover drafts and MHA timers are never searched.
        </p>
      </div>
    </Sheet>
  );
}
