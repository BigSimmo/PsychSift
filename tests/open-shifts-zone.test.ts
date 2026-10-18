// Audit-only date-boundary probe; all times synthetic, no network.
import { beforeEach, expect, it, vi } from "vitest";
const work = vi.hoisted(() => ({ zone: "Australia/Sydney" }));
vi.mock("@/lib/work-time/current-zone", () => ({ currentWorkTimeZone: () => work.zone }));
import { hoursMeter } from "@/lib/open-shifts/mine";
import { groupPosted } from "@/lib/open-shifts/posted";
import { changeBody, changeRisks, draftFor } from "@/components/teaching/organise-model";
import { perthWallToIso } from "@/lib/roster/shifts/perth-time";
import type { SessionSummary } from "@/lib/teaching/model";
beforeEach(() => {
  work.zone = "Australia/Sydney";
});

it("counts the full shift from local midnight in the selected Sydney work zone", () => {
  // 17 October 00:00-08:00 AEDT. The published meter covers 17-30 October, inclusive.
  const shift = {
    id: "synthetic-sydney",
    startsAt: "2026-10-16T13:00:00Z",
    endsAt: "2026-10-16T21:00:00Z",
    kind: "day" as const,
  };
  const meter = hoursMeter([shift], [], new Date("2026-10-17T01:00:00Z"), false);
  expect(meter.from).toBe("2026-10-17");
  expect(meter.rostered).toBe(8);
});

it.each([
  ["Australia/Perth", "2026-10-17", 8],
  ["Australia/Sydney", "2026-07-17", 8],
  ["Australia/Sydney", "2026-10-04", 7],
  ["Australia/Sydney", "2026-04-05", 9],
  ["Australia/Adelaide", "2026-10-17", 8],
  ["Australia/Darwin", "2026-10-17", 8],
])("counts actual elapsed hours from local midnight in %s on %s", (zone, date, hours) => {
  work.zone = zone;
  const startsAt = perthWallToIso(date, "00:00")!;
  const endsAt = perthWallToIso(date, "08:00")!;
  const meter = hoursMeter([{ id: "shift", startsAt, endsAt, kind: "day" }], [], new Date(startsAt), false);
  expect(meter.from).toBe(date);
  expect(meter.rostered).toBe(hours);
});

it.each(["Australia/Perth", "Australia/Sydney", "Australia/Adelaide"])(
  "uses seven calendar days rather than fixed elapsed days in %s across DST",
  (zone) => {
    work.zone = zone;
    const now = new Date(perthWallToIso("2026-10-01", "12:00")!);
    const row = (date: string, time: string) => ({
      status: "approved" as const,
      startsAt: perthWallToIso(date, time)!,
      endsAt: perthWallToIso("2026-10-08", "08:00")!,
    });
    const before = row("2026-10-07", "23:59");
    expect(groupPosted([before, row("2026-10-08", "00:00")], now).filledThisWeek).toEqual([before]);
  },
);

it("does not post a Teaching move into a skipped Sydney clock time", () => {
  const session = {
    occurrenceId: "session",
    serviceId: "service",
    title: "Teaching",
    startsAt: "2026-10-03T01:00:00Z",
    endsAt: "2026-10-03T02:00:00Z",
    venue: "Room",
    status: "scheduled",
    source: "teaching",
    hasJoinLink: false,
  } as SessionSummary;
  const draft = { ...draftFor(session), date: "2026-10-04", startTime: "02:30" };
  expect(changeRisks(session, draft, [])).toEqual([
    expect.objectContaining({ rule: "time", text: expect.stringContaining("valid date and time") }),
  ]);
  expect(changeBody(session, draft).startsAt).toBe(session.startsAt);
});

it("keeps the original instant on either side of a repeated Sydney clock time for a room edit", () => {
  const session = {
    occurrenceId: "session",
    serviceId: "service",
    title: "Teaching",
    startsAt: "2026-04-04T15:30:15Z",
    endsAt: "2026-04-04T16:30:15Z",
    venue: "Room A",
    status: "scheduled",
    source: "teaching",
    hasJoinLink: false,
  } as SessionSummary;
  const body = changeBody(session, { ...draftFor(session), venue: "Room B" });
  expect(body.startsAt).toBe(session.startsAt);
  expect(body.endsAt).toBe(session.endsAt);
});
it("excludes an approved shift starting after the seven local days end", () => {
  // Window advertised as next 7 days starts 17 Oct and ends at 24 Oct local midnight.
  const shift = { status: "approved" as const, startsAt: "2026-10-23T14:00:00Z", endsAt: "2026-10-23T22:00:00Z" };
  // Starts 24 Oct 01:00 AEDT; fixed +08 boundary incorrectly admits it until 03:00 AEDT.
  expect(groupPosted([shift], new Date("2026-10-17T01:00:00Z")).filledThisWeek).toEqual([]);
});
it("preserves the selected Sydney clock time when moving only a Teaching session room", () => {
  const session = {
    occurrenceId: "synthetic-session",
    serviceId: "synthetic-service",
    title: "Synthetic teaching",
    startsAt: "2026-10-17T01:00:00Z",
    endsAt: "2026-10-17T02:00:00Z",
    venue: "Synthetic room A",
    status: "scheduled",
    source: "teaching",
    hasJoinLink: false,
    isPresenter: false,
  } as SessionSummary;
  const draft = { ...draftFor(session), venue: "Synthetic room B" };
  expect(draft.startTime).toBe("12:00");
  // Changing just the room must not move noon Sydney to 15:00 Sydney.
  expect(changeBody(session, draft).startsAt).toBe(session.startsAt);
});
