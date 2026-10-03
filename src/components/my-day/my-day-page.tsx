"use client";

import { ChevronLeft, LogIn, Sunrise } from "lucide-react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeGroupedList } from "@/components/mode-kit/grouped-list";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { MyDayDashboard, type MyDayDashboardProps } from "@/components/my-day/my-day-dashboard";
import { listNames, MyDayItemRow, myDayModeLabel, useMyDayNow } from "@/components/my-day/my-day-page-parts";
import { useMyDayDashboardSources } from "@/components/my-day/use-my-day-dashboard-sources";
import { useMyDayItems } from "@/components/my-day/use-my-day-items";
import { EmptyState } from "@/components/primitive-recipes/feedback";
import { Button } from "@/components/ui/button";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import {
  myDayEnabledForAuth,
  myDayNeedsSignIn,
  myDaySourceModes,
  type MyDayItem,
  type MyDayState,
} from "@/lib/my-day/model";
import { MY_DAY_ALL_VIEW_HREF, MY_DAY_PATH, withMyDayReturn } from "@/lib/my-day/return-link";
import { MY_DAY_PAGE_LABELS, myDayPageIds, parseMyDayPage, type MyDayPageId } from "@/lib/my-day/dashboard";
import type { RenewalRow } from "@/lib/my-day/figures";
import type { AdminHelpItem } from "@/lib/admin/help-items";
import { focusRing } from "@/components/card-recipes";
import { DashTag } from "@/components/dashboard-kit/icon-chip";
import { dashSurface } from "@/components/dashboard-kit/recipes";
import { cn } from "@/components/ui-primitives";

const NO_RENEWALS: readonly RenewalRow[] = [];
const NO_HELP: readonly AdminHelpItem[] = [];
import { useAuthSession } from "@/lib/supabase/client";

/**
 * The signed-out sample: invented data, downloaded only when a signed-out
 * visitor opens My Day, so it never counts towards anyone's first load.
 */
const MyDaySampleDashboard = dynamic(
  () => import("@/components/my-day/my-day-sample").then((module) => module.MyDaySampleDashboard),
  {
    ssr: false,
    loading: () => (
      <div className="grid gap-3" data-testid="my-day-sample-loading" aria-hidden="true">
        <ModeModuleSkeleton rows={2} twoLine eyebrow />
        <ModeModuleSkeleton rows={3} twoLine eyebrow />
      </div>
    ),
  },
);

const PAGE_WIDTH = "mx-auto grid w-full max-w-2xl gap-5 sm:gap-6 lg:max-w-5xl";

/**
 * Invented sample data is shown only in a local demo build with no sign-in
 * configured. For a signed-in reader, any source that answered with sample
 * data contributes nothing, so no invented item is ever shown as theirs.
 */
function myDayShownItems(state: MyDayState, allowSample: boolean): readonly MyDayItem[] {
  if (allowSample) return state.items;
  const sampleModes = new Set(state.sources.filter((source) => source.sample === true).map((source) => source.mode));
  return sampleModes.size ? state.items.filter((item) => !sampleModes.has(item.mode)) : state.items;
}

/**
 * True once "All N" pushed the full list's address in this tab, so "Back to
 * dashboard" can step back through history (the same as the phone's Back)
 * rather than stacking a second dashboard entry. A direct load of the full
 * list's address has nothing of ours behind it, so it replaces instead.
 */
let fullListPushed = false;

/** Open the full list at its own address, `/my-day?view=all`. Next's router follows a native pushState. */
function openFullList() {
  fullListPushed = true;
  window.history.pushState(null, "", MY_DAY_ALL_VIEW_HREF);
}

function closeFullList() {
  if (fullListPushed) {
    fullListPushed = false;
    window.history.back();
    return;
  }
  window.history.replaceState(null, "", MY_DAY_PATH);
}

/** The full list ("All N"): every item, grouped by urgency, as My Day first shipped it. */
function MyDayFullList({
  items,
  now,
  checked,
  onBack,
  onRetry,
}: {
  readonly items: readonly MyDayItem[];
  readonly now: Date;
  readonly checked: readonly string[];
  readonly onBack: () => void;
  readonly onRetry: () => void;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  // Opened from the dashboard (not a direct load): put focus, and so the view, at the top of the list.
  useEffect(() => {
    if (fullListPushed) backRef.current?.focus();
  }, []);
  const sections = [
    { key: "overdue", eyebrow: "Needs you now", items: items.filter((item) => item.severity === "overdue") },
    { key: "soon", eyebrow: "Due soon", items: items.filter((item) => item.severity === "soon") },
    { key: "later", eyebrow: "Later", items: items.filter((item) => item.severity === "info") },
  ].filter((section) => section.items.length > 0);
  return (
    <div className="grid gap-5" data-testid="my-day-full-list">
      <div>
        <Button ref={backRef} variant="ghost" icon={ChevronLeft} onClick={onBack} data-testid="my-day-back">
          Back to dashboard
        </Button>
      </div>
      {sections.length === 0 ? (
        <div data-testid="my-day-empty">
          {checked.length > 0 ? (
            <EmptyState icon={Sunrise} title="Nothing needs you right now" body={`Checked ${listNames(checked)}.`} />
          ) : (
            <EmptyState
              icon={Sunrise}
              title="Couldn't check your day"
              body="No source could be checked just now."
              actions={
                <Button variant="secondary" onClick={onRetry}>
                  Retry
                </Button>
              }
            />
          )}
        </div>
      ) : (
        sections.map((section) => (
          <ModeGroupedList key={section.key} eyebrow={section.eyebrow} testId={`my-day-section-${section.key}`}>
            {section.items.map((item) => (
              <MyDayItemRow key={item.id} item={item} now={now} />
            ))}
          </ModeGroupedList>
        ))
      )}
    </div>
  );
}

/** The dashboard's own reads, mounted only for an enabled reader and remounted per sign-in. */
function MyDayDashboardView({
  allowSample,
  ...props
}: Omit<MyDayDashboardProps, "sources"> & { readonly allowSample: boolean }) {
  const sources = useMyDayDashboardSources({ today: props.today, now: props.now, allowSample });
  return <MyDayDashboard {...props} sources={sources} />;
}

const LONG_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "Saturday 3 October" for a Perth date. */
function longDate(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return `${LONG_WEEKDAYS[weekday]} ${Number(date.slice(8, 10))} ${LONG_MONTHS[Number(date.slice(5, 7)) - 1]}`;
}

/** Switch page by replacing the address, so Back still leaves My Day rather than stepping through tabs. */
function showPage(page: MyDayPageId) {
  const url = page === "today" ? MY_DAY_PATH : `${MY_DAY_PATH}?page=${page}`;
  window.history.replaceState(null, "", url);
}

/** True when the touch began inside something that scrolls sideways (quick actions, the wallet). */
function insideHorizontalScroller(target: EventTarget | null, stop: Element): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== stop) {
    if (node.scrollWidth > node.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(node).overflowX)) return true;
    node = node.parentElement;
  }
  return false;
}

/** Today / Work / Me: a tab list over the dashboard; a sideways swipe on the page changes tab too. */
function MyDayTabs({ page, onChange }: { readonly page: MyDayPageId; readonly onChange: (page: MyDayPageId) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (delta: number) => {
    const index = myDayPageIds.indexOf(page);
    const next = myDayPageIds[(index + delta + myDayPageIds.length) % myDayPageIds.length] ?? "today";
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="My Day pages"
      data-testid="my-day-tabs"
      className="flex gap-1 rounded-full border border-[color:var(--dash-line)] bg-[color:var(--dash-card)] p-1 forced-colors:border"
    >
      {myDayPageIds.map((id) => {
        const selected = id === page;
        return (
          <button
            key={id}
            ref={(node) => {
              refs.current[id] = node;
            }}
            type="button"
            role="tab"
            id={`my-day-tab-${id}`}
            aria-selected={selected}
            aria-controls="my-day-panel"
            tabIndex={selected ? 0 : -1}
            data-testid={`my-day-tab-${id}`}
            onClick={() => onChange(id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(-1);
              }
            }}
            className={cn(
              focusRing,
              "min-h-12 flex-1 rounded-full text-sm font-dash-title",
              selected
                ? "bg-[color:var(--dash-raised)] text-[color:var(--dash-ink)] shadow-[var(--dash-shadow)] forced-colors:border"
                : "text-[color:var(--dash-muted)]",
            )}
          >
            {MY_DAY_PAGE_LABELS[id]}
          </button>
        );
      })}
    </div>
  );
}

/** The tab panel; a sideways swipe on it moves to the next or previous tab. */
function MyDaySwipePanel({
  page,
  onChange,
  children,
}: {
  readonly page: MyDayPageId;
  readonly onChange: (page: MyDayPageId) => void;
  readonly children: ReactNode;
}) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swipeRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={swipeRef}
      id="my-day-panel"
      role="tabpanel"
      aria-labelledby={`my-day-tab-${page}`}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        touchStart.current =
          touch && swipeRef.current && !insideHorizontalScroller(event.target, swipeRef.current)
            ? { x: touch.clientX, y: touch.clientY }
            : null;
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        const touch = event.changedTouches[0];
        touchStart.current = null;
        if (!start || !touch) return;
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
        const index = myDayPageIds.indexOf(page);
        const next = myDayPageIds[index + (dx < 0 ? 1 : -1)];
        if (next) onChange(next);
      }}
    >
      {children}
    </div>
  );
}

export function MyDayPage({ now: nowProp }: { now?: Date } = {}) {
  const { status: authStatus, authEpoch } = useAuthSession();
  const enabled = myDayEnabledForAuth(authStatus);
  // Only a local demo build with no sign-in may show invented examples.
  const allowSample = authStatus === "unconfigured";
  const now = useMyDayNow(nowProp);
  const today = perthCalendarDate(now);
  const state = useMyDayItems({ enabled, now });
  const [signInOpen, setSignInOpen] = useState(false);
  // The full list has its own address, so the phone's Back returns to the dashboard.
  const searchParams = useSearchParams();
  const view: "dashboard" | "all" = searchParams?.get("view") === "all" ? "all" : "dashboard";
  const page = parseMyDayPage(searchParams?.get("page"));
  const changePage = (next: MyDayPageId) => {
    if (next !== page) showPage(next);
  };
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    // Back on the dashboard (by either Back): nothing of ours is left to step back over.
    if (view === "dashboard") fullListPushed = false;
  }, [view]);

  // Every link out of My Day carries the "from My Day" marker, so the page it opens offers "‹ My Day".
  const items = useMemo(
    () => myDayShownItems(state, allowSample).map((item) => ({ ...item, href: withMyDayReturn(item.href) })),
    [state, allowSample],
  );
  const failed = state.sources
    .filter((source) => source.status === "failed")
    .map((source) => myDayModeLabel(source.mode));
  const rosterUnavailable = state.sources.some((source) => source.mode === "roster" && source.status === "unavailable");
  const otherUnavailable = state.sources
    .filter((source) => source.status === "unavailable" && source.mode !== "roster")
    .map((source) => myDayModeLabel(source.mode));
  const checked = myDaySourceModes
    .filter((mode) => state.sources.some((source) => source.mode === mode && source.status === "ready"))
    .map(myDayModeLabel);
  const myWorkSample = state.sources.some((source) => source.mode === "my-work" && source.sample === true);
  // Admin's dates and numbers: dropped whole for a signed-in reader if they are invented examples.
  const adminReal = allowSample || !myWorkSample;
  const renewals = adminReal ? (state.renewals ?? NO_RENEWALS) : NO_RENEWALS;
  const helpItems = adminReal ? (state.helpItems ?? NO_HELP) : NO_HELP;
  const demoNote = allowSample && state.demoMode;
  // Roster's "unavailable" is its team data (swaps); the others are whole modes not offered yet.
  const notYet = [...(rosterUnavailable ? ["Roster swaps"] : []), ...otherUnavailable];
  const ready = enabled && state.status === "ready";
  // Signed out: My Day shows a sample day of invented examples, with a sign-in prompt above it.
  const sampleView = myDayNeedsSignIn(authStatus);
  const showAll = () => {
    setEditing(false);
    openFullList();
  };
  const fullList = (shown: readonly MyDayItem[], shownChecked: readonly string[]) => (
    <MyDayFullList items={shown} now={now} checked={shownChecked} onBack={closeFullList} onRetry={state.retry} />
  );

  return (
    <InformationPageShell testId="my-day-main">
      <div className={cn(PAGE_WIDTH, dashSurface)}>
        <header className="flex min-w-0 items-end justify-between gap-3" data-testid="my-day-header">
          <div className="grid min-w-0 gap-0.5">
            <p className="text-sm text-[color:var(--dash-muted)]">{longDate(today)}</p>
            <h1 className="font-dash-figure text-3xl-minus leading-tight tracking-tight text-[color:var(--dash-ink)]">
              My Day
            </h1>
          </div>
          {ready && view === "dashboard" ? (
            <button
              type="button"
              onClick={() => setEditing((value) => !value)}
              data-testid="my-day-edit"
              aria-pressed={editing}
              className={cn(
                focusRing,
                "-mr-2 inline-flex min-h-12 items-center rounded-md px-2 font-dash-title text-base-minus text-[color:var(--dash-blue)]",
              )}
            >
              {editing ? "Done" : "Edit"}
            </button>
          ) : null}
        </header>
        {(ready || sampleView) && view === "dashboard" ? <MyDayTabs page={page} onChange={changePage} /> : null}

        {authStatus === "loading" || (enabled && state.status === "loading") ? (
          <>
            <span role="status" className="sr-only">
              Loading My Day
            </span>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="my-day-loading" aria-hidden="true">
              <div className="col-span-2">
                <ModeModuleSkeleton rows={2} twoLine eyebrow />
              </div>
              <ModeModuleSkeleton rows={2} eyebrow />
              <ModeModuleSkeleton rows={2} eyebrow />
              <div className="col-span-2">
                <ModeModuleSkeleton rows={3} twoLine eyebrow />
              </div>
            </div>
          </>
        ) : null}

        {authStatus === "error" ? (
          <div className="grid gap-2" data-testid="my-day-auth-error">
            <ModeNotice tone="warning">Couldn&apos;t check your sign-in. Try again.</ModeNotice>
            <div>
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Retry
              </Button>
            </div>
          </div>
        ) : null}

        {sampleView ? (
          <div className="grid gap-5" data-testid="my-day-sample">
            <div
              className="grid gap-3 rounded-2xl border border-[color:var(--dash-line)] bg-[color:var(--dash-card)] p-4 forced-colors:border"
              data-testid="my-day-signed-out"
            >
              <div className="grid gap-1">
                <p>
                  <DashTag tint="amber">Sample</DashTag>
                </p>
                <h2 className="font-dash-title text-lg text-[color:var(--dash-ink)]">Sign in to see your day</h2>
                <p className="text-sm text-[color:var(--dash-muted)]" data-testid="my-day-sample-notice">
                  Below is a sample day made of invented examples, so you can see how My Day works. Signed in, it
                  gathers your own On Call, Roster, CPD, Teaching and Admin records. Nothing is shared.
                </p>
              </div>
              <div>
                <Button variant="primary" icon={LogIn} onClick={() => setSignInOpen(true)}>
                  Sign in
                </Button>
              </div>
              <AccountSetupDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
            </div>
            {view === "all" ? (
              <MyDaySampleDashboard
                now={now}
                today={today}
                page={page}
                view="all"
                onShowAll={showAll}
                renderFullList={fullList}
              />
            ) : (
              <MyDaySwipePanel page={page} onChange={changePage}>
                <MyDaySampleDashboard
                  now={now}
                  today={today}
                  page={page}
                  view="dashboard"
                  onShowAll={showAll}
                  renderFullList={fullList}
                />
              </MyDaySwipePanel>
            )}
          </div>
        ) : null}

        {ready ? (
          <div className="grid gap-5" data-testid="my-day-ready">
            {failed.length > 0 ? (
              <div className="grid gap-2" data-testid="my-day-failed-notice">
                <ModeNotice tone="warning">{`Couldn't load: ${failed.join(", ")}.${checked.length > 0 ? " Showing the rest." : ""}`}</ModeNotice>
                {checked.length > 0 ? (
                  <div>
                    <Button variant="secondary" onClick={state.retry}>
                      Retry
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {view === "all" ? (
              fullList(items, checked)
            ) : (
              <MyDaySwipePanel page={page} onChange={changePage}>
                <MyDayDashboardView
                  key={authEpoch}
                  allowSample={allowSample}
                  now={now}
                  today={today}
                  items={items}
                  renewals={renewals}
                  helpItems={helpItems}
                  checked={checked}
                  editing={editing}
                  page={page}
                  onShowAll={showAll}
                  onRetry={state.retry}
                />
              </MyDaySwipePanel>
            )}

            {/* One notice at the top at most; the quieter context is one line of small print here. */}
            {demoNote || notYet.length > 0 ? (
              <p className="max-w-reading px-3 text-sm text-[color:var(--text-muted)]" data-testid="my-day-small-print">
                {demoNote ? <span data-testid="my-day-demo-notice">Demo data: invented examples.</span> : null}
                {demoNote && notYet.length > 0 ? " " : null}
                {notYet.length > 0 ? (
                  <span data-testid="my-day-unavailable-notice">
                    {`${listNames(notYet)} ${notYet.length > 1 || rosterUnavailable ? "aren't" : "isn't"} available yet.`}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </InformationPageShell>
  );
}
