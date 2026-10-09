import { describe, expect, it } from "vitest";

import { workCalendarMyDayItems } from "@/components/my-day/sources/work-calendar";
import { comingEntryEdges, entryStartsByDate, monthRotations } from "@/components/roster/roster-month-rotations";
import { withoutExampleRecords } from "@/lib/example-data/guards";
import { exampleRotationRounds, EXAMPLE_ROTATION_SELF_ID } from "@/lib/example-data/datasets/roster-rotations";
import { rotationTodayPrompt } from "@/lib/my-day/rotation-prompt";
import type { MyRound, RotationRound } from "@/lib/roster/rotations/model";
import { myRoundView } from "@/lib/roster/rotations/operations";
import {
  entriesOnDate,
  entriesOverlapping,
  entryEdges,
  mergeEntries,
  rotationCalendarEntries,
  rotationEntryId,
  workCalendarFeedEvents,
  type WorkCalendarEntry,
} from "@/lib/work-calendar/entries";

/*
 * The shared work calendar layer (rotation preferences, owner request
 * 9 Oct 2026): entries, rotation placements as entries, the Roster month and
 * My Day mappings, the calendar feed events and My Day's rotation card. Every
 * round and name here is invented.
 */

const PERTH = "Australia/Perth";

function entry(
  overrides: Partial<WorkCalendarEntry> & Pick<WorkCalendarEntry, "id" | "start" | "end">,
): WorkCalendarEntry {
  return { kind: "rotation", title: "Consultation liaison", allDay: true, ...overrides };
}

const ROUND: RotationRound = {
  id: "round-2027",
  serviceId: "service-1",
  teamName: "Registrars",
  status: "published",
  adminName: "Dr Admin",
  createdAt: "2026-10-01T00:00:00.000Z",
  openedAt: "2026-10-01T00:00:00.000Z",
  publishedAt: "2026-11-06T01:00:00.000Z",
  version: 3,
  name: "2027 rotations",
  closesAt: "2026-10-30T09:00:00.000Z",
  minRanked: 2,
  terms: [
    { id: "t1", label: "Term 1", start: "2027-02-01", end: "2027-05-02" },
    { id: "t2", label: "Term 2", start: "2027-05-03", end: "2027-08-01" },
  ],
  rotations: [
    { id: "cl", name: "Consultation liaison", site: "Example Hospital", places: 2 },
    { id: "ed", name: "Emergency psychiatry", site: "", places: 1 },
  ],
  people: [
    { id: "me", name: "Me" },
    { id: "other", name: "Other" },
  ],
};

const MINE: MyRound = {
  round: ROUND,
  personId: "me",
  ranking: ["cl", "ed"],
  submittedAt: "2026-10-10T00:00:00.000Z",
  placements: [
    { personId: "me", termId: "t1", rotationId: "cl", rank: 1, locked: false, reason: "Your 1st choice" },
    { personId: "me", termId: "t2", rotationId: "ed", rank: null, locked: false, reason: "A free place" },
    { personId: "other", termId: "t1", rotationId: "ed", rank: 1, locked: false, reason: "Your 1st choice" },
  ],
};

describe("rotationCalendarEntries", () => {
  it("turns each of the reader's published placements into a whole-day entry", () => {
    const entries = rotationCalendarEntries([MINE]);
    expect(entries).toEqual([
      {
        id: "rotation:round-2027:t1",
        kind: "rotation",
        title: "Consultation liaison",
        detail: "Term 1 · Example Hospital · your 1st choice",
        start: "2027-02-01",
        end: "2027-05-02",
        allDay: true,
        location: "Example Hospital",
        status: "confirmed",
        href: "/roster/rotations/round-2027",
        updatedAt: "2026-11-06T01:00:00.000Z",
      },
      {
        id: "rotation:round-2027:t2",
        kind: "rotation",
        title: "Emergency psychiatry",
        detail: "Term 2",
        start: "2027-05-03",
        end: "2027-08-01",
        allDay: true,
        status: "confirmed",
        href: "/roster/rotations/round-2027",
        updatedAt: "2026-11-06T01:00:00.000Z",
      },
    ]);
  });

  it("gives nothing for a round that is not published", () => {
    expect(rotationCalendarEntries([{ ...MINE, round: { ...ROUND, status: "closed" } }])).toEqual([]);
  });

  it("keeps example ids example ids, so exports and notifications drop them", () => {
    const now = new Date("2026-10-09T02:00:00.000Z");
    const example = exampleRotationRounds(now);
    const mine = example.rounds.map((round) => myRoundView(round, EXAMPLE_ROTATION_SELF_ID));
    const entries = rotationCalendarEntries(mine);
    expect(entries.length).toBeGreaterThan(0);
    for (const item of entries) {
      expect(item.id.startsWith("example:rotation:")).toBe(true);
      expect(item.isExample).toBe(true);
      expect(item.href).toMatch(/^\/roster\/rotations\/example%3Around%3A/);
    }
    expect(withoutExampleRecords(entries)).toEqual([]);
    expect(rotationEntryId("example:round:2026", "example:term:2026:1", true)).toBe(
      "example:rotation:round:2026:term:2026:1",
    );
  });
});

describe("entry helpers", () => {
  const a = entry({ id: "a", start: "2027-02-01", end: "2027-05-02" });
  const b = entry({ id: "b", title: "Emergency psychiatry", start: "2027-05-03", end: "2027-08-01" });
  const waitlisted = entry({
    id: "c",
    kind: "course",
    title: "ALS",
    start: "2027-03-01",
    end: "2027-03-01",
    status: "waitlisted",
  });
  const cancelled = entry({
    id: "d",
    kind: "course",
    title: "BLS",
    start: "2027-03-02",
    end: "2027-03-02",
    status: "cancelled",
  });

  it("finds what covers a date, inclusive of the last day, and hides waitlisted and cancelled", () => {
    expect(entriesOnDate([a, b], "2027-05-02").map((e) => e.id)).toEqual(["a"]);
    expect(entriesOnDate([a, b], "2027-05-03").map((e) => e.id)).toEqual(["b"]);
    expect(entriesOnDate([waitlisted, cancelled], "2027-03-01")).toEqual([]);
  });

  it("finds what overlaps a range", () => {
    expect(entriesOverlapping([b, a, waitlisted], "2027-04-01", "2027-05-31").map((e) => e.id)).toEqual(["a", "b"]);
    expect(entriesOverlapping([a], "2027-05-03", "2027-06-01")).toEqual([]);
  });

  it("lists starts and ends in date order, then by title, a one-day entry only once", () => {
    const course = entry({ id: "e", kind: "course", title: "ECT course", start: "2027-05-03", end: "2027-05-03" });
    const edges = entryEdges([course, b, a], "2027-02-01", "2027-05-03");
    expect(edges.map((edge) => `${edge.date} ${edge.edge} ${edge.entry.id}`)).toEqual([
      "2027-02-01 start a",
      "2027-05-02 end a",
      "2027-05-03 start e",
      "2027-05-03 start b",
    ]);
  });

  it("merges sources once per id, sorted", () => {
    expect(mergeEntries([[b, a], [a]]).map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("workCalendarFeedEvents", () => {
  it("puts a rotation's first and last day in the feed, never example or unconfirmed entries", () => {
    const events = workCalendarFeedEvents([
      ...rotationCalendarEntries([MINE]).slice(0, 1),
      entry({ id: "example:rotation:x:y", start: "2027-02-01", end: "2027-03-01", isExample: true }),
      entry({
        id: "booking:1",
        kind: "course",
        title: "ALS",
        start: "2027-03-01",
        end: "2027-03-01",
        status: "waitlisted",
      }),
    ]);
    expect(events).toEqual([
      expect.objectContaining({
        title: "Consultation liaison starts",
        date: "2027-02-01",
        location: "Example Hospital",
      }),
      expect.objectContaining({ title: "Consultation liaison ends", date: "2027-05-02" }),
    ]);
    expect(events.every((event) => event.startTime === undefined && event.alarmAt === undefined)).toBe(true);
    expect(new Set(events.map((event) => event.id)).size).toBe(2);
  });

  it("makes a timed one-day course a timed event", () => {
    const [event] = workCalendarFeedEvents([
      entry({
        id: "booking:7",
        kind: "course",
        title: "ALS",
        start: "2027-03-01",
        end: "2027-03-01",
        allDay: false,
        startTime: "09:00",
        endTime: "12:30",
      }),
    ]);
    expect(event).toMatchObject({ title: "ALS", date: "2027-03-01", startTime: "09:00", durationMinutes: 210 });
  });
});

describe("Roster month", () => {
  const entries = rotationCalendarEntries([MINE]);

  it("names the rotation today is in, else the ones the month overlaps", () => {
    expect(monthRotations(entries, "2027-03", "2027-03-10").map((e) => e.title)).toEqual(["Consultation liaison"]);
    expect(monthRotations(entries, "2027-05", "2027-03-10").map((e) => e.title)).toEqual([
      "Consultation liaison",
      "Emergency psychiatry",
    ]);
    expect(monthRotations(entries, "2027-05", "2027-05-10").map((e) => e.title)).toEqual(["Emergency psychiatry"]);
    expect(monthRotations(entries, "2026-12", "2026-12-01")).toEqual([]);
  });

  it("marks the days a rotation starts and lists what is coming up", () => {
    expect([...entryStartsByDate(entries, "2027-04-26", "2027-06-06")]).toEqual([
      ["2027-05-03", ["Emergency psychiatry starts"]],
    ]);
    expect(comingEntryEdges(entries, "2027-04-20").map((edge) => `${edge.edge} ${edge.entry.title}`)).toEqual([
      "end Consultation liaison",
      "start Emergency psychiatry",
    ]);
  });
});

describe("My Day", () => {
  it("lists rotation starts and ends in the next two weeks as info items", () => {
    const items = workCalendarMyDayItems(rotationCalendarEntries([MINE]), "2027-04-25");
    expect(items).toEqual([
      expect.objectContaining({
        id: "roster:calendar-end:rotation:round-2027:t1",
        mode: "roster",
        title: "Consultation liaison ends",
        due: "2027-05-02",
        severity: "info",
        href: "/roster/rotations/round-2027",
      }),
      expect.objectContaining({ title: "Emergency psychiatry starts", due: "2027-05-03", detail: "Term 2" }),
    ]);
  });

  it("never lists example entries", () => {
    const now = new Date("2026-10-09T02:00:00.000Z");
    const example = exampleRotationRounds(now);
    const entries = rotationCalendarEntries(
      example.rounds.map((round) => myRoundView(round, EXAMPLE_ROTATION_SELF_ID)),
    );
    expect(workCalendarMyDayItems(entries, "2026-10-25")).toEqual([]);
  });

  it("asks the reader to rank while a round is open and they have not sent", () => {
    const now = new Date("2026-10-28T02:00:00.000Z");
    const open: MyRound = {
      ...MINE,
      round: { ...ROUND, status: "open", publishedAt: null },
      submittedAt: null,
      placements: [],
    };
    expect(rotationTodayPrompt([open], now, PERTH)).toEqual({
      kind: "rank",
      roundId: "round-2027",
      title: "Rank your 2027 rotations",
      sub: "Closes Fri 30 Oct at 17:00 · Draft saved",
      example: false,
    });
    expect(rotationTodayPrompt([{ ...open, submittedAt: "2026-10-27T00:00:00.000Z" }], now, PERTH)).toBeNull();
    // Closed by time, even before the administrator closes it.
    expect(rotationTodayPrompt([open], new Date("2026-10-30T09:00:00.000Z"), PERTH)).toBeNull();
  });

  it("says the rotations are out for two weeks after publishing", () => {
    expect(rotationTodayPrompt([MINE], new Date("2026-11-10T00:00:00.000Z"), PERTH)).toEqual({
      kind: "published",
      roundId: "round-2027",
      title: "Your rotations are out",
      sub: "2027 · 1 of 2 from your top three",
      example: false,
    });
    expect(rotationTodayPrompt([MINE], new Date("2026-11-21T02:00:00.000Z"), PERTH)).toBeNull();
  });

  it("shows the example round, marked as an example", () => {
    const now = new Date("2026-10-09T02:00:00.000Z");
    const example = exampleRotationRounds(now);
    const prompt = rotationTodayPrompt(
      example.rounds.map((round) => myRoundView(round, EXAMPLE_ROTATION_SELF_ID)),
      now,
      PERTH,
    );
    expect(prompt).toMatchObject({ kind: "rank", title: "Rank your 2027 rotations", example: true });
  });
});
