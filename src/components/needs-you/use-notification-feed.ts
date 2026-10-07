"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { useRemindMe } from "@/components/alerts/use-remind-me";
import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { useMyDayDeviceState } from "@/components/my-day/my-day-device-state";
import { useMyDayItems } from "@/components/my-day/use-my-day-items";
import { onCallEntryHref } from "@/components/on-call/on-call-entry-view";
import { dueReminders, type Reminder } from "@/lib/alerts/remind-me";
import { myDayEnabledForAuth, type MyDaySourceResult } from "@/lib/my-day/model";
import {
  myDayNotificationItem,
  onCallNotificationItem,
  perthToday,
  summariseNotifications,
  withoutAdminDuplicates,
  type NotificationFeedSummary,
  type NotificationItem,
  type NotificationSource,
} from "@/lib/needs-you/feed";
import { needsYouModeLabels } from "@/lib/needs-you/groups";
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
 * Call's own notifications (its honest wording kept), and the reader's own
 * Remind me notes due today. A later feature adds items by writing a hook that
 * returns `NotificationSource[]` (see `src/lib/needs-you/feed.ts`) and listing
 * it in `useNotificationSources` below. Snoozes use My Day's existing
 * account-scoped device store, so "Later" on My Day and a snooze here agree.
 * Nothing new is stored and nothing is sent anywhere.
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
  readonly today: string;
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

/** My Day's reads, less its On Call rows (On Call's own list stands in for them). */
function workAreaSources(sources: readonly MyDaySourceResult[]): NotificationSource[] {
  return sources
    .filter((source) => source.mode !== "on-call")
    .map((source) => ({
      id: source.mode,
      label: SOURCE_LABELS[source.mode],
      status: source.status,
      sample: source.sample,
      items: source.items.filter((item) => item.mode !== "on-call").map(myDayNotificationItem),
    }));
}

/** The reader's own Remind me notes that are due by the end of today and not ticked off. */
function reminderItems(reminders: readonly Reminder[], now: Date, markDone: (id: string) => void): NotificationItem[] {
  const today = perthToday(now);
  return reminders
    .filter((reminder) => reminder.doneAt === null)
    .filter((reminder) => dueReminders([reminder], now).length > 0 || perthToday(new Date(reminder.dueAt)) === today)
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

export function useNotificationFeed({ clock }: { readonly clock: Date }): NotificationFeed {
  const { status: authStatus } = useAuthSession();
  const enabled = myDayEnabledForAuth(authStatus);
  // Reads start once, at mount; `clock` only re-sorts what loaded.
  const [readAt] = useState(() => new Date());
  const myDay = useMyDayItems({ enabled, now: readAt });
  const { entries } = useOnCallEntries();
  const { preferences, setPreference } = useAppPreferences();
  const { reminders, markDone } = useRemindMe();
  const today = perthToday(clock);
  const device = useMyDayDeviceState(today);
  const online = useOnline();

  const reminderToday = perthDateKey(clock);
  const onCallList = useMemo(
    () =>
      withoutAdminDuplicates(
        visibleOnCallNotifications(deriveOnCallNotifications(entries, readAt), preferences.reminders, reminderToday),
        myDay.items,
      ),
    [entries, readAt, preferences.reminders, reminderToday, myDay.items],
  );

  const sources = useMemo((): NotificationSource[] => {
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
    const remind: NotificationSource = {
      id: "reminders",
      label: "Your reminders",
      status: "ready",
      items: reminderItems(reminders, clock, markDone),
    };
    return [onCall, ...workAreaSources(myDay.sources), remind];
  }, [myDay.sources, onCallList, reminders, clock, markDone]);

  const onCall = useMemo(
    () => new Map(onCallList.map((notification) => [`on-call:${notification.id}`, notification])),
    [onCallList],
  );

  const summary = useMemo(
    () => summariseNotifications(sources, device.snoozes, clock),
    [sources, device.snoozes, clock],
  );

  const failed = useMemo(() => sources.filter((source) => source.status === "failed"), [sources]);
  const settled = myDay.status === "ready";
  const allFailed =
    settled && sources.filter((source) => source.id !== "reminders").every((source) => source.status === "failed");
  const status: NotificationFeedStatus =
    myDay.status === "signed-out" ? "signed-out" : !settled ? "loading" : allFailed ? "error" : "ready";

  // "Checked 07:45": stamped each time the reads settle (a retry stamps again).
  const settledKey =
    status === "ready" || status === "error" ? myDay.sources.map((source) => source.status).join(",") : null;
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
    online,
    onCall,
    reminders,
    retry: myDay.retry,
    snooze: device.snooze,
    unsnooze: device.unsnooze,
    snoozeOnCallType,
  };
}
