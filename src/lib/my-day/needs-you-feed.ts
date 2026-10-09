import type { MyDayItem, MyDaySourceMode, MyDaySeverity } from "@/lib/my-day/model";
import {
  notificationUrgency,
  type NotificationFeedSummary,
  type NotificationItem,
  type NotificationUrgency,
} from "@/lib/needs-you/feed";

/**
 * My Day's Needs you card, read from the notification feed (work mode
 * improvements, 8 Oct 2026). The feed (`useNotificationFeed`) is the one list
 * behind the bell, the Notifications page and the side menu, so drawing My
 * Day's card from it means the four always show the same items and the same
 * count. My Day only reshapes each item for its own row.
 */

/** Needs you's areas: My Day's five, plus the reader's own reminders. */
export type MyDayNeedsYouMode = MyDaySourceMode | "my-day";

/** One Needs you row. A plain My Day item fits as it is. */
export interface MyDayNeedsYouItem extends Omit<MyDayItem, "mode"> {
  readonly mode: MyDayNeedsYouMode;
  /** False when Later cannot move it (a reminder with its own time, an example). Defaults to true. */
  readonly snoozable?: boolean;
}

const SEVERITY: Readonly<Record<NotificationUrgency, MyDaySeverity>> = {
  overdue: "overdue",
  today: "soon",
  week: "soon",
  later: "info",
};

/** A feed item as a Needs you row. Overdue is the feed's own judgement, so the row and the bell agree. */
export function myDayNeedsYouItem(item: NotificationItem, now: Date, zone: string): MyDayNeedsYouItem {
  return {
    id: item.id,
    mode: item.area,
    title: item.title,
    ...(item.detail ? { detail: item.detail } : {}),
    due: item.due,
    severity: SEVERITY[notificationUrgency(item, now, zone)],
    href: item.href,
    snoozable: item.snoozable !== false,
  };
}

/**
 * The feed's whole list in the bell's order: what shows now, then what Later
 * hid. My Day hides the snoozed ones by the same snoozes the feed reads, so its
 * count is the bell's.
 */
export function myDayNeedsYouFromFeed(
  summary: NotificationFeedSummary,
  now: Date,
  zone: string,
): readonly MyDayNeedsYouItem[] {
  return [...summary.visible, ...summary.snoozed.map((entry) => entry.item)].map((item) =>
    myDayNeedsYouItem(item, now, zone),
  );
}
