import { describe, expect, it } from "vitest";

import { TEACHING_EXAM_PREP_STORAGE_KEY, TEACHING_TERM_TRACKER_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import {
  defaultMilestones,
  EMPTY_EXAM_PREP,
  EMPTY_TERM_TRACKER,
  epaSummary,
  isValidTermTracker,
  milestoneState,
  parseExamPrep,
  parseTermTracker,
  sampleExamPrep,
  sampleTermTracker,
  studyHeatmap,
  studyPlanWeek,
  studyStreak,
  termWeekCount,
  termWeekOf,
  TERM_TRACKER_SOURCES,
  type TermRecord,
} from "@/lib/teaching/term-tracker";

const term = (overrides: Partial<TermRecord> = {}): TermRecord => ({
  id: "t4",
  number: 4,
  unit: "Psychiatry",
  site: "Example Hospital",
  startsOn: "2026-08-31",
  endsOn: "2026-11-06",
  supervisor: "",
  milestones: defaultMilestones("2026-08-31", "2026-11-06"),
  goals: [],
  toRaise: [],
  meeting: null,
  ...overrides,
});

describe("term weeks", () => {
  it("counts a ten-week term and places today in it", () => {
    const t = term();
    expect(termWeekCount(t)).toBe(10);
    expect(termWeekOf(t, "2026-08-31")).toBe(1);
    expect(termWeekOf(t, "2026-10-06")).toBe(6);
    expect(termWeekOf(t, "2026-11-06")).toBe(10);
    expect(termWeekOf(t, "2026-08-30")).toBe(0);
    expect(termWeekOf(t, "2026-11-07")).toBe(11);
  });

  it("offers due dates inside the term, ending on its last day", () => {
    const m = defaultMilestones("2026-08-31", "2026-11-06");
    expect(m.start.dueOn).toBe("2026-09-06");
    expect(m.mid.dueOn > m.start.dueOn && m.mid.dueOn < m.end.dueOn).toBe(true);
    expect(m.end.dueOn).toBe("2026-11-06");
    expect(Object.values(m).every((x) => x.doneOn === null)).toBe(true);
  });
});

describe("milestone state is worked out when read", () => {
  it("marks the earliest unfinished one next, and past-due ones overdue", () => {
    const t = term();
    expect(milestoneState(t, "start", "2026-09-01")).toBe("due");
    expect(milestoneState(t, "mid", "2026-09-01")).toBe("later");
    expect(milestoneState(t, "start", "2026-09-10")).toBe("overdue");
    const done = term({ milestones: { ...t.milestones, start: { ...t.milestones.start, doneOn: "2026-09-02" } } });
    expect(milestoneState(done, "start", "2026-10-06")).toBe("done");
  });
});

describe("EPAs", () => {
  it("counts this calendar year and this term separately", () => {
    const state = {
      ...EMPTY_TERM_TRACKER,
      epas: [
        { id: "a", termId: "t1", epa: 1 as const, on: "2025-12-01" },
        { id: "b", termId: "t2", epa: 1 as const, on: "2026-03-01" },
        { id: "c", termId: "t4", epa: 3 as const, on: "2026-09-20" },
      ],
    };
    const summary = epaSummary(state, "t4", "2026-10-06");
    expect(summary.year).toBe(2);
    expect(summary.term).toBe(1);
    expect(summary.byEpa).toEqual({ 1: 1, 2: 0, 3: 1, 4: 0 });
  });

  it("never applies a target the doctor has not confirmed", () => {
    expect(EMPTY_TERM_TRACKER.targets).toBeNull();
    expect(parseTermTracker(null).targets).toBeNull();
  });
});

describe("stored records", () => {
  it("round-trips a valid record and treats anything else as empty", () => {
    const sample = sampleTermTracker("2026-10-06");
    expect(isValidTermTracker(sample)).toBe(true);
    expect(parseTermTracker(JSON.stringify(sample))).toEqual(sample);
    expect(parseTermTracker("{not json")).toEqual(EMPTY_TERM_TRACKER);
    expect(parseTermTracker(JSON.stringify({ version: 2 }))).toEqual(EMPTY_TERM_TRACKER);
    const exam = sampleExamPrep("2026-10-06");
    expect(parseExamPrep(JSON.stringify(exam))).toEqual(exam);
    expect(parseExamPrep('{"version":1,"study":{"x":5}}')).toEqual(EMPTY_EXAM_PREP);
  });

  it("is cleared with the other account-scoped keys", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/lib/account-scoped-browser-state.ts", "utf8"),
    );
    const clear = source.slice(source.indexOf("export function clearAccountScopedBrowserStorage"));
    expect(clear).toContain("TEACHING_TERM_TRACKER_STORAGE_KEY");
    expect(clear).toContain("TEACHING_EXAM_PREP_STORAGE_KEY");
    expect(TEACHING_TERM_TRACKER_STORAGE_KEY).not.toBe(TEACHING_EXAM_PREP_STORAGE_KEY);
  });

  it("keeps the sample term current, with the mid-term still ahead", () => {
    const sample = sampleTermTracker("2026-10-06");
    const t = sample.terms[0];
    expect(termWeekOf(t, "2026-10-06")).toBe(6);
    expect(milestoneState(t, "mid", "2026-10-06")).toBe("due");
  });
});

describe("study", () => {
  it("builds 12 Monday-first weeks ending this week, with later days marked", () => {
    const weeks = studyHeatmap({ "2026-10-05": 60 }, "2026-10-06");
    expect(weeks).toHaveLength(12);
    expect(weeks[11][0].date).toBe("2026-10-05");
    expect(weeks[11][0].level).toBe(2);
    expect(weeks[11][2].future).toBe(true);
  });

  it("counts a streak ending today, or yesterday when today is still empty", () => {
    const study = { "2026-10-03": 30, "2026-10-04": 30, "2026-10-05": 30 };
    expect(studyStreak(study, "2026-10-05")).toBe(3);
    expect(studyStreak(study, "2026-10-06")).toBe(3);
    expect(studyStreak(study, "2026-10-07")).toBe(0);
  });

  it("places today in the study plan", () => {
    expect(studyPlanWeek({ name: "x", on: "2027-01-25", planStartsOn: "2026-08-24" }, "2026-10-06")).toEqual({
      week: 7,
      total: 22,
    });
  });
});

describe("CLA links", () => {
  it("keeps PMCWA's information page apart from the CLA sign-in page", () => {
    expect(TERM_TRACKER_SOURCES.pmcwaCla).toBe("https://pmcwa.org.au/education-training/cla");
    expect(TERM_TRACKER_SOURCES.claSignIn).toBe("https://cla.epads.mkmapps.com");
  });
});
