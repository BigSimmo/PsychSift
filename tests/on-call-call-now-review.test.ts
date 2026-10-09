import { describe, expect, it } from "vitest";

import { onCallCallNowPeriod, onCallCallNowScenarios, onCallCallNowSteps } from "@/lib/on-call/call-now";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { buildOnCallReviewQueue, onCallReviewDueAt } from "@/lib/on-call/review-queue";
import {
  isWaPublicHoliday,
  WA_PUBLIC_HOLIDAYS,
  WA_PUBLIC_HOLIDAYS_LAST_YEAR,
  waPublicHolidaysByRule,
} from "@/lib/on-call/wa-public-holidays";

function entry(overrides: Partial<OnCallEntry> & Pick<OnCallEntry, "id" | "section">): OnCallEntry {
  return {
    slug: overrides.id,
    title: `Entry ${overrides.id}`,
    subtitle: null,
    body: null,
    details: overrides.section === "contacts" ? { role: "Registrar" } : {},
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: null,
    ...overrides,
  };
}

const LADDER = entry({
  id: "ladder",
  section: "playbook",
  details: {
    trigger: "Agitated patient",
    escalationSteps: [
      { order: 1, whoToCall: "Nurse in charge", when: "First" },
      { order: 2, whoToCall: "Day consultant", when: "Weekdays", phone: "08 9000 0001", hours: "in-hours" },
      { order: 3, whoToCall: "Consultant on call", when: "Nights", phone: "08 9000 0002", hours: "after-hours" },
    ],
  },
});

// Working hours are read in the viewer's own zone (`isOnCallOutOfHours`), so
// these are local wall-clock times: 10:00 on a Tuesday, and 10:00 on the WA
// King's Birthday holiday.
const TUESDAY_MORNING = new Date(2026, 8, 22, 10, 0);
const KINGS_BIRTHDAY_MORNING = new Date(2026, 8, 28, 10, 0);

describe("who do I call now", () => {
  it("leads with the in-hours steps on a working morning, keeping the others below", () => {
    const steps = onCallCallNowSteps(LADDER, TUESDAY_MORNING);
    expect(steps.map((step) => step.whoToCall)).toEqual(["Nurse in charge", "Day consultant", "Consultant on call"]);
    expect(steps.map((step) => step.appliesNow)).toEqual([true, true, false]);
  });

  it("treats a WA public holiday as after hours", () => {
    expect(onCallCallNowPeriod(KINGS_BIRTHDAY_MORNING)).toBe("after-hours");
    const steps = onCallCallNowSteps(LADDER, KINGS_BIRTHDAY_MORNING);
    expect(steps.map((step) => step.whoToCall)).toEqual(["Nurse in charge", "Consultant on call", "Day consultant"]);
  });

  it("lists only playbook entries as scenarios, in the owner's order", () => {
    const contact = entry({ id: "c", section: "contacts" });
    const second = { ...LADDER, id: "second", title: "B", sortOrder: 2 };
    expect(onCallCallNowScenarios([second, contact, LADDER]).map((item) => item.id)).toEqual(["ladder", "second"]);
  });

  it("still parses a ladder saved before steps had hours", () => {
    const old = entry({
      id: "old",
      section: "playbook",
      details: { trigger: "x", escalationSteps: [{ order: 1, whoToCall: "A", when: "B" }] },
    });
    expect(onCallCallNowSteps(old, TUESDAY_MORNING)[0]).toMatchObject({ hours: "any", appliesNow: true });
  });
});

describe("WA public holidays", () => {
  it("reads the date on the same clock as the in-hours rule: the viewer's own", () => {
    // Local fields, as isOnCallOutOfHours uses: 00:30 on the King's Birthday
    // is a holiday, 23:30 the night before is not, whatever zone runs the test.
    expect(isWaPublicHoliday(new Date(2026, 8, 28, 0, 30))).toBe(true);
    expect(isWaPublicHoliday(new Date(2026, 8, 27, 23, 30))).toBe(false);
  });

  it("never mixes clocks: a weekday morning is in hours unless that local date is a holiday", () => {
    expect(onCallCallNowPeriod(new Date(2026, 8, 29, 10, 0))).toBe("in-hours");
    expect(onCallCallNowPeriod(new Date(2026, 8, 28, 10, 0))).toBe("after-hours");
  });

  it("the rules reproduce every published year exactly, substitute days included", () => {
    for (let year = 2026; year <= WA_PUBLIC_HOLIDAYS_LAST_YEAR; year += 1) {
      const published = [...WA_PUBLIC_HOLIDAYS].filter((date) => date.startsWith(`${year}-`)).sort();
      expect(waPublicHolidaysByRule(year)).toEqual(published);
    }
  });

  it("keeps working after the published list runs out", () => {
    const year = WA_PUBLIC_HOLIDAYS_LAST_YEAR + 1;
    expect(year).toBe(2029);
    // 2029: New Year on Monday, Australia Day Friday, Easter 1 April, Anzac Day Wednesday.
    expect(waPublicHolidaysByRule(2029)).toEqual([
      "2029-01-01",
      "2029-01-26",
      "2029-03-05",
      "2029-03-30",
      "2029-04-01",
      "2029-04-02",
      "2029-04-25",
      "2029-06-04",
      "2029-09-24",
      "2029-12-25",
      "2029-12-26",
    ]);
    expect(isWaPublicHoliday(new Date(2029, 2, 30, 10))).toBe(true);
    expect(isWaPublicHoliday(new Date(2029, 3, 3, 10))).toBe(false);
  });

  it("gives the expected extra day when Anzac Day falls on Easter, and never lists a date twice", () => {
    // 2038: Easter Sunday is 25 April, so Easter Monday already covers Anzac
    // Day's Monday substitute; the extra day is Tuesday 27 April.
    const april2038 = waPublicHolidaysByRule(2038).filter((d) => d.startsWith("2038-04"));
    expect(april2038).toEqual(["2038-04-23", "2038-04-25", "2038-04-26", "2038-04-27"]);
    // 2011: Anzac Day was Easter Monday; WA proclaimed Tuesday 26 April.
    expect(waPublicHolidaysByRule(2011).filter((d) => d.startsWith("2011-04"))).toEqual([
      "2011-04-22",
      "2011-04-24",
      "2011-04-25",
      "2011-04-26",
    ]);
    for (let year = 2026; year <= 2100; year += 1) {
      const days = waPublicHolidaysByRule(year);
      expect(new Set(days).size).toBe(days.length);
    }
  });

  it("handles every Christmas weekday arrangement", () => {
    // Saturday Christmas (2027), Sunday Christmas (2022), Friday Christmas (2026).
    expect(waPublicHolidaysByRule(2027).filter((d) => d.startsWith("2027-12"))).toEqual([
      "2027-12-25",
      "2027-12-26",
      "2027-12-27",
      "2027-12-28",
    ]);
    expect(waPublicHolidaysByRule(2022).filter((d) => d.startsWith("2022-12"))).toEqual([
      "2022-12-25",
      "2022-12-26",
      "2022-12-27",
    ]);
    expect(waPublicHolidaysByRule(2026).filter((d) => d.startsWith("2026-12"))).toEqual([
      "2026-12-25",
      "2026-12-26",
      "2026-12-28",
    ]);
  });

  it("covers every year up to the last listed one", () => {
    for (let year = 2026; year <= WA_PUBLIC_HOLIDAYS_LAST_YEAR; year += 1) {
      expect([...WA_PUBLIC_HOLIDAYS].filter((date) => date.startsWith(`${year}-`)).length).toBeGreaterThanOrEqual(11);
    }
  });
});

describe("review queue", () => {
  const NOW = new Date("2026-09-25T02:00:00Z");

  it("groups never checked, overdue and due within 30 days, and leaves the rest out", () => {
    const queue = buildOnCallReviewQueue(
      [
        entry({ id: "never", section: "contacts" }),
        entry({ id: "overdue", section: "contacts", lastVerifiedAt: "2025-08-01T00:00:00Z" }),
        entry({ id: "soon", section: "contacts", lastVerifiedAt: "2025-10-10T00:00:00Z" }),
        entry({ id: "fine", section: "contacts", lastVerifiedAt: "2026-06-01T00:00:00Z" }),
        entry({ id: "theirs", section: "contacts", isOwn: false }),
      ],
      NOW,
    );
    expect(queue.neverChecked.map((item) => item.entry.id)).toEqual(["never"]);
    expect(queue.overdue.map((item) => item.entry.id)).toEqual(["overdue"]);
    expect(queue.dueSoon.map((item) => item.entry.id)).toEqual(["soon"]);
    expect(queue.total).toBe(3);
  });

  it("leaves compliance records out", () => {
    const compliance = entry({
      id: "ahpra",
      section: "logistics",
      details: { category: "Registration", kind: "compliance" },
    });
    expect(buildOnCallReviewQueue([compliance], NOW).total).toBe(0);
  });

  it("clamps a leap-day check to the end of February", () => {
    expect(onCallReviewDueAt("2028-02-29T00:00:00Z")?.toISOString()).toBe("2029-02-28T00:00:00.000Z");
    expect(onCallReviewDueAt(null)).toBeNull();
  });
});
