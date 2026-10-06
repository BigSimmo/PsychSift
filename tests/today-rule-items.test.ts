import { describe, expect, it } from "vitest";

import { fatigueTodayItems, mhaTimerTodayItems } from "@/lib/admin/today-rule-items";
import { cpdCoachingTodayItems } from "@/lib/cme/coaching-today-items";
import type { CpdCoachingResult } from "@/lib/cme/category-coaching";
import type { MhaTimeframeEntry } from "@/lib/mha-timeline";
import type { MhaTimersResult } from "@/lib/on-call/mha-timers";
import type { FatigueResult } from "@/lib/roster/fatigue-rules";

const entry = {
  id: "invented",
  formCodes: ["ZZ"],
  trigger: "Invented trigger",
  section: "999",
  quote: "invented 6 hours",
  duration: { value: 6, unit: "hours" },
} as unknown as MhaTimeframeEntry;

describe("today rule items", () => {
  it("produce nothing while an engine is off", () => {
    const off = { on: false, reason: "unsigned" } as const;
    expect(mhaTimerTodayItems({ gate: off, items: [] })).toEqual([]);
    expect(fatigueTodayItems({ gate: off, warnings: [] }, new Map())).toEqual([]);
    expect(cpdCoachingTodayItems({ gate: off, coaching: null }, 2026)).toEqual([]);
  });

  it("maps countdowns to soon or overdue and skips quote-only entries", () => {
    const deadline = new Date("2026-10-04T06:00:00.000Z");
    const result: MhaTimersResult = {
      gate: { on: true },
      items: [
        {
          kind: "countdown",
          timerId: "t1",
          entry,
          deadline,
          remainingMs: 1,
          expired: false,
          occurrence: 1,
          repeatsEveryHours: null,
        },
        {
          kind: "countdown",
          timerId: "t2",
          entry,
          deadline,
          remainingMs: -1,
          expired: true,
          occurrence: 1,
          repeatsEveryHours: null,
        },
        {
          kind: "countdown",
          timerId: "t4",
          entry,
          deadline,
          remainingMs: 1,
          expired: false,
          occurrence: 3,
          repeatsEveryHours: 24,
        },
        { kind: "quote-only", timerId: "t3", entry, reason: "not-calculable" },
      ],
    };
    const items = mhaTimerTodayItems(result);
    expect(items.map((item) => [item.id, item.severity, item.due])).toEqual([
      ["on-call:mha-timer:t1:invented", "soon", "2026-10-04T06:00:00.000Z"],
      ["on-call:mha-timer:t2:invented", "overdue", "2026-10-04T06:00:00.000Z"],
      ["on-call:mha-timer:t4:invented:3", "soon", "2026-10-04T06:00:00.000Z"],
    ]);
    expect(items[2]?.detail).toContain("Repeats every 24 hours while the order is in force.");
    expect(items[0]).toMatchObject({ mode: "on-call", href: "/on-call", title: "Form ZZ: Invented trigger" });
  });

  it("dates fatigue warnings to their shift, as info", () => {
    const result: FatigueResult = {
      gate: { on: true },
      warnings: [
        {
          shiftId: "s1",
          rule: "minBreakHours",
          words: "9 hours' break before this shift.",
          citation: { clause: "15(4)(a)", quote: "invented quote" },
        },
      ],
    };
    expect(fatigueTodayItems(result, new Map([["s1", "2026-10-06T07:00:00.000Z"]]))).toEqual([
      {
        id: "roster:fatigue:s1:minBreakHours",
        mode: "roster",
        title: "9 hours' break before this shift.",
        detail: 'Clause 15(4)(a): "invented quote"',
        due: "2026-10-06T07:00:00.000Z",
        severity: "info",
        href: "/roster",
      },
    ]);
  });

  it("lists target mismatches, then unmet CPD lines only", () => {
    const result: CpdCoachingResult = {
      gate: { on: true },
      coaching: {
        mismatches: [{ id: "total", yours: 40, standard: 50, words: "Your total target is 40 hours.", quote: "q" }],
        lines: [
          {
            id: "total",
            label: "All CPD hours",
            met: false,
            hoursLogged: 42,
            hoursRequired: 50,
            hoursShort: 8,
            quote: "q",
          },
          {
            id: "educational",
            label: "Educational activities",
            met: true,
            hoursLogged: 13,
            hoursRequired: 12.5,
            hoursShort: 0,
            quote: "q",
          },
        ],
      },
    };
    expect(cpdCoachingTodayItems(result, 2026).map((item) => item.id)).toEqual([
      "cme:target-below-minimum:2026:total",
      "cme:board-minimum:2026:total",
    ]);
  });
});
