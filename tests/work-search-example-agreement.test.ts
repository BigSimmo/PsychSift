import { describe, expect, it } from "vitest";

import { buildMyDaySample } from "@/components/my-day/my-day-sample";
import { searchShowsExamples } from "@/components/work-search/use-work-search-records";
import { addDaysToDate, perthDateOf } from "@/lib/perth-time";
import { answerWorkQuestion } from "@/lib/work-search/answers";
import type { WorkAreaRead, WorkItem } from "@/lib/work-search/model";
import { workSearchSample } from "@/lib/work-search/sample";

/**
 * Top 20 item 14 (8 Oct 2026): AI Search and My Day must tell the same story in
 * example mode. "Am I working tomorrow?" is answered from the one example
 * roster, the same shifts My Day's Today, Week view and Roster draw.
 */

const READY: WorkAreaRead[] = (["roster", "teaching", "cme", "my-work", "on-call"] as const).map((area) => ({
  area,
  status: "ready",
  sample: true,
}));

describe("example mode: AI Search agrees with My Day", () => {
  // 09:00 Perth on each of 14 days from Sat 3 Oct 2026, so every weekday and day off is checked.
  const days = Array.from({ length: 14 }, (_, offset) => new Date(Date.UTC(2026, 9, 3 + offset, 1, 0)));

  it.each(days.map((now) => [perthDateOf(now), now] as const))(
    "searches the shifts My Day draws (%s)",
    (today, now) => {
      const myDay = buildMyDaySample(today, now).sources.roster.shifts.map((shift) => `roster:shift:${shift.id}`);
      const searched = workSearchSample(now)
        .roster.map((item) => item.id)
        .filter((id) => id.startsWith("roster:shift:"));
      expect(searched.length).toBeGreaterThan(0);
      expect(searched.sort()).toEqual(myDay.sort());
    },
  );

  it.each(days.map((now) => [perthDateOf(now), now] as const))(
    "answers 'Am I working tomorrow?' and the next week's days as My Day's shifts say (%s)",
    (today, now) => {
      const shifts = buildMyDaySample(today, now).sources.roster.shifts;
      const sample = workSearchSample(now);
      const ask = (question: string) =>
        answerWorkQuestion(question, { items: sample.items, areas: READY, today, now: now.getTime(), cpd: sample.cpd });
      const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      for (let offset = 1; offset <= 7; offset += 1) {
        const date = addDaysToDate(today, offset);
        const named = `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
        const answer = ask(offset === 1 ? "Am I working tomorrow?" : `Am I working on ${named}?`);
        expect(answer, date).not.toBeNull();
        const searched = (answer?.items ?? [])
          .map((item) => item.id)
          .filter((id) => id.startsWith("roster:shift:"))
          .sort();
        const myDay = shifts
          .filter((shift) => perthDateOf(shift.startsAt) === date)
          .map((shift) => `roster:shift:${shift.id}`)
          .sort();
        expect(searched, date).toEqual(myDay);
      }
    },
  );

  it("splits the sample by area, so a signed-in reader can see examples in one area only", () => {
    const sample = workSearchSample(days[0] as Date);
    expect(sample.items).toEqual([...sample.roster, ...sample.teaching, ...sample.cme]);
    expect(sample.roster.every((item) => item.id.startsWith("roster:"))).toBe(true);
    expect(sample.teaching.every((item) => item.id.startsWith("teaching:"))).toBe(true);
    expect(sample.cme.every((item) => item.id.startsWith("cme:"))).toBe(true);
  });
});

describe("searchShowsExamples (signed in)", () => {
  const off = { active: false, mode: "auto" as const };
  const auto = { active: true, mode: "auto" as const };
  const realShift = [{ id: "roster:shift:1" }] as unknown as WorkItem[];

  it("answers Roster from examples only where Roster's page shows them", () => {
    const base = { teaching: false, cpd: false };
    // Switch off: always the reader's own roster.
    expect(searchShowsExamples({ ...base, roster: off, rosterReported: "empty", rosterRead: null }).roster).toBe(false);
    // Auto: an empty real roster shows examples, a roster with shifts never does.
    expect(
      searchShowsExamples({
        ...base,
        roster: auto,
        rosterReported: "unknown",
        rosterRead: { status: "ready", sample: false, items: [] },
      }).roster,
    ).toBe(true);
    expect(
      searchShowsExamples({
        ...base,
        roster: auto,
        rosterReported: "unknown",
        rosterRead: { status: "ready", sample: false, items: realShift },
      }).roster,
    ).toBe(false);
    // Auto, still reading: wait rather than flash examples over real shifts.
    expect(searchShowsExamples({ ...base, roster: auto, rosterReported: "unknown", rosterRead: null }).roster).toBe(
      false,
    );
    // Turned on: examples, as Roster shows them.
    expect(
      searchShowsExamples({
        ...base,
        roster: { active: true, mode: "on" },
        rosterReported: "has-data",
        rosterRead: { status: "ready", sample: false, items: realShift },
      }).roster,
    ).toBe(true);
  });

  it("follows Teaching and CPD's own switch", () => {
    const result = searchShowsExamples({
      roster: off,
      rosterReported: "unknown",
      rosterRead: null,
      teaching: true,
      cpd: false,
    });
    expect(result).toEqual({ roster: false, teaching: true, cme: false });
  });
});
