import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DEMO_TEACHING_SERVICE_ID,
  DEMO_TEACHING_TEAM,
  demoOccurrenceId,
  demoRelocatedTeaching,
  demoTeachingFeedbackOwed,
  demoTeachingLogbook,
  demoTeachingSessionDetail,
  demoTeachingSessions,
  demoTeachingWeek,
} from "@/lib/teaching/demo-programme";
import { logbookSchema, RELOCATED_SERVICE_ID, sessionDetailSchema, teachingWeekSchema } from "@/lib/teaching/model";
import { perthDate } from "@/lib/teaching/time";

/** "08:00" in Perth, which never changes its clocks. */
function perthTime(iso: string): string {
  return new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(11, 16);
}

// Wednesday 30 September 2026, 09:00 in Perth.
const now = new Date("2026-09-30T01:00:00Z");
const term = { from: "2026-09-28", to: "2026-11-15" };
// The week that holds the next education meeting (Monday 5 October), which the demo shows as moved.
const week = { from: "2026-09-30", to: "2026-10-06" };

describe("the demo teaching programme", () => {
  it("is one demo team that accepts only made-up data", () => {
    expect(DEMO_TEACHING_TEAM).toEqual({
      id: DEMO_TEACHING_SERVICE_ID,
      name: "Demo teaching service",
      role: "doctor",
      acceptsRealData: true,
      isDemo: true,
    });
  });

  it("runs the mock-up's twelve sessions a week, Monday to Friday, every one plainly made up", () => {
    // Tuesday 6 October 2026, 12:35 in Perth: the mock-up's frozen moment.
    const at = new Date("2026-10-06T04:35:00Z");
    const range = { from: "2026-10-05", to: "2026-10-11" };
    const own = demoTeachingSessions(range, at);
    const fromOnCall = demoRelocatedTeaching(range, at);
    const all = [...own, ...fromOnCall].sort((x, y) => x.startsAt.localeCompare(y.startsAt));
    expect(
      all.map((session) => `${perthDate(session.startsAt)} ${perthTime(session.startsAt)} ${session.title}`),
    ).toEqual([
      "2026-10-05 08:00 Demo morning report",
      "2026-10-05 12:30 Demo education meeting",
      "2026-10-06 12:30 Demo case presentation",
      "2026-10-06 14:00 Demo journal club",
      "2026-10-06 16:00 Demo registrar teaching",
      "2026-10-06 17:00 Demo grand rounds",
      "2026-10-07 09:00 Demo psychotherapy seminar",
      "2026-10-07 13:00 Demo supervision group",
      "2026-10-08 08:30 Demo research meeting",
      "2026-10-08 12:00 Demo clinical skills workshop",
      "2026-10-08 15:00 Demo case discussion",
      "2026-10-09 10:00 Demo mental health update",
    ]);
    for (const session of own) {
      expect(session.title.startsWith("Demo ")).toBe(true);
      // A room is either still to confirm (or online only) or plainly made up.
      if (session.venue !== null) expect(session.venue.startsWith("Demo ")).toBe(true);
      expect(session.serviceId).toBe(DEMO_TEACHING_SERVICE_ID);
    }
    // The registrar teaching comes from On Call, so it carries no Teaching page.
    expect(fromOnCall).toEqual([
      expect.objectContaining({
        source: "on_call_relocated",
        serviceId: RELOCATED_SERVICE_ID,
        venue: "Demo seminar room",
      }),
    ]);
    // The viewer presents at this week's journal club, and only that one.
    expect(own.filter((session) => session.isPresenter).map((session) => session.title)).toEqual(["Demo journal club"]);
    expect(demoTeachingSessions({ from: "2026-10-12", to: "2026-10-18" }, at).some((s) => s.isPresenter)).toBe(false);
  });

  it("keeps the same timetable and ids from one day to the next", () => {
    const range = { from: "2026-10-05", to: "2026-10-11" };
    const ids = (at: string) => demoTeachingSessions(range, new Date(at)).map((session) => session.occurrenceId);
    expect(ids("2026-10-06T04:35:00Z")).toEqual(ids("2026-10-08T01:00:00Z"));
  });

  it("marks this week's attended sessions, leaving the education meeting missed and today's session open", () => {
    const at = new Date("2026-10-06T04:35:00Z");
    const result = demoTeachingWeek({ from: "2026-10-05", to: "2026-10-11" }, at);
    const titles = result.attendance.map(
      (mark) => result.sessions.find((session) => session.occurrenceId === mark.occurrenceId)?.title,
    );
    expect(titles).toEqual(["Demo morning report"]);
    // Two days on, more of the week has been attended, still never a session that has not ended.
    const later = new Date("2026-10-08T01:00:00Z");
    const after = demoTeachingWeek({ from: "2026-10-05", to: "2026-10-11" }, later);
    expect(after.attendance.length).toBeGreaterThan(3);
    for (const mark of after.attendance) {
      const session = after.sessions.find((candidate) => candidate.occurrenceId === mark.occurrenceId);
      expect(session && Date.parse(session.endsAt) <= later.getTime()).toBe(true);
      expect(session?.title).not.toBe("Demo education meeting");
    }
  });

  it("parses as a real week, with valid unique ids, inside the asked range", () => {
    const parsed = teachingWeekSchema.parse(demoTeachingWeek(week, now));
    const ids = parsed.sessions.map((session) => session.occurrenceId);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(z.uuid().safeParse(id).success).toBe(true);
    for (const session of parsed.sessions) {
      expect(session.startsAt >= "2026-09-29T16:00:00.000Z").toBe(true);
      expect(session.startsAt < "2026-10-06T16:00:00.000Z").toBe(true);
    }
  });

  it("shows one moved session with its notice, so the change banner has something to show", () => {
    const result = demoTeachingWeek(week, now);
    const moved = result.sessions.filter((session) => session.status === "moved");
    expect(moved).toHaveLength(1);
    expect(moved[0].title).toBe("Demo education meeting");
    expect(moved[0].startsAt).toBe("2026-10-05T04:30:00.000Z");
    expect(moved[0].venue).toBe("Demo seminar room 1");
    expect(result.notices).toEqual([
      expect.objectContaining({
        occurrenceId: moved[0].occurrenceId,
        kind: "moved",
        serviceId: DEMO_TEACHING_SERVICE_ID,
      }),
    ]);
  });

  it("opens any listed session, with example.org links and no real names", () => {
    const [first] = demoTeachingSessions(term, now);
    const detail = sessionDetailSchema.parse(demoTeachingSessionDetail(first.occurrenceId, now));
    expect(detail.occurrenceId).toBe(first.occurrenceId);
    expect([null, "Demo presenter"]).toContain(detail.presenterName);
    for (const url of [detail.joinUrl, ...detail.materials.map((material) => material.url)]) {
      if (url) expect(new URL(url).hostname).toBe("example.org");
    }
  });

  it("refuses an id that is not a real demo occurrence", () => {
    expect(demoTeachingSessionDetail("11111111-1111-4111-8111-111111111111", now)).toBeNull();
    expect(demoTeachingSessionDetail(demoOccurrenceId(23, "2026-09-29"), now)).toBeNull();
    expect(demoTeachingSessionDetail(demoOccurrenceId(99, "2026-09-30"), now)).toBeNull();
  });

  it("keeps twelve weeks of check-ins, most recent first, with one empty week and three not in CPD", () => {
    const at = new Date("2026-10-06T04:35:00Z");
    const rows = logbookSchema.parse({ attendance: demoTeachingLogbook(at) }).attendance;
    expect(rows).toHaveLength(32);
    for (let index = 1; index < rows.length; index++)
      expect(rows[index - 1].startsAt > rows[index].startsAt).toBe(true);
    for (const row of rows) expect(Date.parse(row.endsAt) <= at.getTime()).toBe(true);
    // None in the week of 7 September; this week so far, Monday's morning report.
    expect(
      rows.some((row) => row.startsAt >= "2026-09-06T16:00:00.000Z" && row.startsAt < "2026-09-13T16:00:00.000Z"),
    ).toBe(false);
    expect(rows[0].title).toBe("Demo morning report");
    expect(rows[0].cpdEntryId).not.toBeNull();
    expect(rows.filter((row) => row.cpdEntryId === null).map((row) => row.title)).toEqual([
      "Demo mental health update",
      "Demo case discussion",
      "Demo psychotherapy seminar",
    ]);
    // Any other day it is still a full record.
    expect(demoTeachingLogbook(new Date("2026-10-08T01:00:00Z")).length).toBeGreaterThan(30);
  });

  it("owes feedback on the latest case presentation and case discussion, oldest first", () => {
    const owed = demoTeachingFeedbackOwed(new Date("2026-10-06T04:35:00Z"));
    expect(owed.map((session) => [session.title, perthDate(session.startsAt)])).toEqual([
      ["Demo case presentation", "2026-09-29"],
      ["Demo case discussion", "2026-10-01"],
    ]);
  });
});
