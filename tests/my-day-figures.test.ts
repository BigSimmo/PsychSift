// The My Day dashboard's figures (design review v13): every number on the
// Today, Work and Me cards comes from these pure helpers over real records.
// Hours reuse Roster's own maths and make no judgement; CPD counts unarchived
// activities only; the renewals runway marks only passed dates.

import { describe, expect, it } from "vitest";

import type { CmeEntry } from "@/lib/cme/types";
import type { MyDayItem } from "@/lib/my-day/model";
import {
  addMonths,
  buildDayRibbon,
  cpdCategoryTargets,
  cpdHoursByCategory,
  cpdHoursByMonth,
  cpdProjectedHours,
  heatLevel,
  hoursBars,
  initialsOf,
  kindsByDate,
  monthGlance,
  monthTitle,
  monthWeeks,
  myDayActionLabel,
  renewalsRunway,
  selectFlagItems,
  shortDayMonth,
  spreadLabels,
} from "@/lib/my-day/figures";

// 12:40 on Sat 3 Oct 2026 in Perth (UTC+8).
const NOW = new Date("2026-10-03T04:40:00Z");
const TODAY = "2026-10-03";

function item(id: string, severity: MyDayItem["severity"], overrides: Partial<MyDayItem> = {}): MyDayItem {
  return { id, mode: "my-work", title: `Title ${id}`, due: null, severity, href: `/admin/${id}`, ...overrides };
}

describe("selectFlagItems", () => {
  it("takes overdue items first, then soon ones, never info or moved items, three at most", () => {
    const items = [
      item("s1", "soon"),
      item("i", "info"),
      item("o1", "overdue"),
      item("s2", "soon"),
      item("o2", "overdue"),
    ];
    expect(selectFlagItems(items, () => false).map((row) => row.id)).toEqual(["o1", "o2", "s1"]);
    expect(selectFlagItems(items, (id) => id === "o1").map((row) => row.id)).toEqual(["o2", "s1", "s2"]);
    expect(selectFlagItems([item("i", "info")], () => false)).toEqual([]);
  });
});

describe("myDayActionLabel", () => {
  it("says Log for CPD, Book for a course or module, and Open otherwise", () => {
    expect(myDayActionLabel({ mode: "cme", title: "Journal club" })).toBe("Log");
    expect(myDayActionLabel({ mode: "my-work", title: "Basic life support module" })).toBe("Book");
    expect(myDayActionLabel({ mode: "my-work", title: "Medical registration renewal" })).toBe("Open");
    expect(myDayActionLabel({ mode: "on-call", title: "Handover course" })).toBe("Open");
  });
});

describe("buildDayRibbon", () => {
  it("spans today's events from the hour before the first, with a now marker", () => {
    const ribbon = buildDayRibbon(
      [
        { id: "day", startsAt: "2026-10-03T00:00:00Z", endsAt: "2026-10-03T04:30:00Z", kind: "shift" },
        { id: "talk", startsAt: "2026-10-03T06:00:00Z", endsAt: "2026-10-03T07:00:00Z", kind: "other" },
        { id: "call", startsAt: "2026-10-03T09:00:00Z", endsAt: "2026-10-04T00:30:00Z", kind: "shift" },
      ],
      NOW,
    )!;
    expect(ribbon.labels.map((label) => label.text)).toEqual(["08:00", "14:00", "17:00", "08:30"]);
    expect(ribbon.segments.map((segment) => segment.key)).toEqual(["day", "talk", "call"]);
    expect(ribbon.now).toBeCloseTo((4 * 60 + 40) / (24 * 60 + 30), 5);
  });

  it("draws nothing without an event today, or over a span longer than a day and a half", () => {
    expect(buildDayRibbon([], NOW)).toBeNull();
    expect(
      buildDayRibbon(
        [{ id: "tomorrow", startsAt: "2026-10-04T01:00:00Z", endsAt: "2026-10-04T02:00:00Z", kind: "shift" }],
        NOW,
      ),
    ).toBeNull();
    expect(
      buildDayRibbon(
        [{ id: "long", startsAt: "2026-10-03T01:00:00Z", endsAt: "2026-10-05T01:00:00Z", kind: "shift" }],
        NOW,
      ),
    ).toBeNull();
  });
});

describe("the month", () => {
  it("lays out October 2026 Monday first, padded with blanks", () => {
    const weeks = monthWeeks("2026-10");
    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual([null, null, null, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(weeks[4]![5]).toBe("2026-10-31");
    expect(weeks[4]![6]).toBeNull();
  });

  it("moves across years and names the month", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthTitle("2026-10")).toBe("October 2026");
  });

  it("puts a shift on the Perth day it starts, once per kind", () => {
    const map = kindsByDate([
      { startsAt: "2026-10-02T16:30:00Z", kind: "day" }, // 00:30 Sat in Perth
      { startsAt: "2026-10-03T09:00:00Z", kind: "on_call" },
      { startsAt: "2026-10-03T10:00:00Z", kind: "on_call" },
    ]);
    expect(map.get("2026-10-03")).toEqual(["day", "on_call"]);
    expect(map.has("2026-10-02")).toBe(false);
  });
});

describe("hours", () => {
  const shifts = [
    { startsAt: "2026-09-28T00:00:00Z", endsAt: "2026-09-28T09:00:00Z", kind: "day" as const },
    { startsAt: "2026-10-01T13:00:00Z", endsAt: "2026-10-02T00:00:00Z", kind: "night" as const },
    { startsAt: "2026-10-03T09:00:00Z", endsAt: "2026-10-04T00:30:00Z", kind: "on_call" as const },
    { startsAt: "2026-09-21T00:00:00Z", endsAt: "2026-09-21T08:00:00Z", kind: "day" as const },
  ];

  it("counts this week's worked hours Monday to Sunday, leaving on call out", () => {
    const week = hoursBars(shifts, TODAY, "week");
    expect(week.start).toBe("2026-09-28");
    expect(week.end).toBe("2026-10-04");
    expect(week.days).toHaveLength(7);
    expect(week.totalHours).toBe(20);
    expect(week.days.find((day) => day.date === "2026-10-01")).toMatchObject({ night: true });
    expect(week.averageWorkedDay).toBe(10);
  });

  it("counts a fortnight of fourteen days", () => {
    const fortnight = hoursBars(shifts, TODAY, "fortnight");
    expect(fortnight.days).toHaveLength(14);
    expect(fortnight.totalHours).toBeGreaterThanOrEqual(20);
  });

  it("gives four weeks ending this Sunday for the month at a glance", () => {
    const glance = monthGlance(shifts, TODAY);
    expect(glance.start).toBe("2026-09-07");
    expect(glance.end).toBe("2026-10-04");
    expect(glance.days).toHaveLength(28);
    expect(glance.totalHours).toBe(28);
  });

  it("shades a day by hours with no judgement", () => {
    expect([0, 4, 8, 12].map(heatLevel)).toEqual([0, 1, 2, 3]);
    expect(heatLevel(Number.NaN)).toBe(0);
  });
});

describe("CPD", () => {
  const entries = [
    {
      id: "a",
      date: "2026-03-10",
      archivedAt: null,
      allocations: [
        { category: "educational", hours: 10 },
        { category: "reviewing", hours: 2.5 },
      ],
    },
    { id: "b", date: "2026-09-02", archivedAt: null, allocations: [{ category: "measuring", hours: 4 }] },
    { id: "c", date: "2026-09-03", archivedAt: "2026-09-04", allocations: [{ category: "measuring", hours: 99 }] },
    { id: "d", date: "2025-12-30", archivedAt: null, allocations: [{ category: "educational", hours: 7 }] },
  ] as unknown as CmeEntry[];

  it("totals hours by CPD type, unarchived only", () => {
    expect(cpdHoursByCategory(entries)).toEqual({ educational: 17, reviewing: 2.5, measuring: 4 });
  });

  it("totals hours by month of the given year", () => {
    const months = cpdHoursByMonth(entries, 2026);
    expect(months).toHaveLength(12);
    expect(months[2]).toBe(12.5);
    expect(months[8]).toBe(4);
    expect(months.reduce((sum, hours) => sum + hours, 0)).toBe(16.5);
  });

  it("projects to 31 December at the pace so far, and says nothing before any hours", () => {
    expect(cpdProjectedHours(0, TODAY)).toBeNull();
    // 32 h over 276 days, times 365.
    expect(cpdProjectedHours(32, TODAY)).toBe(42);
  });

  it("reads per-type targets only from a confirmed requirement set", () => {
    expect(
      cpdCategoryTargets([
        { spec: { shape: "hours-in-category", category: "educational", minimumHours: 12.5 } },
        { spec: { shape: "hours-across-categories", categories: ["reviewing", "measuring"], minimumEachHours: 5 } },
        { spec: { shape: "total-hours", minimumHours: 50 } },
      ]),
    ).toEqual({ educational: 12.5, reviewing: 5, measuring: 5 });
    expect(cpdCategoryTargets([])).toEqual({ educational: null, reviewing: null, measuring: null });
  });
});

describe("renewals runway", () => {
  const row = (entryId: string, date: string) => ({
    entryId,
    title: entryId,
    date,
    href: `/admin/renewals?item=${entryId}`,
  });

  it("keeps dates up to six months ahead plus any that have passed, in date order", () => {
    const points = renewalsRunway(
      [row("far", "2027-06-01"), row("nov", "2026-11-24"), row("sep", "2026-09-21")],
      TODAY,
    );
    expect(points.map((point) => [point.entryId, point.passed])).toEqual([
      ["sep", true],
      ["nov", false],
    ]);
    expect(points[0]!.at).toBe(0);
    expect(points[1]!.at).toBeCloseTo(52 / 183, 5);
  });

  it("spreads crowded labels apart and keeps them on the line", () => {
    const spread = spreadLabels([0, 0.05, 0.1, 0.9], 1 / 3);
    for (let index = 1; index < spread.length; index += 1)
      expect(spread[index]! - spread[index - 1]!).toBeGreaterThanOrEqual(1 / 3 - 1e-9);
    expect(Math.min(...spread)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...spread)).toBeLessThanOrEqual(1);
    expect(spreadLabels([])).toEqual([]);
  });
});

describe("small labels", () => {
  it("makes initials without titles, and a short day and month", () => {
    expect(initialsOf("Dr Demo A")).toBe("DA");
    expect(initialsOf("Prof Jane Q Citizen")).toBe("JC");
    expect(initialsOf("Cher")).toBe("C");
    expect(shortDayMonth("2026-09-15")).toBe("15 Sep");
  });
});
