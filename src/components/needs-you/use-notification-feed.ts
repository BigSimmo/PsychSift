"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useRemindMe } from "@/components/alerts/use-remind-me";
import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { useMyDayDeviceState } from "@/components/my-day/my-day-device-state";
import { useMyDayItems } from "@/components/my-day/use-my-day-items";
import { useFeatureNotificationSources } from "@/components/needs-you/use-feature-notification-sources";
import { onCallEntryHref } from "@/components/on-call/on-call-entry-view";
import { useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { dueReminders, type Reminder } from "@/lib/alerts/remind-me";
import { myDayEnabledForAuth, type MyDayItem, type MyDaySourceResult, type MyDayState } from "@/lib/my-day/model";
import {
  myDayNotificationItem,
  onCallNotificationItem,
  summariseNotifications,
  workToday,
  withoutAdminDuplicates,
  type NotificationFeedSummary,
  type NotificationItem,
  type NotificationSource,
} from "@/lib/needs-you/feed";
import { needsYouModeLabels } from "@/lib/needs-you/groups";
import { withoutExampleRecords } from "@/lib/example-data/guards";
import { useExampleData } from "@/lib/example-data/store";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { useOnCallEntries } from "@/lib/on-call/entry-store";
import {
  deriveOnCallNotifications,
  visibleOnCallNotifications,
  type OnCallNotification,
} from "@/lib/on-call/notifications";
import { perthDateKey, snoozeReminder, type ReminderType } from "@/lib/reminders/settings";
import { useAuthSession } from "@/lib/supabase/client";

/**
 * The Notification centre's one read (work-mode redesign, owner request
 * 6 Oct 2026). It gathers every source into `NotificationSource`s, applies the
 * reader's snoozes, and returns the summary the bell badge and the sheet both
 * show, so the two numbers can never disagree.
 *
 * Sources today: My Day's work-area reads (Roster, CPD, Teaching, Admin), On
 * Call's own notifications (its honest wording kept), the junior features'
 * own selectors (`useFeatureNotificationSources`: first week pack, contract,
 * starter pack, Ready for day one, Job applications, CPD Home, term folder),
 * and the reader's own Remind me notes due today. A later feature adds items
 * by writing a hook that returns `NotificationSource[]` (see
 * `src/lib/needs-you/feed.ts`) and listing it in `sources` below. An item that
 * links to a screen the launch switch holds back is left out, so the bell
 * never opens a page this reader cannot reach. Snoozes use My Day's existing
 * account-scoped device store, so "Later" on My Day and a snooze here agree.
 * Nothing new is stored and nothing is sent anywhere.
 *
 * It is also the one source for My Day's Needs you card (work mode
 * improvements, 8 Oct 2026), so My Day's count and items always match the
 * bell, this page and the side menu. "Today" is the work time zone's day
 * (`useWorkTimeZone`, Perth unless the reader chose another), the same day My
 * Day draws, and My Day hands in the read it already made (`read`) so the two
 * never wait on different requests.
 */

export type NotificationFeedStatus = "signed-out" | "loading" | "ready" | "error";

export interface NotificationFeed {
  readonly status: NotificationFeedStatus;
  readonly sources: readonly NotificationSource[];
  readonly summary: NotificationFeedSummary;
  /** Sources whose read failed, so the sheet can say what was not checked. */
  readonly failed: readonly NotificationSource[];
  /** True when any loaded source is invented demo data. */
  readonly sample: boolean;
  /** When every source last settled, for "Checked 07:45". */
  readonly checkedAt: Date | null;
  /** The clock the groups are worked out against. */
  readonly now: Date;
  /** The work time zone's date, the same "today" My Day uses. */
  readonly today: string;
  /** The work time zone every date here is read in. */
  readonly zone: string;
  readonly online: boolean;
  /** On Call notifications by item id, for the On Call group's own list. */
  readonly onCall: ReadonlyMap<string, OnCallNotification>;
  readonly reminders: readonly Reminder[];
  readonly retry: () => void;
  readonly snooze: (itemId: string, until: string) => void;
  readonly unsnooze: (itemId: string) => void;
  /** Hides one On Call reminder type for a week (the existing reminder-settings snooze). */
  readonly snoozeOnCallType: (type: ReminderType) => void;
}

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** False only when the browser says it is offline; a server render assumes online. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
    () => true,
  );
}

const SOURCE_LABELS = needsYouModeLabels;

/**
 * My Day's reads, less its On Call rows (On Call's own list stands in for them).
 * Made-up records never notify: a source that answered with sample data adds no
 * items, and example records are dropped from the rest.
 */
function workAreaSources(sources: readonly MyDaySourceResult[]): NotificationSource[] {
  return sources
    .filter((source) => source.mode !== "on-call")
    .map((source) => ({
      id: source.mode,
      label: SOURCE_LABELS[source.mode],
      status: source.status,
      sample: source.sample,
      items: source.sample
        ? []
        : withoutExampleRecords(source.items)
            .filter((item) => item.mode !== "on-call")
            .map(myDayNotificationItem),
    }));
}

/**
 * My Day's example day, while the example data switch shows it, so the centre,
 * this page and the bell's badge list what My Day's Needs you lists (testing
 * tools finding, 7 Oct 2026). Loaded on demand, only while examples show, from
 * the same builder My Day uses; null while off or still loading.
 */
function useExampleMyDayItems(active: boolean, readAt: Date, zone: string): readonly MyDayItem[] | null {
  const [loaded, setLoaded] = useState<readonly MyDayItem[] | null>(null);
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    void import("@/components/my-day/my-day-sample").then((module) => {
      if (!cancelled) setLoaded(module.buildMyDaySample(workToday(readAt, zone), readAt).items);
    });
    return () => {
      cancelled = true;
    };
  }, [active, readAt, zone]);
  return active ? loaded : null;
}

/**
 * The example day as sources, one per area, flagged as sample. They show on
 * screen only while the switch is on: nothing here is stored or sent, and no
 * push alert or brief ever reads them (those read the account on the server).
 * Later and Remind me are left off, because both would store an example id on
 * this device.
 *
 * Examples only fill areas with nothing real in them (`realAreas`), so a real
 * On Call or Roster alert is never hidden behind an example one.
 */
function exampleSources(items: readonly MyDayItem[], realAreas: ReadonlySet<string>): NotificationSource[] {
  const modes = [...new Set(items.map((item) => item.mode))].filter((mode) => !realAreas.has(mode));
  return modes.map((mode) => ({
    id: `example:${mode}`,
    label: SOURCE_LABELS[mode],
    status: "ready" as const,
    sample: true,
    items: items
      .filter((item) => item.mode === mode)
      .map((item) => ({ ...myDayNotificationItem(item), snoozable: false, remindable: false })),
  }));
}

/** The reader's own Remind me notes that are due by the end of today and not ticked off. */
function reminderItems(
  reminders: readonly Reminder[],
  now: Date,
  zone: string,
  markDone: (id: string) => void,
): NotificationItem[] {
  const today = workToday(now, zone);
  return reminders
    .filter((reminder) => reminder.doneAt === null)
    .filter(
      (reminder) => dueReminders([reminder], now).length > 0 || workToday(new Date(reminder.dueAt), zone) === today,
    )
    .map((reminder) => ({
      id: `remind:${reminder.id}`,
      title: reminder.text,
      detail: "Your reminder",
      due: reminder.dueAt,
      area: "my-day" as const,
      href: "/my-day/alerts",
      kind: "action" as const,
      snoozable: false,
      remindable: false,
      complete: { label: "Done", run: () => markDone(reminder.id) },
    }));
}

/** The part of My Day's read the feed uses, when My Day hands in the read it already made. */
export type NotificationFeedRead = Pick<MyDayState, "status" | "items" | "sources" | "retry">;

export function useNotificationFeed({
  clock,
  read,
}: {
  readonly clock: Date;
  /** My Day's own read, so the page and its Needs you card share one; absent, the feed reads for itself. */
  readonly read?: NotificationFeedRead;
}): NotificationFeed {
  const { status: authStatus } = useAuthSession();
  const enabled = myDayEnabledForAuth(authStatus);
  // Reads start once, at mount; `clock` only re-sorts what loaded.
  const [readAt] = useState(() => new Date());
  const ownRead = useMyDayItems({ enabled: enabled && !read, now: readAt });
  const myDay = read ?? ownRead;
  const { entries, sample: onCallSample } = useOnCallEntries();
  const { preferences, setPreference } = useAppPreferences();
  const { reminders, markDone } = useRemindMe();
  const { zone } = useWorkTimeZone();
  const today = workToday(clock, zone);
  const device = useMyDayDeviceState(today);
  const online = useOnline();

  const reminderToday = perthDateKey(clock);
  const onCallList = useMemo(
    () =>
      withoutAdminDuplicates(
        // Made-up records never notify.
        visibleOnCallNotifications(
          deriveOnCallNotifications(onCallSample ? [] : withoutExampleRecords(entries), readAt),
          preferences.reminders,
          reminderToday,
        ),
        myDay.items,
      ),
    [entries, onCallSample, readAt, preferences.reminders, reminderToday, myDay.items],
  );

  const features = useFeatureNotificationSources({ enabled, clock, readAt, zone });
  const routeVisible = useWorkModeRouteVisible();
  const examplesShown = useExampleData("day").active;
  const exampleItems = useExampleMyDayItems(examplesShown, readAt, zone);

  const core = useMemo((): NotificationSource[] => {
    const onCallRead = myDay.sources.find((source) => source.mode === "on-call");
    const onCall: NotificationSource = {
      id: "on-call",
      label: SOURCE_LABELS["on-call"],
      status: onCallRead?.status ?? "ready",
      sample: onCallRead?.sample,
      items: onCallList.map((notification) =>
        onCallNotificationItem(notification, onCallEntryHref(notification.entry)),
      ),
    };
    return [onCall, ...workAreaSources(myDay.sources)];
  }, [myDay.sources, onCallList]);

  const sources = useMemo((): NotificationSource[] => {
    const remind: NotificationSource = {
      id: "reminders",
      label: "Your reminders",
      status: "ready",
      items: reminderItems(reminders, clock, zone, markDone),
    };
    const reachable = (source: NotificationSource): NotificationSource => ({
      ...source,
      items: source.items.filter((item) => routeVisible(item.href)),
    });
    const real = [...core, ...features, remind].map(reachable);
    if (!exampleItems) return real;
    // While examples show they sit beside the real items, only in areas with nothing real (never in place of them).
    const realAreas = new Set(
      real.flatMap((source) => (source.status === "ready" ? source.items.map((item) => item.area) : [])),
    );
    const examples = exampleSources(exampleItems, realAreas)
      .map(reachable)
      .filter((source) => source.items.length > 0);
    return [...real, ...examples];
  }, [core, features, reminders, clock, zone, markDone, routeVisible, exampleItems]);

  const onCall = useMemo(
    () => new Map(onCallList.map((notification) => [`on-call:${notification.id}`, notification])),
    [onCallList],
  );

  const summary = useMemo(
    () => summariseNotifications(sources, device.snoozes, clock, zone),
    [sources, device.snoozes, clock, zone],
  );

  const failed = useMemo(() => sources.filter((source) => source.status === "failed"), [sources]);
  // While examples show, the feed waits for them and for any real read still under way, so a real item never
  // turns up late beside them. Signed out there is no real read to wait for.
  const settled = examplesShown ? exampleItems !== null && myDay.status !== "loading" : myDay.status === "ready";
  // "Nothing loaded" is judged on the work-area reads; the features' device records alone are not a feed.
  const allFailed = settled && !exampleItems && core.every((source) => source.status === "failed");
  const status: NotificationFeedStatus =
    myDay.status === "signed-out" && !examplesShown
      ? "signed-out"
      : !settled
        ? "loading"
        : allFailed
          ? "error"
          : "ready";

  // "Checked 07:45": stamped each time the reads settle (a retry stamps again).
  const settledKey =
    status === "ready" || status === "error"
      ? `${exampleItems ? "example|" : ""}${myDay.sources.map((source) => source.status).join(",")}`
      : null;
  const [stamp, setStamp] = useState<{ readonly key: string; readonly at: Date } | null>(null);
  if (settledKey !== null && stamp?.key !== settledKey) setStamp({ key: settledKey, at: new Date() });
  const checkedAt = stamp?.at ?? null;

  const snoozeOnCallType = useCallback(
    (type: ReminderType) => setPreference("reminders", snoozeReminder(preferences.reminders, type, reminderToday)),
    [setPreference, preferences.reminders, reminderToday],
  );

  return {
    status,
    sources,
    summary,
    failed,
    sample: sources.some((source) => source.status === "ready" && source.sample === true),
    checkedAt,
    now: clock,
    today,
    zone,
    online,
    onCall,
    reminders,
    retry: myDay.retry,
    snooze: device.snooze,
    unsnooze: device.unsnooze,
    snoozeOnCallType,
  };
}
