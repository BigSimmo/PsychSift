"use client";

import { History, LogIn, Plus, SlidersHorizontal, TriangleAlert, type LucideIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { RemindMeSheet, YourRemindersSheet } from "@/components/alerts/remind-me-sheet";
import { useRemindMe } from "@/components/alerts/use-remind-me";
import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import {
  ModeBandAction,
  PageTitleUnderBand,
  useModeBandCurrentTab,
  useModeBandHeading,
} from "@/components/mode-band/mode-band";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { useWorkUndoToast } from "@/components/mode-kit/work";
import { MyDayDashboard, type MyDayDashboardProps } from "@/components/my-day/my-day-dashboard";
import { useMyDayDeviceState } from "@/components/my-day/my-day-device-state";
import { listNames, myDayModeLabel, useMyDayNow } from "@/components/my-day/my-day-page-parts";
import {
  QuietFoot,
  QuietLabel,
  QuietList,
  QuietNote,
  QuietStamp,
  quietCard,
  quietLink,
  quietPillQuiet,
} from "@/components/my-day/my-day-quiet";
import { MyDayCustomiseSheet, MyDayQuickAddSheet } from "@/components/my-day/my-day-sheets";
import { NeedsYouRow } from "@/components/my-day/my-day-today-cards";
import { useMyDayDashboardSources } from "@/components/my-day/use-my-day-dashboard-sources";
import { useMyDayItems } from "@/components/my-day/use-my-day-items";
import { useNotificationFeed } from "@/components/needs-you/use-notification-feed";
import { EmptyState } from "@/components/primitive-recipes/feedback";
import { cn } from "@/components/ui-primitives";
import { Button } from "@/components/ui/button";
import { useWorkFrameAction } from "@/components/work-frame/work-frame-store";
import { NewWorkModeOnly, useNewWorkMode } from "@/components/work-mode-launch/work-mode-launch-provider";
import { WorkSetupPromptCard } from "@/components/work-setup/work-setup-prompt-card";
import type { AdminHelpItem } from "@/lib/admin/help-items";
import { reportAreaData, useExampleData } from "@/lib/example-data/store";
import { isSnoozed, parseMyDayPage, snoozeUntil } from "@/lib/my-day/dashboard";
import type { RenewalRow } from "@/lib/my-day/figures";
import { duePerthDate } from "@/lib/my-day/merge";
import {
  myDayEnabledForAuth,
  myDayNeedsSignIn,
  myDaySourceModes,
  type MyDayItem,
  type MyDayState,
} from "@/lib/my-day/model";
import { myDayNeedsYouFromFeed, type MyDayNeedsYouItem, type MyDayNeedsYouMode } from "@/lib/my-day/needs-you-feed";
import { MY_DAY_ALL_VIEW_HREF, MY_DAY_PATH, withMyDayReturn } from "@/lib/my-day/return-link";
import { WORK_SIDE_NOTIFICATIONS_HREF } from "@/lib/work-frame/side-nav";
import { addDaysToDate, formatPerthDay, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import { useAuthSession } from "@/lib/supabase/client";
import { zonedDateOf } from "@/lib/work-time/format";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";

const NO_RENEWALS: readonly RenewalRow[] = [];
const NO_HELP: readonly AdminHelpItem[] = [];

/**
 * The signed-out sample: invented data, downloaded only when a signed-out
 * visitor opens My Day, so it never counts towards anyone's first load.
 */
/* The sign-in dialog is closed at first paint, so it loads only when first opened. */
const AccountSetupDialog = dynamic(
  () => import("@/components/clinical-dashboard/account-setup-dialog").then((module) => module.AccountSetupDialog),
  { ssr: false },
);
function MyDaySampleLoading() {
  return (
    <div className="grid gap-3" data-testid="my-day-sample-loading" aria-hidden="true">
      <ModeModuleSkeleton rows={2} twoLine eyebrow />
      <ModeModuleSkeleton rows={3} twoLine eyebrow />
    </div>
  );
}
const MyDaySampleDashboard = dynamic(
  () => import("@/components/my-day/my-day-sample").then((module) => module.MyDaySampleDashboard),
  { ssr: false, loading: MyDaySampleLoading },
);

/** The work page column: the frame's 12px gutters and 9px rhythm, wider on a computer for Today's two columns. */
const PAGE_BODY = "mx-auto grid w-full max-w-2xl min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5 px-3 pt-3 pb-8 lg:max-w-5xl";

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
 * True once "All N" pushed the full list's address in this tab, so going back
 * can step back through history (the same as the phone's Back) rather than
 * stacking a second dashboard entry. A direct load of the full list's address
 * has nothing of ours behind it, so it replaces instead.
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

// ---------------------------------------------------------------- the full list

type DueGroup = "overdue" | "today" | "week" | "later";

const GROUP_TITLE: Readonly<Record<DueGroup, string>> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
};

/** Needs you's areas in chip order: My Day's five, then the reader's own reminders. */
const NEEDS_YOU_MODES: readonly MyDayNeedsYouMode[] = [...myDaySourceModes, "my-day"];

function needsYouModeLabel(mode: MyDayNeedsYouMode): string {
  return mode === "my-day" ? "Reminders" : myDayModeLabel(mode);
}

/** Overdue, else due today, else due within seven days, else later; no due date goes to Later. */
function dueGroup(item: MyDayNeedsYouItem, today: string): DueGroup {
  if (item.severity === "overdue") return "overdue";
  const date = duePerthDate(item.due);
  if (!date) return "later";
  if (date <= today) return "today";
  if (date <= addDaysToDate(today, 7)) return "week";
  return "later";
}

/**
 * Needs you, every item ("All N"): area chips to narrow it, then groups by
 * due date, each row with its verb and Later. Hidden rows stay listed with
 * Show, so nothing moved out of the way is lost from view.
 */
function MyDayFullList({
  items,
  today,
  now,
  checked,
  checkedAt,
  missing,
  onBack,
  onRetry,
}: {
  /** The notification feed's list, so "All N" is the bell's list. */
  readonly items: readonly MyDayNeedsYouItem[];
  readonly today: string;
  readonly now: Date;
  readonly checked: readonly string[];
  readonly checkedAt: string | null;
  /** Areas that did not load, for the stamp. */
  readonly missing: readonly string[];
  readonly onBack: () => void;
  readonly onRetry: () => void;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  // The feed hides what Later moved by the snoozes on this device, so the list uses the same ones.
  // Examples and reminders cannot be moved, so nothing invented is ever stored.
  const { snoozes, snooze, unsnooze } = useMyDayDeviceState(today);
  const toast = useWorkUndoToast();
  const [area, setArea] = useState<MyDayNeedsYouMode | "all">("all");
  // Opened from the dashboard (not a direct load): put focus, and so the view, at the top of the list.
  useEffect(() => {
    if (fullListPushed) backRef.current?.focus();
  }, []);
  useModeBandHeading({ eyebrow: "Overdue first, then by deadline", title: "Needs you" });

  const areas = NEEDS_YOU_MODES.map((mode) => ({
    mode,
    count: items.filter((item) => item.mode === mode).length,
  })).filter((entry) => entry.count > 0);
  const shown = area === "all" ? items : items.filter((item) => item.mode === area);
  const groups = (["overdue", "today", "week", "later"] as const)
    .map((key) => ({ key, items: shown.filter((item) => dueGroup(item, today) === key) }))
    .filter((group) => group.items.length > 0);
  const tomorrow = snoozeUntil(now);
  const later = (item: MyDayNeedsYouItem) => {
    snooze(item.id, tomorrow);
    toast?.(`${item.title} moved to tomorrow`, () => unsnooze(item.id));
  };

  return (
    <div className="grid min-w-0 gap-2.5" data-testid="my-day-full-list">
      {/* The band's back button is the visible way back; this one takes focus on opening and shows when focused. */}
      <div className="sr-only focus-within:not-sr-only">
        <button ref={backRef} type="button" onClick={onBack} data-testid="my-day-back" className={quietLink}>
          Back to dashboard
        </button>
      </div>
      {items.length === 0 ? (
        <div data-testid="my-day-empty" className={cn(quietCard, "grid gap-1 px-3.5 py-3")}>
          {checked.length > 0 ? (
            <>
              <p className="m-0 text-sm-minus font-bold text-[color:var(--work-ink)]">Nothing needs you right now</p>
              <p className="m-0 text-2xs text-[color:var(--text-muted)]">{`Checked ${listNames(checked)}.`}</p>
            </>
          ) : (
            <>
              <p className="m-0 text-sm-minus font-bold text-[color:var(--work-ink)]">Couldn&apos;t check your day</p>
              <p className="m-0 text-2xs text-[color:var(--text-muted)]">No source could be checked just now.</p>
              <div className="mt-1">
                <button type="button" onClick={onRetry} className={quietPillQuiet}>
                  Retry
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          <div
            role="group"
            aria-label="Show items from"
            data-no-tab-swipe=""
            data-testid="my-day-area-chips"
            className="-mx-3 flex min-w-0 gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {[{ mode: "all" as const, count: items.length }, ...areas].map((entry) => (
              <button
                key={entry.mode}
                type="button"
                aria-pressed={area === entry.mode}
                onClick={() => setArea(entry.mode)}
                data-testid={`my-day-area-${entry.mode}`}
                className={cn(
                  focusRing,
                  "relative inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-bold whitespace-nowrap before:absolute before:inset-x-0 before:-inset-y-2 before:content-[''] forced-colors:border",
                  area === entry.mode
                    ? "border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
                    : "border-[color:var(--work-line-strong)] bg-[color:var(--work-surface)] text-[color:var(--work-ink)]",
                )}
              >
                {entry.mode === "all" ? "All" : needsYouModeLabel(entry.mode)}
                <span className="font-semibold nums">{entry.count}</span>
              </button>
            ))}
          </div>
          {groups.map((group) => (
            <section
              key={group.key}
              aria-labelledby={`my-day-section-${group.key}-label`}
              data-testid={`my-day-section-${group.key}`}
              className="grid min-w-0 gap-1.5"
            >
              <QuietLabel
                id={`my-day-section-${group.key}-label`}
                title={GROUP_TITLE[group.key]}
                aside={
                  <span className="text-2xs font-bold text-[color:var(--text-muted)] nums">{group.items.length}</span>
                }
              />
              <QuietList className={quietCard}>
                {group.items.map((item) =>
                  item.snoozable !== false && isSnoozed(snoozes, item.id, today) ? (
                    <li
                      key={item.id}
                      data-testid={`my-day-item-${item.id}`}
                      className="flex min-h-12 min-w-0 items-center gap-2.5 py-2"
                    >
                      <span className="grid min-w-0 flex-1">
                        <span className="text-sm-minus font-semibold break-words text-[color:var(--text-muted)]">
                          {item.title}
                        </span>
                        <span className="text-2xs text-[color:var(--text-muted)]">
                          {`Hidden until ${snoozes[item.id] === tomorrow ? "tomorrow" : formatPerthDay(snoozes[item.id] ?? tomorrow)}`}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => unsnooze(item.id)}
                        aria-label={`Show now: ${item.title}`}
                        data-testid={`my-day-unsnooze-${item.id}`}
                        className={quietLink}
                      >
                        Show
                      </button>
                    </li>
                  ) : (
                    <NeedsYouRow key={item.id} item={item} today={today} onLater={later} />
                  ),
                )}
              </QuietList>
            </section>
          ))}
        </>
      )}
      <QuietStamp tone={checked.length === 0 ? "off" : missing.length > 0 ? "warn" : "ok"} testId="my-day-all-stamp">
        {checked.length === 0
          ? "Nothing checked yet"
          : `Checked ${checkedAt ?? "just now"} · ${
              missing.length > 0
                ? `${listNames(missing)} not loaded`
                : `all ${checked.length} ${checked.length === 1 ? "area" : "areas"} loaded`
            }`}
      </QuietStamp>
      <QuietFoot icon={History}>Later hides an item until tomorrow. Each item opens the page that owns it.</QuietFoot>
    </div>
  );
}

// ---------------------------------------------------------------- the page

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

type MyDaySheet = "customise" | "quick-add" | "remind-me" | "reminders";

/** A round glass button in the band (plus, sliders); a plain round icon button where there is no band. */
function BandButton({
  label,
  icon: Icon,
  onClick,
  testId,
}: {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly onClick: () => void;
  readonly testId: string;
}) {
  return (
    <ModeBandAction>
      {(underBand) => (
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-haspopup="dialog"
          data-testid={testId}
          className={
            underBand
              ? "work-glass-button work-band__action"
              : cn(focusRing, "grid size-12 place-items-center rounded-full text-[color:var(--mode-identity)]")
          }
        >
          <Icon aria-hidden="true" className="size-5" strokeWidth={2} />
        </button>
      )}
    </ModeBandAction>
  );
}

export function MyDayPage({ now: nowProp }: { now?: Date } = {}) {
  const { zone } = useWorkTimeZone();
  const { status: authStatus, authEpoch } = useAuthSession();
  const enabled = myDayEnabledForAuth(authStatus);
  // Only a local demo build with no sign-in may show invented examples.
  const allowSample = authStatus === "unconfigured";
  const now = useMyDayNow(nowProp);
  const today = zonedDateOf(now, zone);
  const state = useMyDayItems({ enabled, now });
  // When the sources last answered, for "Checked … at 14:05" and the offline note. Set when the
  // answer changes, never on the minute tick.
  // A plain-text summary of what answered, so a re-read that changes nothing keeps the time.
  const loadedKey = `${state.status}|${state.sources.map((source) => source.status).join(",")}|${state.items.length}`;
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly at: string | null }>(() => ({
    key: loadedKey,
    at: state.status === "ready" ? perthTimeOf(now) : null,
  }));
  if (loaded.key !== loadedKey) setLoaded({ key: loadedKey, at: state.status === "ready" ? perthTimeOf(now) : null });
  // The full list has its own address, so the phone's Back returns to the dashboard.
  const searchParams = useSearchParams();
  const view: "dashboard" | "all" = searchParams?.get("view") === "all" ? "all" : "dashboard";
  const page = parseMyDayPage(searchParams?.get("page"));
  // ?page= and ?view= are not part of the path, so the page names its own place in the frame.
  useModeBandCurrentTab(view === "all" ? "my-day-all" : `my-day-${page}`);
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
  // In a demo build "unavailable" only means the example has nothing for My Day to read there:
  // Roster's Swaps tab and Teaching both show examples, so nothing is called unavailable.
  const notYet = demoNote ? [] : [...(rosterUnavailable ? ["Roster swaps"] : []), ...otherUnavailable];
  // The example data switch alone decides the sample day. Auto mode already
  // shows it to a signed-out visitor, and an explicit off is honoured (they get
  // the sign-in state below). The frame's banner says it is made up.
  const sampleView = useExampleData("day").active;
  const ready = enabled && state.status === "ready" && !sampleView;
  // Needs you is the notification feed's list (the bell's, the Notifications page's and the side menu's),
  // read from this page's own sources and in the same work-zone day. Null until the feed settles.
  const feed = useNotificationFeed({ clock: now, read: state });
  const needsYou = useMemo(
    () =>
      feed.status === "ready" || feed.status === "error"
        ? myDayNeedsYouFromFeed(feed.summary, feed.now, feed.zone)
        : null,
    [feed.status, feed.summary, feed.now, feed.zone],
  );
  const [signInOpen, setSignInOpen] = useState(false);
  // Tells auto mode whether this day has real items, so examples never cover them.
  const realItems = enabled && state.status === "ready" ? myDayShownItems(state, false).length : null;
  useEffect(() => {
    if (realItems !== null) reportAreaData("day", realItems > 0 ? "has-data" : "empty");
  }, [realItems]);

  // ---------------------------------------------------------------- sheets
  const [sheet, setSheet] = useState<MyDaySheet | null>(null);
  const [remind, setRemind] = useState<{
    readonly text: string;
    readonly shiftEndsAt: string | null;
    /** Back to Your reminders on close, when it was opened from there. */
    readonly from: "reminders" | null;
  }>({ text: "", shiftEndsAt: null, from: null });
  const { reminders } = useRemindMe();
  const pendingReminders = reminders.filter((item) => !item.doneAt).length;
  const openRemindMe = (text?: string, shiftEndsAt?: string | null) => {
    setRemind({ text: text ?? "", shiftEndsAt: shiftEndsAt ?? null, from: null });
    setSheet("remind-me");
  };
  useWorkFrameAction("my-day-customise", ready ? () => setSheet("customise") : null);
  useWorkFrameAction("my-day-reminders", ready ? () => setSheet("reminders") : null);
  // `?sheet=customise` (from My Day's other pages) and `?sheet=reminders` (a reminder tapped in Notifications):
  // open it once, then drop the word from the address.
  const sheetParam = searchParams?.get("sheet") ?? null;
  const addressSheet = sheetParam === "customise" || sheetParam === "reminders" ? sheetParam : null;
  const [consumedSheet, setConsumedSheet] = useState<string | null>(null);
  if (ready && addressSheet && consumedSheet !== addressSheet) {
    setConsumedSheet(addressSheet);
    setSheet(addressSheet);
  }
  useEffect(() => {
    if (!addressSheet || consumedSheet !== addressSheet) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("sheet");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [addressSheet, consumedSheet]);

  const router = useRouter();
  const newWorkMode = useNewWorkMode();
  const showAll = () => {
    setSheet(null);
    // On the new work mode the full list is Notifications. The old list's address only redirects there on a
    // server load, and openFullList changes the address without one, so go straight to Notifications.
    if (newWorkMode) {
      router.push(WORK_SIDE_NOTIFICATIONS_HREF);
      return;
    }
    openFullList();
  };
  // Quick add's one suggestion: the top CPD row in Needs you.
  const suggested = items.find((item) => item.mode === "cme") ?? null;

  return (
    <InformationPageShell testId="my-day-main" width="bleed" className="bg-[color:var(--work-wash)]">
      <div className={PAGE_BODY} data-testid="my-day-body">
        {/* The band names the page; this title is for screen readers and the document outline. */}
        <div data-testid="my-day-header" className="contents">
          <PageTitleUnderBand className="sr-only">My Day</PageTitleUnderBand>
        </div>
        {ready && view === "dashboard" && page === "today" ? (
          <BandButton label="Quick add" icon={Plus} onClick={() => setSheet("quick-add")} testId="my-day-quick-add" />
        ) : null}
        {ready && view === "all" ? (
          <BandButton
            label="Customise My Day"
            icon={SlidersHorizontal}
            onClick={() => setSheet("customise")}
            testId="my-day-all-customise"
          />
        ) : null}

        {authStatus === "loading" || (enabled && state.status === "loading" && !sampleView) ? (
          <>
            <span role="status" className="sr-only">
              Loading My Day
            </span>
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" data-testid="my-day-loading" aria-hidden="true">
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
          <div className="grid min-w-0 gap-2.5" data-testid="my-day-sample">
            {needsYou ? (
              <MyDaySampleDashboard
                now={now}
                today={today}
                page={page}
                view={view}
                needsYou={needsYou}
                onShowAll={showAll}
                renderFullList={(shown, shownChecked) => (
                  <MyDayFullList
                    items={shown}
                    today={today}
                    now={now}
                    checked={shownChecked}
                    checkedAt={null}
                    missing={[]}
                    onBack={closeFullList}
                    onRetry={state.retry}
                  />
                )}
              />
            ) : (
              <MyDaySampleLoading />
            )}
          </div>
        ) : null}

        {myDayNeedsSignIn(authStatus) && !sampleView ? (
          <div className="grid gap-3" data-testid="my-day-signed-out">
            <EmptyState
              icon={LogIn}
              title="Sign in to see your day"
              body="My Day gathers your own On Call, Roster, CPD, Teaching and Admin records. Nothing is shared."
              actions={
                <Button variant="primary" onClick={() => setSignInOpen(true)}>
                  Sign in
                </Button>
              }
            />
            {signInOpen ? <AccountSetupDialog open onClose={() => setSignInOpen(false)} /> : null}
          </div>
        ) : null}

        {ready ? (
          <div className="grid min-w-0 gap-2.5" data-testid="my-day-ready">
            {/* "Set up Work": the first thing on Today, for the new work mode only. */}
            {view === "dashboard" && page === "today" ? (
              <NewWorkModeOnly>
                <WorkSetupPromptCard />
              </NewWorkModeOnly>
            ) : null}
            {failed.length > 0 ? (
              <QuietNote
                icon={TriangleAlert}
                warn
                role="alert"
                testId="my-day-failed-notice"
                title={`Couldn't load: ${failed.join(", ")}.`}
                body={
                  checked.length > 0
                    ? "Needs you may be incomplete. Showing the rest."
                    : "Nothing here can be relied on until it loads."
                }
                action={
                  checked.length > 0 ? (
                    <button type="button" onClick={state.retry} className={quietLink}>
                      Try again
                    </button>
                  ) : null
                }
              />
            ) : null}
            {view === "all" ? (
              <MyDayFullList
                items={needsYou ?? []}
                today={today}
                now={now}
                checked={checked}
                checkedAt={loaded.at}
                missing={failed}
                onBack={closeFullList}
                onRetry={state.retry}
              />
            ) : (
              <MyDayDashboardView
                key={authEpoch}
                allowSample={allowSample}
                now={now}
                today={today}
                items={items}
                needsYou={needsYou ?? []}
                renewals={renewals}
                helpItems={helpItems}
                checked={checked}
                checkedAt={loaded.at}
                incomplete={failed.length > 0}
                page={page}
                onShowAll={showAll}
                onRetry={state.retry}
                onCustomise={page === "today" ? () => setSheet("customise") : undefined}
                onRemindMe={openRemindMe}
                onOpenReminders={() => setSheet("reminders")}
                pendingReminders={pendingReminders}
                newJob={state.newJob}
              />
            )}

            {/* One notice at the top at most; the quieter context is one line of small print here. */}
            {demoNote || notYet.length > 0 ? (
              <p
                className="m-0 max-w-reading px-1 text-xs text-[color:var(--text-muted)]"
                data-testid="my-day-small-print"
              >
                {demoNote ? <span data-testid="my-day-demo-notice">Example data: made up to look around.</span> : null}
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

      {ready ? (
        <>
          <MyDayCustomiseSheet open={sheet === "customise"} onClose={() => setSheet(null)} today={today} />
          <MyDayQuickAddSheet
            open={sheet === "quick-add"}
            onClose={() => setSheet(null)}
            dateLine={longDate(today)}
            suggested={suggested}
            today={today}
            onRemindMe={() => openRemindMe()}
          />
          <RemindMeSheet
            open={sheet === "remind-me"}
            onClose={() => setSheet(remind.from)}
            now={now}
            shiftEndsAt={remind.shiftEndsAt}
            initialText={remind.text}
          />
          <YourRemindersSheet
            open={sheet === "reminders"}
            onClose={() => setSheet(null)}
            now={now}
            onAdd={() => {
              setRemind({ text: "", shiftEndsAt: null, from: "reminders" });
              setSheet("remind-me");
            }}
          />
        </>
      ) : null}
    </InformationPageShell>
  );
}
