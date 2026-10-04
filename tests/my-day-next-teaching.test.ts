import { describe, expect, it } from "vitest";

import { nextTeachingSession } from "@/lib/my-day/next-teaching";
import type { SessionSummary } from "@/lib/teaching/model";

function session(id: string, startsAt: string, endsAt: string, extra: Partial<SessionSummary> = {}): SessionSummary {
  return {
    occurrenceId: id,
    serviceId: "service",
    title: `Session ${id}`,
    startsAt,
    endsAt,
    venue: null,
    hasJoinLink: false,
    status: "scheduled",
    isPresenter: false,
    source: "teaching",
    ...extra,
  };
}

const NOW = new Date("2026-10-05T04:00:00Z"); // 12:00 in Perth

describe("nextTeachingSession", () => {
  it("picks the soonest session that has not finished", () => {
    const later = session("b", "2026-10-07T04:00:00Z", "2026-10-07T05:00:00Z");
    const sooner = session("a", "2026-10-05T04:30:00Z", "2026-10-05T05:30:00Z");
    expect(nextTeachingSession([later, sooner], NOW)?.occurrenceId).toBe("a");
  });

  it("keeps a session that is on now, and drops one that has finished", () => {
    const finished = session("done", "2026-10-05T01:00:00Z", "2026-10-05T02:00:00Z");
    const onNow = session("now", "2026-10-05T03:30:00Z", "2026-10-05T04:30:00Z");
    expect(nextTeachingSession([finished, onNow], NOW)?.occurrenceId).toBe("now");
  });

  it("never leads with a cancelled or all-day session", () => {
    const cancelled = session("x", "2026-10-05T04:30:00Z", "2026-10-05T05:30:00Z", { status: "cancelled" });
    const allDay = session("y", "2026-10-05T05:00:00Z", "2026-10-05T06:00:00Z", { allDay: true });
    const real = session("z", "2026-10-06T04:30:00Z", "2026-10-06T05:30:00Z");
    expect(nextTeachingSession([cancelled, allDay, real], NOW)?.occurrenceId).toBe("z");
  });

  it("is null when nothing is ahead", () => {
    expect(nextTeachingSession([], NOW)).toBeNull();
  });
});
