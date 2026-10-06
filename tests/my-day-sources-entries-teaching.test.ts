import { describe, expect, it } from "vitest";

import { adminMyDayItems, onCallMyDayItems } from "@/components/my-day/sources/entries";
import { teachingMyDayItems } from "@/components/my-day/sources/teaching";
import { withUnit } from "@/components/teaching/teaching-number";
import { selectNeedsYou } from "@/lib/admin/today-selectors";
import { deriveOnCallNotifications } from "@/lib/on-call/notifications";
import { DEFAULT_REMINDER_SETTINGS, updateReminderType } from "@/lib/reminders/settings";
import type { SessionRef, TeachRead } from "@/lib/teaching/depth-model";
import { complianceFixture, onCallEntryFixture } from "./helpers/on-call-entry-fixture";

// 09:00 on Sat 26 Sep 2026 in Perth, fixed in UTC so the Perth day never depends on the machine.
const NOW = new Date("2026-09-26T01:00:00Z");

const remindersOff = (type: "compliance-dates" | "on-call-checks" | "teaching") =>
  updateReminderType(DEFAULT_REMINDER_SETTINGS, type, { showInApp: false });

describe("adminMyDayItems", () => {
  const passed = complianceFixture("Fire training", { category: "Training", expiresOn: "2026-09-01" });
  const soon = complianceFixture("Medical registration", { category: "Registration", expiresOn: "2026-09-30" });
  const later = complianceFixture("Basic life support", { category: "Training", expiresOn: "2027-03-01" });

  it("lists every dated row with severity from its date and honest wording", () => {
    const items = adminMyDayItems([passed, soon, later], NOW);
    const byId = new Map(items.map((item) => [item.id, item]));

    expect(byId.get(`my-work:date:${passed.id}`)).toMatchObject({
      mode: "my-work",
      title: "Fire training",
      due: "2026-09-01",
      severity: "overdue",
      detail: "Date has passed",
      href: `/admin/renewals?item=${passed.id}`,
    });
    expect(byId.get(`my-work:date:${soon.id}`)).toMatchObject({ severity: "soon", detail: "Recorded date" });
    expect(byId.get(`my-work:date:${later.id}`)).toMatchObject({ severity: "info", detail: "Recorded date" });
  });

  it("never says expired, valid or compliant", () => {
    const text = adminMyDayItems([passed, soon, later], NOW)
      .map((item) => `${item.title} ${item.detail ?? ""}`)
      .join(" ")
      .toLowerCase();
    expect(text).not.toMatch(/expired|valid|compliant/);
  });

  it("groups everything not recorded into one item with a correct count", () => {
    const expected = selectNeedsYou([], NOW)?.notRecordedCount ?? 0;
    expect(expected).toBeGreaterThan(1);

    const notRecorded = adminMyDayItems([], NOW).filter((item) => item.id === "my-work:not-recorded");
    expect(notRecorded).toHaveLength(1);
    expect(notRecorded[0]).toMatchObject({
      title: `${expected} dates not recorded yet`,
      due: null,
      severity: "info",
      href: "/admin/renewals?show=not-recorded",
    });
  });

  it("still reports the not-recorded count when passed dates fill Needs you's capped rows", () => {
    const many = ["A", "B", "C", "D"].map((name) =>
      complianceFixture(`Passed ${name}`, { category: "Training", expiresOn: "2026-08-01" }),
    );
    const needsYou = selectNeedsYou(many, NOW);
    const expected = needsYou?.notRecordedCount ?? 0;
    expect(expected).toBeGreaterThan(0);
    const item = adminMyDayItems(many, NOW).find((entry) => entry.id === "my-work:not-recorded");
    expect(item?.title).toBe(`${expected} ${expected === 1 ? "date" : "dates"} not recorded yet`);
  });

  it("treats a future date inside its renewal window as soon, and one before it as later", () => {
    const inWindow = complianceFixture("Indemnity", { category: "Registration", expiresOn: "2026-10-20" });
    const beforeWindow = complianceFixture("Working with children", {
      category: "Clearances",
      expiresOn: "2026-12-30",
    });
    const longLead = complianceFixture("ALS", { category: "Training", expiresOn: "2026-12-30", leadTimeDays: 120 });
    const byId = new Map(adminMyDayItems([inWindow, beforeWindow, longLead], NOW).map((item) => [item.id, item]));
    // Default lead time is 30 days: 20 Oct starts renewing on 20 Sep (before today).
    expect(byId.get(`my-work:date:${inWindow.id}`)?.severity).toBe("soon");
    expect(byId.get(`my-work:date:${beforeWindow.id}`)?.severity).toBe("info");
    expect(byId.get(`my-work:date:${longLead.id}`)?.severity).toBe("soon");
  });

  it("caps the dated rows at Admin's default and adds one 'more dates' item with the right plural", () => {
    const many = Array.from({ length: 8 }, (_, n) =>
      complianceFixture(`Item ${n}`, { category: "Training", expiresOn: `2027-01-0${n + 1}` }),
    );
    const items = adminMyDayItems(many, NOW);
    expect(items.filter((item) => item.id.startsWith("my-work:date:"))).toHaveLength(6);
    expect(items.find((item) => item.id === "my-work:more")).toMatchObject({
      title: "2 more dates in Renewals",
      severity: "info",
      due: null,
      href: "/admin/renewals",
    });
    const seven = adminMyDayItems(many.slice(0, 7), NOW);
    expect(seven.find((item) => item.id === "my-work:more")?.title).toBe("1 more date in Renewals");
    expect(adminMyDayItems(many.slice(0, 6), NOW).some((item) => item.id === "my-work:more")).toBe(false);
  });

  it("takes no reminder settings: renewal dates always stay in My Day (owner decision, 5 Oct 2026)", () => {
    // Switching the compliance-date reminder off or snoozing it quietens On Call's own
    // nudges only; My Day still lists the date.
    expect(adminMyDayItems.length).toBe(2);
    expect(adminMyDayItems([passed, soon], NOW).length).toBeGreaterThan(0);
  });
});

describe("onCallMyDayItems", () => {
  const passed = complianceFixture("Fire training", { category: "Training", expiresOn: "2026-09-01" });
  const unverified = onCallEntryFixture({ section: "contacts", title: "Registrar rota", lastVerifiedAt: null });
  const stale = onCallEntryFixture({
    section: "contacts",
    title: "Switchboard",
    lastVerifiedAt: "2020-01-01T00:00:00Z",
  });

  it("leaves compliance dates to Admin, so no row is duplicated", () => {
    const derived = deriveOnCallNotifications([passed, unverified, stale], NOW);
    expect(derived.some((notification) => notification.kind === "compliance-date-passed")).toBe(true);

    const items = onCallMyDayItems([passed, unverified, stale], NOW, DEFAULT_REMINDER_SETTINGS);
    expect(items.some((item) => item.id.includes("compliance-date-passed"))).toBe(false);
    expect(items.some((item) => item.title === "Fire training")).toBe(false);
  });

  it("shows no compliance row at all, with a future date or none", () => {
    const future = complianceFixture("Future registration", { category: "Registration", expiresOn: "2027-06-01" });
    const undated = complianceFixture("Undated card", { category: "Registration" });
    expect(onCallMyDayItems([future, undated], NOW, DEFAULT_REMINDER_SETTINGS)).toEqual([]);
  });

  it("shows nothing for a colleague's shared row", () => {
    const shared = onCallEntryFixture({
      section: "contacts",
      title: "Their switchboard",
      lastVerifiedAt: "2020-01-01T00:00:00Z",
      isOwn: false,
    });
    expect(onCallMyDayItems([shared], NOW, DEFAULT_REMINDER_SETTINGS)).toEqual([]);
  });

  it("maps a long-unconfirmed row and a never-confirmed row both to info, undated", () => {
    const items = onCallMyDayItems([unverified, stale], NOW, DEFAULT_REMINDER_SETTINGS);
    const byTitle = new Map(items.map((item) => [item.title, item]));

    expect(byTitle.get("Switchboard")).toMatchObject({
      id: `on-call:${stale.id}:overdue`,
      mode: "on-call",
      severity: "info",
      due: null,
    });
    expect(byTitle.get("Registrar rota")).toMatchObject({
      id: `on-call:${unverified.id}:never-verified`,
      severity: "info",
      due: null,
    });
  });

  it("returns nothing when On Call checks are switched off", () => {
    expect(onCallMyDayItems([unverified, stale], NOW, remindersOff("on-call-checks"))).toEqual([]);
  });
});

describe("teachingMyDayItems", () => {
  const ref = (n: number, startsAt: string): SessionRef => ({
    occurrenceId: `00000000-0000-4000-8000-00000000030${n}`,
    serviceId: "00000000-0000-4000-8000-000000000999",
    title: `Talk ${n}`,
    startsAt,
    endsAt: startsAt,
  });
  const upcoming = (n: number, startsAt: string, over: Record<string, unknown> = {}) => ({
    ...ref(n, startsAt),
    venue: null,
    status: "scheduled" as const,
    items: [],
    deidConfirmedAt: null,
    ...over,
  });
  const teach = (...sessions: ReturnType<typeof upcoming>[]): TeachRead => ({ upcoming: sessions, taught: [] });

  it("says nothing when there is nothing to do or nothing has loaded", () => {
    expect(teachingMyDayItems({ unloggedCount: 0, teach: teach(), feedbackOpen: { sessions: [] } }, NOW)).toEqual([]);
    expect(teachingMyDayItems({ unloggedCount: null, teach: null, feedbackOpen: null }, NOW)).toEqual([]);
  });

  it("words and links the three rows, with plurals", () => {
    const items = teachingMyDayItems(
      {
        unloggedCount: 1,
        teach: teach(upcoming(1, "2026-09-29T00:00:00Z")),
        feedbackOpen: { sessions: [ref(2, "2026-09-24T03:00:00Z"), ref(3, "2026-09-25T03:00:00Z")] },
      },
      NOW,
    );
    expect(items.map((item) => item.href)).toEqual(["/teaching/review", "/teaching/teach", "/teaching/feedback"]);
    expect(items[0]).toMatchObject({
      title: `Review & log ${withUnit(1, "session")}`,
      due: null,
      severity: "info",
    });
    expect(items[2]).toMatchObject({ title: `Give feedback on ${withUnit(2, "sessions")}`, severity: "info" });
  });

  it("adds the catch-up row for this week's ended sessions with no check-in", () => {
    const [item] = teachingMyDayItems({ unloggedCount: 0, teach: null, feedbackOpen: null, catchUp: 2 }, NOW);
    expect(item).toMatchObject({
      id: "teaching:catch-up",
      title: `Catch up on ${withUnit(2, "sessions")}`,
      detail: "This week, no check-in recorded",
      severity: "info",
      href: "/teaching/resources#catch-up",
    });
    expect(teachingMyDayItems({ unloggedCount: 0, teach: null, feedbackOpen: null, catchUp: 0 }, NOW)).toEqual([]);
  });

  it("uses the plural for several unlogged sessions", () => {
    const [item] = teachingMyDayItems({ unloggedCount: 4, teach: null, feedbackOpen: null }, NOW);
    expect(item.title).toBe(`Review & log ${withUnit(4, "sessions")}`);
  });

  it("dates the presenter row from the next upcoming session, skipping cancelled and past ones", () => {
    const items = teachingMyDayItems(
      {
        unloggedCount: 0,
        teach: teach(
          upcoming(1, "2026-09-27T00:00:00Z", { status: "cancelled" }),
          upcoming(2, "2026-09-20T00:00:00Z"),
          upcoming(3, "2026-10-20T00:00:00Z"),
          upcoming(4, "2026-09-28T00:00:00Z"),
        ),
        feedbackOpen: null,
      },
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "teaching:prep:00000000-0000-4000-8000-000000000304",
      due: "2026-09-28T00:00:00Z",
      severity: "soon",
      href: "/teaching/teach",
    });
  });

  it("never lets presenter prep be overdue, even for a session that started earlier today", () => {
    const [item] = teachingMyDayItems(
      { unloggedCount: 0, teach: teach(upcoming(1, "2026-09-26T00:30:00Z")), feedbackOpen: null },
      NOW,
    );
    expect(item).toMatchObject({ id: "teaching:prep:00000000-0000-4000-8000-000000000301", severity: "soon" });
  });

  it("returns nothing when Teaching reminders are switched off", () => {
    const items = teachingMyDayItems(
      {
        unloggedCount: 3,
        teach: teach(upcoming(1, "2026-09-29T00:00:00Z")),
        feedbackOpen: { sessions: [ref(2, "2026-09-24T03:00:00Z")] },
      },
      NOW,
      remindersOff("teaching"),
    );
    expect(items).toEqual([]);
  });
});
