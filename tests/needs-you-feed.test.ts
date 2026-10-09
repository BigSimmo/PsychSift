import { describe, expect, it } from "vitest";

import type { MyDayItem } from "@/lib/my-day/model";
import {
  areaCounts,
  featureNotificationItem,
  formatNotificationDue,
  formatSnoozeDay,
  groupNotifications,
  myDayItemKind,
  myDayNotificationItem,
  nextWorkingDay,
  notificationBadgeText,
  notificationBellLabel,
  notificationUrgency,
  onCallNotificationItem,
  summariseNotifications,
  withoutAdminDuplicates,
  workToday,
  type NotificationItem,
  type NotificationSource,
} from "@/lib/needs-you/feed";
import { myDayNeedsYouFromFeed, myDayNeedsYouItem } from "@/lib/my-day/needs-you-feed";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import type { OnCallNotification } from "@/lib/on-call/notifications";

// Tuesday 6 October 2026, 07:45 in Perth (UTC+8).
const NOW = new Date("2026-10-05T23:45:00Z");

function note(partial: Partial<NotificationItem> & Pick<NotificationItem, "id">): NotificationItem {
  return { title: partial.id, due: null, area: "roster", href: "/roster", kind: "action", ...partial };
}

function source(items: NotificationItem[], status: NotificationSource["status"] = "ready"): NotificationSource {
  return { id: "s", label: "Roster", status, items };
}

describe("next working day", () => {
  it("skips the weekend", () => {
    expect(nextWorkingDay("2026-10-06")).toBe("2026-10-07");
    expect(nextWorkingDay("2026-10-09")).toBe("2026-10-12");
    expect(nextWorkingDay("2026-10-10")).toBe("2026-10-12");
  });

  it("skips WA public holidays, including substitute days", () => {
    // Christmas Friday, Boxing Day Saturday, the substitute Monday 28 Dec.
    expect(nextWorkingDay("2026-12-24")).toBe("2026-12-29");
    // King's Birthday, Monday 28 September 2026.
    expect(nextWorkingDay("2026-09-25")).toBe("2026-09-29");
  });

  it("works past the published list, from the rules", () => {
    expect(nextWorkingDay("2030-12-24")).toBe("2030-12-27");
  });

  it("names the day plainly", () => {
    expect(formatSnoozeDay("2026-10-07", "2026-10-06")).toBe("tomorrow");
    expect(formatSnoozeDay("2026-10-12", "2026-10-09")).toBe("Mon 12 Oct");
    expect(formatSnoozeDay("2027-01-04", "2026-12-31")).toBe("Mon 4 Jan 2027");
  });
});

describe("urgency and due wording", () => {
  it("groups by the Perth day, with undated items last", () => {
    expect(notificationUrgency(note({ id: "a", due: "2026-10-05" }), NOW)).toBe("overdue");
    expect(notificationUrgency(note({ id: "b", due: "2026-10-06" }), NOW)).toBe("today");
    expect(notificationUrgency(note({ id: "c", due: "2026-10-12" }), NOW)).toBe("week");
    expect(notificationUrgency(note({ id: "d", due: "2026-10-13" }), NOW)).toBe("later");
    expect(notificationUrgency(note({ id: "e" }), NOW)).toBe("later");
    expect(notificationUrgency(note({ id: "f", overdue: true }), NOW)).toBe("overdue");
  });

  it("treats a timed item as overdue the moment it passes", () => {
    expect(notificationUrgency(note({ id: "a", due: "2026-10-05T23:30:00Z" }), NOW)).toBe("overdue");
    expect(notificationUrgency(note({ id: "b", due: "2026-10-06T01:00:00Z" }), NOW)).toBe("today");
  });

  it("says when, in Perth time, without arrows or semicolons", () => {
    expect(formatNotificationDue("2026-10-06T09:00:00Z", NOW)).toBe("Today 17:00");
    expect(formatNotificationDue("2026-10-07", NOW)).toBe("Tomorrow");
    expect(formatNotificationDue("2026-10-09", NOW)).toBe("Fri 9 Oct");
    expect(formatNotificationDue("2026-09-23", NOW)).toBe("Was due Wed 23 Sep");
    expect(formatNotificationDue("2026-10-05", NOW)).toBe("Was due yesterday");
    expect(formatNotificationDue(null, NOW)).toBe("");
    expect(formatNotificationDue("not a date", NOW)).toBe("");
  });
});

// Work mode improvements, 8 Oct 2026: the feed's "today" is the work time zone's day, the same one My Day
// draws, so near midnight the bell and My Day never disagree.
describe("the work time zone's day", () => {
  // 23:30 on Mon 5 Oct in Perth, already 02:30 on Tue 6 Oct in Sydney (daylight time).
  const LATE = new Date("2026-10-05T15:30:00Z");

  it("reads today in the zone it is given, Perth by default", () => {
    expect(workToday(LATE, "Australia/Perth")).toBe("2026-10-05");
    expect(workToday(LATE, "Australia/Sydney")).toBe("2026-10-06");
    expect(workToday(LATE)).toBe("2026-10-05");
  });

  it("judges urgency, due words and snoozes against that same day", () => {
    const due = note({ id: "a", due: "2026-10-05" });
    expect(notificationUrgency(due, LATE, "Australia/Perth")).toBe("today");
    expect(notificationUrgency(due, LATE, "Australia/Sydney")).toBe("overdue");
    expect(formatNotificationDue("2026-10-06", LATE, "Australia/Sydney")).toBe("Today");
    expect(formatNotificationDue("2026-10-05T22:00:00Z", LATE, "Australia/Sydney")).toBe("Today 09:00");
    // Snoozed until the 6th: still hidden on the 5th in Perth, back on the 6th in Sydney.
    const snoozes = { a: "2026-10-06" };
    expect(summariseNotifications([source([due])], snoozes, LATE, "Australia/Perth").count).toBe(0);
    expect(summariseNotifications([source([due])], snoozes, LATE, "Australia/Sydney").count).toBe(1);
  });
});

describe("My Day's Needs you, read from the feed", () => {
  it("lists what shows, then what Later hid, with the feed's own overdue judgement", () => {
    const summary = summariseNotifications(
      [
        source([
          note({ id: "over", due: "2026-10-01", area: "my-work", detail: "Recorded date" }),
          note({ id: "hid", due: "2026-10-09", area: "cme" }),
          note({ id: "own", area: "my-day", snoozable: false, href: "/my-day/alerts" }),
        ]),
      ],
      { hid: "2026-10-07" },
      NOW,
      "Australia/Perth",
    );
    const list = myDayNeedsYouFromFeed(summary, NOW, "Australia/Perth");
    expect(list.map((item) => [item.id, item.mode, item.severity, item.snoozable])).toEqual([
      ["over", "my-work", "overdue", true],
      ["own", "my-day", "info", false],
      ["hid", "cme", "soon", true],
    ]);
    expect(list[0]?.detail).toBe("Recorded date");
    expect(myDayNeedsYouItem(note({ id: "x", due: "2026-10-06" }), NOW, "Australia/Perth").severity).toBe("soon");
  });
});

describe("summary, filters and groups", () => {
  const items = [
    note({ id: "later", due: "2026-11-30", kind: "update", area: "my-work" }),
    note({ id: "today", due: "2026-10-06", area: "teaching" }),
    note({ id: "over", due: "2026-10-01", area: "my-work" }),
    note({ id: "week", due: "2026-10-09", area: "cme" }),
  ];

  it("sorts overdue first and counts what the badge shows", () => {
    const summary = summariseNotifications([source(items)], {}, NOW);
    expect(summary.visible.map((item) => item.id)).toEqual(["over", "today", "week", "later"]);
    expect(summary.count).toBe(4);
    expect(summary.overdue).toBe(1);
  });

  it("sets snoozed items aside until their day, and keeps ones that cannot be snoozed", () => {
    const summary = summariseNotifications(
      [source([...items, note({ id: "own", snoozable: false })])],
      { today: "2026-10-07", own: "2026-10-07", over: "2026-10-06" },
      NOW,
    );
    expect(summary.visible.map((item) => item.id)).toEqual(["over", "week", "later", "own"]);
    expect(summary.snoozed.map((entry) => entry.item.id)).toEqual(["today"]);
    expect(summary.count).toBe(4);
  });

  it("ignores sources that did not load and shows a repeated id once", () => {
    const summary = summariseNotifications(
      [source(items), source([note({ id: "today" })]), source([note({ id: "x" })], "failed")],
      {},
      NOW,
    );
    expect(summary.count).toBe(4);
  });

  it("counts areas within a segment and groups in order", () => {
    expect(areaCounts(items, "all")).toEqual([
      { area: "cme", label: "CPD", count: 1 },
      { area: "teaching", label: "Teaching", count: 1 },
      { area: "my-work", label: "Admin", count: 2 },
    ]);
    expect(areaCounts(items, "update")).toEqual([{ area: "my-work", label: "Admin", count: 1 }]);
    const groups = groupNotifications(items, NOW, "all", "my-work");
    expect(groups.map((group) => [group.label, group.items.length])).toEqual([
      ["Overdue", 1],
      ["Coming up", 1],
    ]);
  });
});

describe("source adapters", () => {
  const myDay = (partial: Partial<MyDayItem> & Pick<MyDayItem, "id" | "mode">): MyDayItem => ({
    title: "t",
    due: null,
    severity: "info",
    href: "/x",
    ...partial,
  });

  it("calls answers, logs, preps and renewals actions, and far dates updates", () => {
    expect(myDayItemKind(myDay({ id: "roster:swap:1", mode: "roster" }))).toBe("action");
    expect(myDayItemKind(myDay({ id: "cme:routine:1", mode: "cme" }))).toBe("action");
    expect(myDayItemKind(myDay({ id: "roster:sick:1", mode: "roster" }))).toBe("update");
    expect(myDayItemKind(myDay({ id: "my-work:date:1", mode: "my-work", severity: "soon" }))).toBe("action");
    expect(myDayItemKind(myDay({ id: "my-work:date:1", mode: "my-work", severity: "info" }))).toBe("update");
    expect(myDayItemKind(myDay({ id: "my-work:more", mode: "my-work" }))).toBe("update");
    expect(myDayItemKind(myDay({ id: "teaching:catch-up", mode: "teaching" }))).toBe("update");
  });

  it("keeps the source's own words, page and overdue judgement", () => {
    const item = myDayNotificationItem(
      myDay({
        id: "cme:routine:1",
        mode: "cme",
        title: "Log journal club",
        detail: "Routine due",
        severity: "overdue",
      }),
    );
    expect(item).toMatchObject({ area: "cme", title: "Log journal club", detail: "Routine due", overdue: true });
  });

  const entry = { id: "bls", title: "Basic life support" } as unknown as OnCallEntry;
  const passed: OnCallNotification = {
    id: "bls:compliance-date-passed",
    kind: "compliance-date-passed",
    title: "Basic life support",
    detail: "The date recorded for this has passed.",
    entry,
  };

  it("keeps On Call's wording and its own snooze", () => {
    const item = onCallNotificationItem(passed, "/admin/renewals#x");
    expect(item).toMatchObject({ area: "on-call", kind: "action", snoozable: false, remindable: false });
    expect(item.detail).toBe(passed.detail);
    expect(onCallNotificationItem({ ...passed, kind: "never-verified" }, "/x").kind).toBe("update");
  });

  it("drops the On Call copy of a passed date Admin already lists", () => {
    expect(withoutAdminDuplicates([passed], [{ id: "my-work:date:bls" }])).toEqual([]);
    expect(withoutAdminDuplicates([passed], [{ id: "my-work:date:other" }])).toEqual([passed]);
    const stale = { ...passed, kind: "never-verified" as const };
    expect(withoutAdminDuplicates([stale], [{ id: "my-work:date:bls" }])).toEqual([stale]);
  });
});

describe("the bell", () => {
  it("caps the badge and hides it at zero", () => {
    expect(notificationBadgeText(0)).toBe("");
    expect(notificationBadgeText(3)).toBe("3");
    expect(notificationBadgeText(10)).toBe("9+");
  });

  it("says the count in words", () => {
    expect(notificationBellLabel(null)).toBe("Notifications");
    expect(notificationBellLabel(0)).toBe("Notifications");
    expect(notificationBellLabel(1)).toBe("Notifications, 1 needs you");
    expect(notificationBellLabel(4, 2)).toBe("Notifications, 4 need you, 2 overdue");
  });
});

describe("feature items", () => {
  it("maps a feature's Needs you item field for field, with its area as the centre names it", () => {
    expect(
      featureNotificationItem({
        id: "contract-end-passed-1",
        title: "Contract end date has passed. Add your new end date",
        dueOn: "2026-10-01",
        area: "admin",
        href: "/admin/contract",
        kind: "action",
      }),
    ).toEqual({
      id: "contract-end-passed-1",
      title: "Contract end date has passed. Add your new end date",
      due: "2026-10-01",
      area: "my-work",
      href: "/admin/contract",
      kind: "action",
    });
    const areas = (["call", "admin", "cpd", "teaching", "roster"] as const).map(
      (area) => featureNotificationItem({ id: area, title: area, dueOn: null, area, href: "/", kind: "update" }).area,
    );
    expect(areas).toEqual(["on-call", "my-work", "cme", "teaching", "roster"]);
  });
});
