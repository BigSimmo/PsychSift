import { describe, expect, it } from "vitest";

import {
  BELL_PHONE_QUEUE_LIMIT,
  bellAlertAt,
  bellPhoneQueueChanges,
  newBellPhoneRef,
  normalizeBellPhoneQueue,
  planBellPhoneAlerts,
} from "@/lib/alerts/bell-phone";
import type { NotificationItem } from "@/lib/needs-you/feed";
import { DEFAULT_REMINDER_SETTINGS, mergeReminderSettings, normalizeReminderSettings } from "@/lib/reminders/settings";

const perth = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`);
const NOW = perth("2026-10-09", "08:00");

const on = mergeReminderSettings(DEFAULT_REMINDER_SETTINGS, { bellPhone: { enabled: true } });

function item(overrides: Partial<NotificationItem> & { id: string }): NotificationItem {
  return {
    title: "Contract ends",
    due: "2026-10-10",
    area: "my-work",
    href: "/my-work/contract",
    kind: "action",
    ...overrides,
  };
}

describe("when a bell reminder buzzes", () => {
  it("buzzes a date-only item at 09:00 Perth on its day", () => {
    expect(new Date(bellAlertAt("2026-10-10", on)!).toISOString()).toBe(perth("2026-10-10", "09:00").toISOString());
  });

  it("buzzes a timed item at its own instant", () => {
    const due = perth("2026-10-09", "14:30").toISOString();
    expect(bellAlertAt(due, on)).toBe(Date.parse(due));
  });

  it("waits for quiet hours to end", () => {
    const quiet = mergeReminderSettings(on, { quietHours: { enabled: true, start: "21:00", end: "07:00" } });
    expect(new Date(bellAlertAt(perth("2026-10-09", "23:00").toISOString(), quiet)!).toISOString()).toBe(
      perth("2026-10-10", "07:00").toISOString(),
    );
  });

  it("has no time for an undated or unreadable item", () => {
    expect(bellAlertAt(null, on)).toBeNull();
    expect(bellAlertAt("soon", on)).toBeNull();
  });
});

describe("which bell items buzz", () => {
  it("buzzes nothing while the reader has not turned it on", () => {
    expect(planBellPhoneAlerts([item({ id: "a" })], DEFAULT_REMINDER_SETTINGS, NOW)).toEqual([]);
  });

  it("queues a future action with its alert time", () => {
    expect(planBellPhoneAlerts([item({ id: "a" })], on, NOW)).toEqual([
      { key: "a", dueAt: perth("2026-10-10", "09:00").toISOString() },
    ]);
  });

  it("leaves out updates, overdue items, past times, Remind me notes and example records", () => {
    const items = [
      item({ id: "update", kind: "update" }),
      item({ id: "late", overdue: true }),
      item({ id: "today-gone", due: "2026-10-08" }),
      item({ id: "remind:r1", area: "my-day" }),
      item({ id: "example:contract" }),
      item({ id: "sample-row" }),
      item({ id: "far", due: "2026-10-30" }),
    ];
    expect(planBellPhoneAlerts(items, on, NOW, new Set(["sample-row"]))).toEqual([]);
  });

  it("leaves out an area the reader switched off", () => {
    const noAdmin = mergeReminderSettings(on, { bellPhone: { areas: { "my-work": false } } });
    expect(planBellPhoneAlerts([item({ id: "a" }), item({ id: "b", area: "cme" })], noAdmin, NOW)).toEqual([
      { key: "b", dueAt: perth("2026-10-10", "09:00").toISOString() },
    ]);
  });

  it("keeps the soonest few only", () => {
    const items = Array.from({ length: 8 }, (_, index) =>
      item({ id: `i${index}`, due: perth("2026-10-09", `1${index}:00`).toISOString() }),
    ).reverse();
    const plan = planBellPhoneAlerts(items, on, NOW);
    expect(plan).toHaveLength(BELL_PHONE_QUEUE_LIMIT);
    expect(plan[0]?.key).toBe("i0");
  });
});

describe("keeping the server queue in step", () => {
  let next = 0;
  const makeRef = () => `w-new${(next += 1)}`;
  const at = (time: string) => perth("2026-10-09", time).toISOString();

  it("adds what is new and leaves what is unchanged", () => {
    const changes = bellPhoneQueueChanges(
      [{ ref: "w-old", key: "a", dueAt: at("10:00") }],
      [
        { key: "a", dueAt: at("10:00") },
        { key: "b", dueAt: at("11:00") },
      ],
      NOW,
      true,
      makeRef,
    );
    expect(changes.remove).toEqual([]);
    expect(changes.add.map((entry) => entry.key)).toEqual(["b"]);
  });

  it("replaces an entry whose due moved", () => {
    const changes = bellPhoneQueueChanges(
      [{ ref: "w-old", key: "a", dueAt: at("10:00") }],
      [{ key: "a", dueAt: at("12:00") }],
      NOW,
      false,
      makeRef,
    );
    expect(changes.remove.map((entry) => entry.ref)).toEqual(["w-old"]);
    expect(changes.add.map((entry) => entry.dueAt)).toEqual([at("12:00")]);
  });

  it("takes off a gone item only when every source was read", () => {
    const queued = [{ ref: "w-old", key: "a", dueAt: at("10:00") }];
    expect(bellPhoneQueueChanges(queued, [], NOW, false, makeRef).remove).toEqual([]);
    expect(bellPhoneQueueChanges(queued, [], NOW, true, makeRef).remove).toEqual(queued);
  });

  it("forgets an entry whose time has passed without asking the server", () => {
    const changes = bellPhoneQueueChanges([{ ref: "w-old", key: "a", dueAt: at("07:00") }], [], NOW, true, makeRef);
    expect(changes).toEqual({ add: [], remove: [] });
  });

  it("never queues more than the limit", () => {
    const wanted = Array.from({ length: 9 }, (_, index) => ({ key: `k${index}`, dueAt: at(`1${index}:00`) }));
    expect(bellPhoneQueueChanges([], wanted, NOW, true, makeRef).add).toHaveLength(BELL_PHONE_QUEUE_LIMIT);
  });
});

describe("queue ids and the stored queue", () => {
  it("makes an opaque id the server accepts", () => {
    const ref = newBellPhoneRef(() => "1b4e28ba-2fa1-11d2-883f-0016d3cca427");
    expect(ref).toMatch(/^w-[A-Za-z0-9]{1,62}$/);
    expect(ref).not.toContain("contract");
  });

  it("drops anything unreadable from storage", () => {
    expect(
      normalizeBellPhoneQueue([
        { ref: "w-ok", key: "a", dueAt: "2026-10-09T02:00:00.000Z" },
        { ref: "r123", key: "a", dueAt: "2026-10-09T02:00:00.000Z" },
        { ref: "w-bad", key: "a", dueAt: "never" },
        null,
      ]),
    ).toEqual([{ ref: "w-ok", key: "a", dueAt: "2026-10-09T02:00:00.000Z" }]);
    expect(normalizeBellPhoneQueue("garbage")).toEqual([]);
  });
});

describe("bell phone settings", () => {
  it("is off by default with every area on", () => {
    const settings = normalizeReminderSettings({});
    expect(settings.bellPhone.enabled).toBe(false);
    expect(Object.values(settings.bellPhone.areas).every(Boolean)).toBe(true);
  });

  it("keeps the areas a patch leaves out", () => {
    const off = mergeReminderSettings(on, { bellPhone: { areas: { cme: false } } });
    const again = mergeReminderSettings(off, { bellPhone: { enabled: false } });
    expect(again.bellPhone.areas.cme).toBe(false);
    expect(again.bellPhone.areas.teaching).toBe(true);
  });

  it("repairs a broken stored value", () => {
    const settings = normalizeReminderSettings({ bellPhone: { enabled: "yes", areas: { cme: 1, roster: false } } });
    expect(settings.bellPhone.enabled).toBe(false);
    expect(settings.bellPhone.areas.cme).toBe(true);
    expect(settings.bellPhone.areas.roster).toBe(false);
  });
});
