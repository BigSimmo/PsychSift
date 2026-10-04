import { describe, expect, it } from "vitest";

import { answerQuestion, askNeedsTeamReady, type AskAnswerData } from "@/lib/roster/ask/answer";
import { perthWallToIso } from "@/lib/roster/shifts/perth-time";

const actorId = "11111111-1111-4111-8111-111111111111";
const base: AskAnswerData = {
  today: "2026-10-01",
  shifts: [],
  assignments: [],
  actorId,
  teamName: "Example Hospital",
  loadedRange: { from: "2026-09-24", to: "2026-11-24" },
  publication: { periodStart: "2026-10-01", periodEnd: "2026-10-31", publishedAt: "2026-10-02T08:10:00Z" },
};

describe("Ask Roster answers", () => {
  it("never calls an uncovered empty date a day off", () => {
    const result = answerQuestion({ kind: "on_date", span: { from: "2026-12-14", to: "2026-12-14" } }, base);
    expect(result.lines.join(" ")).toMatch(/outside|can't confirm/i);
    expect(result.lines.join(" ")).not.toMatch(/day off|free/i);
  });

  it("shows four weekends with unknown coverage clearly marked", () => {
    const result = answerQuestion(
      { kind: "next_weekend_off" },
      { ...base, publication: { ...base.publication!, periodEnd: "2026-10-04" } },
    );
    expect(result.rows).toHaveLength(4);
    expect(result.rows?.slice(1).every((row) => row.detail === "Coverage not loaded")).toBe(true);
  });

  it("only names a colleague when the published team window covers the date", () => {
    const assignment = {
      id: "a",
      userId: "2",
      name: "Sam Example",
      grade: "registrar",
      startsAt: "2026-10-03T00:00:00Z",
      endsAt: "2026-10-03T08:00:00Z",
      kind: "day",
      shiftCode: "D",
    };
    const result = answerQuestion(
      { kind: "who_on", date: "2026-10-03", grade: "registrar" },
      { ...base, assignments: [assignment] },
    );
    expect(result.rows?.[0]?.label).toBe("Sam Example");
    expect(result.source).toMatch(/published/);
  });

  it("counts saved extra time in the fortnight hours answer", () => {
    const result = answerQuestion(
      { kind: "hours_fortnight" },
      {
        ...base,
        shifts: [
          {
            id: "s1",
            startsAt: perthWallToIso("2026-09-28", "08:00")!,
            endsAt: perthWallToIso("2026-09-28", "16:30")!,
            title: "Day",
            location: null,
            kind: "day",
            source: "manual",
          },
        ],
        extras: [
          {
            startedAt: perthWallToIso("2026-09-28", "16:30")!,
            endedAt: perthWallToIso("2026-09-28", "17:30")!,
          },
        ],
      },
    );
    expect(result.lines[0]).toMatch(/8\.5 rostered hours/);
    expect(result.lines[1]).toMatch(/1 hours of saved extra time/);
    expect(result.source).toBe("From your own shifts");
  });

  it("waits on the team only for who-is-on and swap handoffs", () => {
    expect(askNeedsTeamReady({ kind: "question", q: { kind: "hours_fortnight" } })).toBe(false);
    expect(askNeedsTeamReady({ kind: "question", q: { kind: "next_nights" } })).toBe(false);
    expect(askNeedsTeamReady({ kind: "question", q: { kind: "who_on", date: "2026-10-03" } })).toBe(true);
    expect(
      askNeedsTeamReady({
        kind: "change",
        intent: { kind: "give_away", assignmentId: "a" },
      }),
    ).toBe(true);
  });
});
