/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RosterWeekStrip } from "@/components/roster/roster-week-strip";
import { WeekBoard } from "@/components/roster/team/calendar/week-board";
import type { SessionSummaryRead } from "@/components/teaching/teaching-reads";
import { nextSession } from "@/components/teaching/teaching-view-model";
import { isWaPublicHolidayDate } from "@/lib/on-call/wa-public-holidays";
import { monthCells } from "@/lib/roster/team/calendar-model";
import { fairnessCounts } from "@/lib/roster/team/fairness";
import type { RosterAssignment } from "@/lib/roster/team/model";

afterEach(() => {
  cleanup();
});

function buildSession(overrides: Partial<SessionSummaryRead> = {}): SessionSummaryRead {
  return {
    occurrenceId: "occ-1",
    serviceId: "svc-1",
    title: "Orientation day",
    startsAt: "2026-10-16T00:00:00+08:00",
    endsAt: "2026-10-16T17:00:00+08:00",
    venue: "Lecture Theatre",
    hasJoinLink: false,
    status: "scheduled",
    previousStartsAt: null,
    isPresenter: false,
    source: "teaching",
    ...overrides,
  };
}

describe("RosterWeekStrip multi-kind handling", () => {
  it("renders a single shift kind cleanly", () => {
    render(<RosterWeekStrip today="2026-10-12" testId="week-strip" week={[{ date: "2026-10-12", kinds: ["day"] }]} />);
    const item = screen.getByLabelText("Mon 12 Oct: Day");
    expect(item).toBeInTheDocument();
    expect(item.querySelector("[data-kind='day']")).not.toBeNull();
    expect(item.querySelector("[data-multi-kind='true']")).toBeNull();
  });

  it("deduplicates two shifts of the same kind on the same day without a false multi-kind marker", () => {
    render(
      <RosterWeekStrip today="2026-10-12" testId="week-strip" week={[{ date: "2026-10-12", kinds: ["day", "day"] }]} />,
    );
    const item = screen.getByLabelText("Mon 12 Oct: Day");
    expect(item).toBeInTheDocument();
    expect(item.querySelector("[data-multi-kind='true']")).toBeNull();
  });

  it("renders a multi-kind indicator and lists both shift words when two distinct shift kinds occur on one day", () => {
    render(
      <RosterWeekStrip
        today="2026-10-12"
        testId="week-strip"
        week={[{ date: "2026-10-12", kinds: ["day", "night"] }]}
      />,
    );
    const item = screen.getByLabelText("Mon 12 Oct: Day and Night");
    expect(item).toBeInTheDocument();
    const multi = item.querySelector("[data-multi-kind='true']");
    expect(multi).not.toBeNull();
    expect(multi).toHaveTextContent("+1");
  });
});

describe("nextSession all-day Perth calendar date guard", () => {
  it("includes an all-day scheduled session whose Perth date is today or in the future", () => {
    const now = new Date("2026-10-16T06:00:00.000Z"); // 14:00 in Perth on 2026-10-16
    const todayAllDay = buildSession({
      occurrenceId: "all-day-today",
      allDay: true,
      startsAt: "2026-10-16T00:00:00+08:00",
      endsAt: "2026-10-16T00:00:00+08:00",
    });
    expect(nextSession([todayAllDay], now)?.occurrenceId).toBe("all-day-today");
  });

  it("excludes an all-day session whose Perth date is in the past", () => {
    const now = new Date("2026-10-16T06:00:00.000Z"); // 2026-10-16 in Perth
    const pastAllDay = buildSession({
      occurrenceId: "all-day-past",
      allDay: true,
      startsAt: "2026-10-15T00:00:00+08:00",
      endsAt: "2026-10-15T23:59:59+08:00",
    });
    expect(nextSession([pastAllDay], now)).toBeNull();
  });
});

describe("isWaPublicHolidayDate and post-2028 roster holiday recognition", () => {
  it("recognizes published (<=2028) and rule-derived (>2028) WA public holidays", () => {
    expect(isWaPublicHolidayDate("2022-12-25")).toBe(true);
    expect(isWaPublicHolidayDate("2022-12-26")).toBe(true);
    expect(isWaPublicHolidayDate("2022-12-27")).toBe(true);
    expect(isWaPublicHolidayDate("2022-12-28")).toBe(false);
    expect(isWaPublicHolidayDate("2024-09-23")).toBe(true);
    expect(isWaPublicHolidayDate("2024-09-30")).toBe(false);
    expect(isWaPublicHolidayDate("2028-01-01")).toBe(true);
    expect(isWaPublicHolidayDate("2029-01-01")).toBe(true);
    expect(isWaPublicHolidayDate("2029-01-02")).toBe(false);
    expect(isWaPublicHolidayDate("invalid")).toBe(false);
  });

  it("counts a 2029-01-01 shift as a public holiday shift in fairnessCounts and calendar views", () => {
    const newYear2029Shift: RosterAssignment = {
      id: "shift-2029-nyd",
      userId: "alex",
      name: "Dr Alex Example",
      grade: "registrar",
      siteId: null,
      siteName: null,
      startsAt: "2029-01-01T08:00:00+08:00",
      endsAt: "2029-01-01T16:30:00+08:00",
      shiftCode: "D",
      kind: "day",
    };
    const counts = fairnessCounts([newYear2029Shift], {
      from: "2029-01-01",
      to: "2029-01-07",
    });
    expect(counts).toEqual([
      {
        userId: "alex",
        name: "Dr Alex Example",
        nights: 0,
        weekendShifts: 0,
        publicHolidayShifts: 1,
        hours: 8.5,
      },
    ]);

    const jan2029Cells = monthCells("2029-01", [newYear2029Shift], "alex").flat();
    const jan1Cell = jan2029Cells.find((cell) => cell.date === "2029-01-01");
    expect(jan1Cell?.holiday).toBe(true);

    render(<WeekBoard rows={[]} days={["2029-01-01"]} onPickShift={() => {}} />);
    expect(screen.getByText("Public holiday")).toBeInTheDocument();
  });
});
