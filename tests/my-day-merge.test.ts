import { describe, expect, it } from "vitest";
import {
  compareMyDayItems,
  formatMyDayDue,
  mergeMyDayItems,
  myDaySeverityForDue,
  summariseMyDay,
} from "@/lib/my-day/merge";
import type { MyDayItem } from "@/lib/my-day/model";

// 2026-10-03 12:00 in Perth.
const NOW = new Date("2026-10-03T04:00:00Z");

function item(overrides: Partial<MyDayItem> & { id: string }): MyDayItem {
  return {
    mode: "my-work",
    title: "Item",
    due: null,
    severity: "info",
    href: "/x",
    ...overrides,
  };
}

describe("myDaySeverityForDue", () => {
  it("classifies date-only boundaries", () => {
    expect(myDaySeverityForDue("2026-10-02", NOW)).toBe("overdue");
    expect(myDaySeverityForDue("2026-10-03", NOW)).toBe("soon");
    expect(myDaySeverityForDue("2026-10-09", NOW)).toBe("soon");
    expect(myDaySeverityForDue("2026-10-10", NOW)).toBe("info");
  });

  it("honours a custom soon window", () => {
    expect(myDaySeverityForDue("2026-10-04", NOW, 2)).toBe("soon");
    expect(myDaySeverityForDue("2026-10-05", NOW, 2)).toBe("info");
  });

  it("classifies instants by the clock, then by Perth date", () => {
    expect(myDaySeverityForDue("2026-10-03T01:00:00Z", NOW)).toBe("overdue");
    expect(myDaySeverityForDue("2026-10-03T08:00:00Z", NOW)).toBe("soon");
    expect(myDaySeverityForDue("2026-10-02T04:00:00Z", NOW)).toBe("overdue");
    // 15:59Z on 9 Oct is 23:59 Perth on 9 Oct: still inside the window.
    expect(myDaySeverityForDue("2026-10-09T15:59:00Z", NOW)).toBe("soon");
    // 16:00Z on 9 Oct is already 10 Oct in Perth.
    expect(myDaySeverityForDue("2026-10-09T16:00:00Z", NOW)).toBe("info");
  });

  it("uses the Perth day, not the UTC day", () => {
    const lateUtc = new Date("2026-10-03T16:30:00Z"); // 4 Oct 00:30 Perth
    expect(myDaySeverityForDue("2026-10-03", lateUtc)).toBe("overdue");
    expect(myDaySeverityForDue("2026-10-04", lateUtc)).toBe("soon");
  });

  it("treats null and garbage as info", () => {
    expect(myDaySeverityForDue(null, NOW)).toBe("info");
    expect(myDaySeverityForDue("not a date", NOW)).toBe("info");
    expect(myDaySeverityForDue("2026-13-45", NOW)).toBe("info");
  });
});

describe("compareMyDayItems and mergeMyDayItems", () => {
  it("orders by severity first", () => {
    const merged = mergeMyDayItems([
      [
        item({ id: "a", severity: "info", due: "2026-10-01" }),
        item({ id: "b", severity: "overdue", due: "2026-10-20" }),
        item({ id: "c", severity: "soon", due: "2026-10-04" }),
      ],
    ]);
    expect(merged.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("orders by due, with date-only before a later instant the same Perth day and null last", () => {
    const merged = mergeMyDayItems([
      [
        item({ id: "none", severity: "soon", due: null }),
        item({ id: "instant", severity: "soon", due: "2026-10-05T02:00:00Z" }), // 10:00 Perth
        item({ id: "dateOnly", severity: "soon", due: "2026-10-05" }),
        item({ id: "earlyInstant", severity: "soon", due: "2026-10-04T20:00:00Z" }), // 5 Oct 04:00 Perth
        item({ id: "earlier", severity: "soon", due: "2026-10-04" }),
      ],
    ]);
    expect(merged.map((i) => i.id)).toEqual(["earlier", "dateOnly", "earlyInstant", "instant", "none"]);
  });

  it("breaks ties by mode order, then title, then id", () => {
    const merged = mergeMyDayItems([
      [
        item({ id: "t2", mode: "teaching", title: "A" }),
        item({ id: "oc", mode: "on-call", title: "Z" }),
        item({ id: "b2", mode: "my-work", title: "Beta" }),
        item({ id: "a1", mode: "my-work", title: "Alpha" }),
        item({ id: "b1", mode: "my-work", title: "Beta" }),
      ],
    ]);
    expect(merged.map((i) => i.id)).toEqual(["oc", "t2", "a1", "b1", "b2"]);
  });

  it("compares equal items as zero", () => {
    const a = item({ id: "same" });
    expect(compareMyDayItems(a, { ...a })).toBe(0);
  });

  it("drops duplicate ids, first occurrence wins", () => {
    const first = item({ id: "dup", title: "First" });
    const second = item({ id: "dup", title: "Second" });
    const merged = mergeMyDayItems([[first], [second, item({ id: "other" })]]);
    expect(merged).toHaveLength(2);
    expect(merged.find((i) => i.id === "dup")?.title).toBe("First");
  });

  it("does not mutate its inputs", () => {
    const group = [item({ id: "b", severity: "info" }), item({ id: "a", severity: "overdue" })];
    const result = mergeMyDayItems([group]);
    expect(group.map((i) => i.id)).toEqual(["b", "a"]);
    expect(result).not.toBe(group);
    expect(result.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("formatMyDayDue", () => {
  it("writes date-only values as day words or a fixed-month date", () => {
    expect(formatMyDayDue(null, NOW)).toBe("");
    expect(formatMyDayDue("garbage", NOW)).toBe("");
    expect(formatMyDayDue("2026-10-03", NOW)).toBe("Today");
    expect(formatMyDayDue("2026-10-04", NOW)).toBe("Tomorrow");
    expect(formatMyDayDue("2026-10-02", NOW)).toBe("Yesterday");
    expect(formatMyDayDue("2026-10-09", NOW)).toBe("9 Oct 2026");
    expect(formatMyDayDue("2026-09-01", NOW)).toBe("1 Sep 2026");
  });

  it("adds a 24-hour Perth time to instants", () => {
    expect(formatMyDayDue("2026-10-03T06:30:00Z", NOW)).toBe("Today · 14:30");
    expect(formatMyDayDue("2026-10-12T00:00:00Z", NOW)).toBe("12 Oct 2026 · 08:00");
  });

  it("rolls over at Perth midnight", () => {
    // 16:30Z is 00:30 on 4 Oct in Perth.
    const lateUtc = new Date("2026-10-03T16:30:00Z");
    expect(formatMyDayDue("2026-10-04", lateUtc)).toBe("Today");
    expect(formatMyDayDue("2026-10-03", lateUtc)).toBe("Yesterday");
    expect(formatMyDayDue("2026-10-03T16:30:00Z", lateUtc)).toBe("Today · 00:30");
    expect(formatMyDayDue("2026-10-04T16:00:00Z", lateUtc)).toBe("Tomorrow · 00:00");
  });
});

describe("summariseMyDay", () => {
  it("counts by severity", () => {
    expect(summariseMyDay([])).toEqual({ total: 0, overdue: 0, soon: 0, info: 0 });
    expect(
      summariseMyDay([
        item({ id: "1", severity: "overdue" }),
        item({ id: "2", severity: "overdue" }),
        item({ id: "3", severity: "soon" }),
        item({ id: "4", severity: "info" }),
      ]),
    ).toEqual({ total: 4, overdue: 2, soon: 1, info: 1 });
  });
});
