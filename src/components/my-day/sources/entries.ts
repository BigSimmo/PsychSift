"use client";

import { useMemo } from "react";

import { renewalsItemHref, renewalsShowHref } from "@/components/admin/today/today-hrefs";
import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { onCallEntryHref } from "@/components/on-call/on-call-entry-view";
import { buildAdminHelpItems, type AdminHelpItem } from "@/lib/admin/help-items";
import {
  adminLoadState,
  selectAdminOwnEntries,
  selectAdminSharedEntries,
  type AdminLoadState,
} from "@/lib/admin/own-entries";
import { renewalStartOn } from "@/lib/admin/renewal-dates";
import { selectComingUp, selectNeedsYou } from "@/lib/admin/today-selectors";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { myDaySeverityForDue } from "@/lib/my-day/merge";
import type { RenewalRow } from "@/lib/my-day/figures";
import type { MyDayItem, MyDayNextRenewal, MyDaySourceResult, MyDaySourceStatus } from "@/lib/my-day/model";
import { isComplianceEntry } from "@/lib/on-call/compliance";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { useOnCallEntries } from "@/lib/on-call/entry-store";
import { deriveOnCallNotifications, visibleOnCallNotifications } from "@/lib/on-call/notifications";
import {
  DEFAULT_REMINDER_SETTINGS,
  perthDateKey,
  showsReminderInApp,
  type ReminderSettings,
} from "@/lib/reminders/settings";

/**
 * Admin ("my-work") and On Call share one read of the reader's On Call entries,
 * so there is a single network request. Admin owns the compliance-date rows;
 * On Call contributes only its freshness notifications, so no row appears twice.
 *
 * Wording follows the compliance rule: a recorded date is "Recorded date" or
 * "Date has passed", never a statement about the reader's standing.
 *
 * Deliberate decision: My Day gates Admin items on the "compliance-dates"
 * reminder, unlike Admin's own pages, which always show the reader's dates.
 * My Day is a nudge surface, so the reader's reminder choice decides whether
 * it nudges.
 */

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

export function adminMyDayItems(
  own: readonly OnCallEntry[],
  now: Date,
  reminders: ReminderSettings = DEFAULT_REMINDER_SETTINGS,
): MyDayItem[] {
  if (!showsReminderInApp(reminders, "compliance-dates", perthDateKey(now))) return [];
  const items: MyDayItem[] = [];
  const today = perthCalendarDate(now);
  const entryById = new Map(own.map((entry) => [entry.id, entry]));

  const comingUp = selectComingUp(own, now);
  for (const group of comingUp.groups) {
    for (const row of group.rows) {
      let severity = myDaySeverityForDue(row.expiresOn, now);
      // A future date inside its renewal window is "soon", as Admin's "Renew next" treats it.
      if (severity === "info") {
        const entry = entryById.get(row.entryId);
        const start = entry ? renewalStartOn(entry) : undefined;
        if (start && today >= start) severity = "soon";
      }
      items.push({
        id: `my-work:date:${row.entryId}`,
        mode: "my-work",
        title: row.title,
        detail: severity === "overdue" ? "Date has passed" : "Recorded date",
        due: row.expiresOn,
        severity,
        href: renewalsItemHref(row.entryId),
      });
    }
  }
  const more = comingUp.total - comingUp.shown;
  if (more > 0) {
    items.push({
      id: "my-work:more",
      mode: "my-work",
      title: `${more} more ${plural(more, "date", "dates")} in Renewals`,
      due: null,
      severity: "info",
      href: "/admin/renewals",
    });
  }

  const needsYou = selectNeedsYou(own, now);
  // Count from the selector, not the capped rows: a cap can drop the grouped row while dates are still unrecorded.
  const count = needsYou?.notRecordedCount ?? 0;
  if (count > 0) {
    items.push({
      id: "my-work:not-recorded",
      mode: "my-work",
      title: `${count} ${plural(count, "date", "dates")} not recorded yet`,
      due: null,
      severity: "info",
      href: renewalsShowHref("not-recorded"),
    });
  }
  return items;
}

/**
 * The first recorded date still ahead (today or later) in Admin's own "Coming
 * up" list, for the dashboard's "Next renewal" card. Passed dates are already
 * "Needs you" rows, so they are not counted again here. Unlike the items, this
 * is not gated on the reminder: it is a figure Admin's own pages always show.
 */
export function adminNextRenewal(own: readonly OnCallEntry[], now: Date, sample: boolean): MyDayNextRenewal | null {
  const today = perthCalendarDate(now);
  // Uncapped: the capped list fills with passed dates first, which would hide a future one.
  for (const group of selectComingUp(own, now, { limit: Number.MAX_SAFE_INTEGER }).groups) {
    if (group.kind === "passed") continue;
    const row = group.rows.find((candidate) => candidate.expiresOn >= today);
    if (row) {
      return {
        entryId: row.entryId,
        title: row.title,
        date: row.expiresOn,
        href: renewalsItemHref(row.entryId),
        sample,
      };
    }
  }
  return null;
}

/**
 * Every recorded Admin date from passed to a year ahead, earliest first, for
 * the renewals runway and the credentials wallet. Uncapped, unlike Admin's
 * "Coming up" card, and not gated on the reminder (Admin always shows them).
 */
export function adminRenewalRows(own: readonly OnCallEntry[], now: Date): RenewalRow[] {
  return selectComingUp(own, now, { limit: Number.MAX_SAFE_INTEGER }).groups.flatMap((group) =>
    group.rows.map((row) => ({
      entryId: row.entryId,
      title: row.title,
      date: row.expiresOn,
      href: renewalsItemHref(row.entryId),
    })),
  );
}

export function onCallMyDayItems(entries: readonly OnCallEntry[], now: Date, reminders: ReminderSettings): MyDayItem[] {
  return visibleOnCallNotifications(deriveOnCallNotifications(entries, now), reminders, perthDateKey(now))
    .filter(
      (notification) =>
        // Admin owns compliance rows; a colleague's shared row is not the reader's work.
        notification.kind !== "compliance-date-passed" &&
        !isComplianceEntry(notification.entry) &&
        notification.entry.isOwn !== false,
    )
    .map((notification) => ({
      id: `on-call:${notification.id}`,
      mode: "on-call" as const,
      title: notification.title,
      detail: notification.detail,
      due: null,
      severity: "info" as const,
      href: onCallEntryHref(notification.entry),
    }));
}

const NO_RENEWALS: readonly RenewalRow[] = [];
const NO_HELP_ITEMS: readonly AdminHelpItem[] = [];

const STATUS_BY_LOAD: Record<AdminLoadState, MyDaySourceStatus> = {
  loading: "loading",
  failed: "failed",
  "signed-out": "signed-out",
  ready: "ready",
};

const NO_ENTRIES: readonly OnCallEntry[] = [];

export function useEntriesMyDaySources({ enabled, now }: { enabled: boolean; now: Date }): {
  admin: MyDaySourceResult;
  onCall: MyDaySourceResult;
  /** Undefined until Admin's read is ready. */
  nextRenewal: MyDayNextRenewal | null | undefined;
  /** Every recorded Admin date (passed to a year ahead); empty until Admin's read is ready. */
  renewals: readonly RenewalRow[];
  /** Admin's Help items (the reader's own and shared numbers), for pinned numbers; empty until ready. */
  helpItems: readonly AdminHelpItem[];
  /** The reader's own Admin entries, for Renew next and the renewals timeline; empty until ready. */
  adminEntries: readonly OnCallEntry[];
  retry: () => void;
} {
  // `useOnCallEntries` fetches unconditionally and cannot be disabled; it is
  // still called every render (hooks rules) and ignored while signed out.
  const state = useOnCallEntries();
  const { preferences } = useAppPreferences();
  const reminders = preferences.reminders;
  const load = adminLoadState(state);
  const { entries, demoMode, retry } = state;

  const own = useMemo(() => selectAdminOwnEntries({ entries, demoMode }), [entries, demoMode]);
  const status: MyDaySourceStatus = enabled ? STATUS_BY_LOAD[load] : "signed-out";
  const ready = enabled && load === "ready";

  const admin = useMemo<MyDaySourceResult>(
    () => ({
      mode: "my-work",
      status,
      items: ready ? adminMyDayItems(own, now, reminders) : [],
      sample: enabled && demoMode,
    }),
    [status, ready, own, now, reminders, enabled, demoMode],
  );
  const onCall = useMemo<MyDaySourceResult>(
    () => ({
      mode: "on-call",
      status,
      items: ready ? onCallMyDayItems(entries, now, reminders) : [],
      sample: enabled && demoMode,
    }),
    [status, ready, entries, now, reminders, enabled, demoMode],
  );
  const nextRenewal = useMemo(
    () => (ready ? adminNextRenewal(own, now, enabled && demoMode) : undefined),
    [ready, own, now, enabled, demoMode],
  );
  const renewals = useMemo(() => (ready ? adminRenewalRows(own, now) : NO_RENEWALS), [ready, own, now]);
  const helpItems = useMemo(
    () =>
      ready
        ? buildAdminHelpItems({ own, shared: selectAdminSharedEntries({ entries, demoMode }), statewide: [] })
        : NO_HELP_ITEMS,
    [ready, own, entries, demoMode],
  );
  const adminEntries = ready ? own : NO_ENTRIES;
  return { admin, onCall, nextRenewal, renewals, helpItems, adminEntries, retry };
}
