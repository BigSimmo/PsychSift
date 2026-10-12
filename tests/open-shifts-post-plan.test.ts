import { describe, expect, it } from "vitest";

import {
  MAX_POST_DATES,
  datesProblem,
  nextExtraDate,
  parsePostAgain,
  planDates,
  postAgainHref,
  splitAttempts,
} from "@/lib/open-shifts/post-plan";
import { meetsLevel, whoCouldDoThis, whoCouldWindow } from "@/lib/open-shifts/who-could";
import { addDaysToDate, perthWallToIso } from "@/lib/roster/shifts/perth-time";
import type { RosterAssignment, RosterTeamMember } from "@/lib/roster/team/model";

// Every person and id here is made up.
const TEAM = "00000000-0000-4000-8000-00000000a001";
const SITE = "00000000-0000-4000-8000-00000000b001";
const TODAY = "2026-10-12";

const at = (date: string, time: string) => perthWallToIso(date, time)!;

describe("several dates at once", () => {
  it("keeps the first date first and checks the set", () => {
    const dates = planDates("2026-10-13", ["2026-10-15", "2026-10-14"]);
    expect(dates).toEqual(["2026-10-13", "2026-10-15", "2026-10-14"]);
    expect(datesProblem(dates, TODAY)).toBeNull();
    expect(datesProblem(["2026-10-13", "2026-10-13"], TODAY)).toBe("The same date is chosen twice.");
    expect(datesProblem(["2026-10-13", "2026-10-11"], TODAY)).toBe("One of the dates has passed.");
    expect(datesProblem(["2026-10-13", ""], TODAY)).toBe("Choose a date for each line.");
  });

  it("allows at most 14 dates", () => {
    const fourteen = Array.from({ length: MAX_POST_DATES }, (_, index) => addDaysToDate("2026-10-13", index));
    expect(datesProblem(fourteen, TODAY)).toBeNull();
    expect(datesProblem([...fourteen, "2026-11-30"], TODAY)).toBe("Choose up to 14 dates.");
  });

  it("offers the day after the latest chosen date", () => {
    expect(nextExtraDate(["2026-10-13", "2026-10-20", "2026-10-15"], TODAY)).toBe("2026-10-21");
    expect(nextExtraDate([""], TODAY)).toBe("2026-10-13");
  });

  it("names the dates posted and the dates not posted, never all as posted", () => {
    const { posted, failed } = splitAttempts([
      { date: "2026-10-13", ok: true, openShiftId: "x" },
      { date: "2026-10-14", ok: false, message: "Too many requests." },
      { date: "2026-10-15", ok: true, openShiftId: null },
    ]);
    expect(posted).toEqual(["2026-10-13", "2026-10-15"]);
    expect(failed).toEqual([{ date: "2026-10-14", message: "Too many requests." }]);
  });
});

describe("post again", () => {
  const shift = {
    startsAt: at("2026-10-13", "21:30"),
    endsAt: at("2026-10-14", "08:00"),
    kind: "night" as const,
    shiftCode: "N",
    minGrade: "registrar" as const,
    siteId: SITE,
    urgent: true,
  };

  it("round-trips everything but the date", () => {
    const href = postAgainHref("/open-shifts/post/new", shift, TEAM);
    expect(href.startsWith("/open-shifts/post/new?")).toBe(true);
    expect(href).not.toContain("2026-10-13");
    expect(parsePostAgain(href.slice(href.indexOf("?")))).toEqual({
      serviceId: TEAM,
      kind: "night",
      code: "N",
      start: "21:30",
      end: "08:00",
      level: "registrar",
      siteId: SITE,
      urgent: true,
    });
  });

  it("sends a level of other, or none, as any level", () => {
    const href = postAgainHref("/p", { ...shift, minGrade: null, siteId: null, urgent: false }, TEAM);
    const prefill = parsePostAgain(href.slice(href.indexOf("?")));
    expect(prefill.level).toBe("");
    expect(prefill.siteId).toBeUndefined();
    expect(prefill.urgent).toBeUndefined();
    expect(parsePostAgain("?level=other").level).toBeUndefined();
  });

  it("drops anything in the address that doesn't fit", () => {
    expect(
      parsePostAgain(
        "?team=not-a-uuid&kind=leave&code=%3Cscript%3E&start=25:00&end=08:00&level=boss&site=x&urgent=yes",
      ),
    ).toEqual({ urgent: false });
    // Times only travel as a pair.
    expect(parsePostAgain("?start=08:00")).toEqual({});
    expect(parsePostAgain("?code=ABCDEFGHIJKLM")).toEqual({});
    expect(parsePostAgain("")).toEqual({});
  });
});

describe("who could do this", () => {
  const member = (id: string, name: string, grade: RosterTeamMember["grade"]): RosterTeamMember => ({
    userId: `00000000-0000-4000-8000-0000000000${id}`,
    name,
    grade,
  });
  const ash = member("c1", "Dr Ash Example", "registrar");
  const bo = member("c2", "Dr Bo Example", "consultant");
  const cy = member("c3", "Dr Cy Example", "resident");
  const dee = member("c4", "Dr Dee Example", "registrar");
  const eli = member("c5", "Dr Eli Example", "fellow");
  const fin = member("c6", "Dr Fin Example", "other");

  let next = 0;
  const row = (userId: string, start: string, end: string, kind: RosterAssignment["kind"]): RosterAssignment => ({
    id: `00000000-0000-4000-8000-${String((next += 1)).padStart(12, "0")}`,
    userId,
    name: null,
    grade: null,
    siteId: null,
    siteName: null,
    startsAt: start,
    endsAt: end,
    shiftCode: "D",
    kind,
  });

  const shift = {
    startsAt: at("2026-10-14", "08:00"),
    endsAt: at("2026-10-14", "16:30"),
    minGrade: "registrar" as const,
    postedBy: null,
  };

  it("lists members at or above the level with nothing at the same time", () => {
    const result = whoCouldDoThis({
      shift,
      members: [ash, bo, cy, dee, eli, fin],
      assignments: [
        // Dee is on a night that runs into the shift's morning.
        row(dee.userId, at("2026-10-13", "21:30"), at("2026-10-14", "08:30"), "night"),
        // Ash worked the day before: no overlap.
        row(ash.userId, at("2026-10-13", "08:00"), at("2026-10-13", "16:30"), "day"),
      ],
      unavailability: [
        { userId: eli.userId, date: "2026-10-14", kind: "cant" },
        { userId: bo.userId, date: "2026-10-14", kind: "prefer_off" },
      ],
      leave: null,
      actorId: ash.userId,
    });
    expect(result.people.map((person) => [person.name, person.prefersOff, person.isYou])).toEqual([
      ["Dr Ash Example", false, true],
      ["Dr Bo Example", true, false],
    ]);
    expect(result.busy).toBe(1);
    expect(result.cantWork).toBe(1);
  });

  it("counts leave as busy and lists every member with a level when nothing else is known", () => {
    const result = whoCouldDoThis({
      shift: { ...shift, minGrade: null },
      members: [cy, dee, fin],
      assignments: [row(cy.userId, at("2026-10-14", "00:00"), at("2026-10-15", "00:00"), "leave")],
      unavailability: null,
      leave: null,
      actorId: null,
    });
    // Fin's level is "other", and Roster never lets a member without a ranked level take a shift.
    expect(result.people.map((person) => person.name)).toEqual(["Dr Dee Example"]);
    expect(result.busy).toBe(1);
  });

  it("leaves out the poster and anyone with leave over the shift, however long ago it began", () => {
    const result = whoCouldDoThis({
      shift: { ...shift, postedBy: ash.userId },
      members: [ash, bo, dee, eli],
      assignments: [],
      unavailability: null,
      leave: [
        // Began weeks before the shift, so the assignments window would never see it.
        {
          userId: dee.userId,
          name: null,
          kind: "annual",
          startsOn: "2026-09-20",
          endsOn: "2026-10-20",
          status: "approved",
        },
        {
          userId: eli.userId,
          name: null,
          kind: "annual",
          startsOn: "2026-10-15",
          endsOn: "2026-10-16",
          status: "planned",
        },
      ],
      actorId: ash.userId,
    });
    expect(result.people.map((person) => person.name)).toEqual(["Dr Eli Example", "Dr Bo Example"]);
    expect(result.onLeave).toBe(1);
  });

  it("matches levels as Roster does", () => {
    expect(meetsLevel("consultant", "registrar")).toBe(true);
    expect(meetsLevel("resident", "registrar")).toBe(false);
    expect(meetsLevel("other", "intern")).toBe(false);
    expect(meetsLevel("intern", null)).toBe(true);
    expect(meetsLevel(null, null)).toBe(false);
    expect(meetsLevel("other", null)).toBe(false);
  });

  it("reads a week before the shift's start to its end date", () => {
    expect(whoCouldWindow(at("2026-10-14", "21:30"), at("2026-10-15", "08:00"))).toEqual({
      from: "2026-10-07",
      to: "2026-10-15",
    });
  });
});
