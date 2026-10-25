import { describe, expect, it } from "vitest";

import {
  groupByGrade,
  handover,
  mergeMyShifts,
  personalRosterChanges,
  timelineSpan,
  withMe,
} from "@/lib/roster/team/team-view";
import type { RosterAssignment } from "@/lib/roster/team/model";

const shift = (
  id: string,
  userId: string,
  start: string,
  end: string,
  grade: RosterAssignment["grade"] = "registrar",
): RosterAssignment => ({
  id,
  userId,
  name: `Dr ${userId} Example`,
  grade,
  siteId: "site",
  siteName: "Example Hospital",
  startsAt: `${start}+08:00`,
  endsAt: `${end}+08:00`,
  shiftCode: "N",
  kind: "night",
});
const mine = shift("mine", "alex", "2026-10-15T21:30:00", "2026-10-16T08:00:00");

describe("team display uses actual overlap and Perth dates", () => {
  it("compares duties across replacement IDs and includes additions, removals and time changes", () => {
    expect(personalRosterChanges([mine], [{ ...mine, id: "new" }])).toEqual([]);
    expect(personalRosterChanges([mine], [{ ...mine, id: "new", endsAt: "2026-10-16T09:00:00+08:00" }])).toHaveLength(
      1,
    );
    const later = shift("later", "alex", "2026-10-18T08:00:00", "2026-10-18T16:30:00");
    expect(personalRosterChanges([mine], [later])).toEqual([
      { date: "2026-10-15", before: [mine], after: [] },
      { date: "2026-10-18", before: [], after: [later] },
    ]);
  });
  it("clips an overnight shift on each day and excludes its end boundary", () => {
    expect(timelineSpan(mine, "2026-10-15")).toMatchObject({ label: "from 21:30", startMinute: 1290, endMinute: 1440 });
    expect(timelineSpan(mine, "2026-10-16")).toMatchObject({ label: "to 08:00", startMinute: 0, endMinute: 480 });
    expect(timelineSpan(mine, "2026-10-17")).toBeNull();
  });
  it("runs the day rail from midnight to midnight in the same zone as its labels", () => {
    // 08:00-17:00 Sydney on Thu 15 Oct 2026 (AEDT, UTC+11) is 21:00Z-06:00Z.
    const sydney = { ...mine, startsAt: "2026-10-14T21:00:00.000Z", endsAt: "2026-10-15T06:00:00.000Z" };
    expect(timelineSpan(sydney, "2026-10-15", "Australia/Sydney")).toEqual({
      label: "08:00–17:00",
      startMinute: 480,
      endMinute: 1020,
    });
    expect(timelineSpan(sydney, "2026-10-14", "Australia/Sydney")).toBeNull();
    // Daylight saving starts on Sun 4 Oct 2026, so that Sydney day is 23 hours long.
    const allDay = { ...mine, startsAt: "2026-10-03T14:00:00.000Z", endsAt: "2026-10-04T13:00:00.000Z" };
    expect(timelineSpan(allDay, "2026-10-04", "Australia/Sydney")).toMatchObject({ startMinute: 0, endMinute: 1380 });
  });
  it("orders grades and preserves the ungraded group", () => {
    const rows = [mine, { ...mine, id: "u", grade: null }, { ...mine, id: "c", grade: "consultant" as const }];
    expect(groupByGrade(rows).map((group) => group.label)).toEqual(["Consultants", "Registrars", "Grade not set"]);
  });
  it("shows colleagues overlapping my next shifts, not adjacent shifts", () => {
    const same = { ...mine, id: "sam", userId: "sam" };
    const adjacent = shift("tom", "tom", "2026-10-16T08:00:00", "2026-10-16T16:30:00");
    expect(withMe([mine, same, adjacent], "alex", new Date("2026-10-15T00:00:00Z")).map((row) => row.id)).toEqual([
      "mine",
      "sam",
    ]);
  });
  it("does not invent a handover when two colleagues could take over", () => {
    const next = shift("sam", "sam", "2026-10-16T08:00:00", "2026-10-16T16:30:00");
    expect(handover([mine, next], mine).to).toBe("Dr sam Example");
    expect(handover([mine, next, { ...next, id: "another", userId: "mei" }], mine).to).toBeNull();
  });
  it("deduplicates own shifts against only the authenticated doctor's team assignments", () => {
    const own = {
      ...mine,
      title: "Night",
      source: "manual" as const,
      sourceUid: null,
      location: null,
      seriesId: null,
      workplace: null,
    };
    const team = { serviceId: "team", name: "Example team", enabled: true, role: "member" as const, grade: null };
    const result = mergeMyShifts([own], [{ team, assignments: [mine, { ...mine, id: "sam", userId: "sam" }] }], "alex");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ source: "team", assignmentId: "mine", serviceId: "team" });
    expect(mergeMyShifts([own], [{ team: { ...team, enabled: false }, assignments: [mine] }], "alex")[0].source).toBe(
      "manual",
    );
  });
});
