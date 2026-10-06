import { describe, expect, it } from "vitest";

import { buildMyDaySample } from "@/components/my-day/my-day-sample";
import { isOccurrenceId } from "@/components/teaching/session-view-model";
import { perthCalendarDate } from "@/lib/cme/cpd-year";

// 09:00 on Sat 3 Oct 2026 in Perth.
const NOW = new Date("2026-10-03T01:00:00Z");
const TODAY = perthCalendarDate(NOW);

describe("buildMyDaySample", () => {
  const sample = buildMyDaySample(TODAY, NOW);

  it("is built around today, with tonight's on-call shift and today's teaching", () => {
    expect(
      sample.sources.roster.shifts.some((shift) => shift.kind === "on_call" && shift.startsAt.startsWith(TODAY)),
    ).toBe(true);
    expect(sample.sources.teaching.sessions.map((session) => session.title)).toEqual(["Registrar teaching: agitation"]);
    expect(sample.sources.teaching.nextTalk?.isPresenter).toBe(true);
  });

  it("marks every source as sample data and every item as a sample, with My Day's return link", () => {
    expect(sample.sources.roster.sample && sample.sources.teaching.sample && sample.sources.cpd.sample).toBe(true);
    for (const item of sample.items) {
      expect(item.id.startsWith("sample:")).toBe(true);
      expect(item.href).toContain("from=my-day");
    }
  });

  it("orders overdue first and puts a passed date and an old routine there", () => {
    expect(sample.items[0]?.severity).toBe("overdue");
    const overdue = sample.items.filter((item) => item.severity === "overdue").map((item) => item.title);
    expect(overdue).toEqual(expect.arrayContaining(["Demo journal club", "Demo life support course"]));
  });

  it("keeps calls to counts and never offers a phone link", () => {
    expect(sample.extras.calls).toEqual({ total: 2, open: 1 });
    expect(sample.extras.pinnedNumbers.every((number) => number.tel === null)).toBe(true);
  });

  it("gives teaching sessions well-formed ids, so Teaching's session page asks a visitor to sign in", () => {
    for (const session of sample.sources.teaching.ahead ?? []) {
      expect(isOccurrenceId(session.occurrenceId)).toBe(true);
    }
  });

  it("adds CPD hours up month by month to the logged total", () => {
    const { cpd } = sample.sources;
    expect(cpd.byMonth.reduce((sum, hours) => sum + hours, 0)).toBe(cpd.loggedHours);
    const { educational, reviewing, measuring } = cpd.byCategory;
    expect(educational + reviewing + measuring).toBe(cpd.loggedHours);
    expect(cpd.byMonth.slice(10).every((hours) => hours === 0)).toBe(true);
  });
});
