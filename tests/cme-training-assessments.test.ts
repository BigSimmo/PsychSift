import { describe, expect, it } from "vitest";

import {
  attainedEpas,
  epaAssessmentsLogged,
  epaAssessmentsRuleLine,
  epaNextBySentence,
  epaRowDetail,
  epaSegmentsSentence,
  epasInProgress,
  experienceCell,
  experienceCount,
  formatDayFullMonth,
  formatShortMonth,
  milestoneSummary,
  termBars,
  termChartSentence,
  termRowDetail,
  termWeek,
  timeUntil,
  trainingExampleView,
  trainingRecordSummary,
  xOfY,
} from "@/lib/cme/training-assessments";
import {
  SAMPLE_INTERN_ASSESSMENTS,
  SAMPLE_REGISTRAR_ASSESSMENTS,
  SAMPLE_TRAINING_MILESTONES,
  SAMPLE_TRAINING_NOW_ISO,
  SAMPLE_TRAINING_PERIODS,
  sampleTrainingAssessments,
} from "@/lib/cme/training-assessments-sample";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { currentPosition, nextMilestone } from "@/lib/cme/training-timeline";

const TODAY = perthCalendarDate(new Date(SAMPLE_TRAINING_NOW_ISO));

describe("training assessments: small wording helpers", () => {
  it("reads the example search param, defaulting to the registrar", () => {
    expect(trainingExampleView("intern")).toBe("intern");
    expect(trainingExampleView(["intern", "registrar"])).toBe("intern");
    expect(trainingExampleView("registrar")).toBe("registrar");
    expect(trainingExampleView("anything")).toBe("registrar");
    expect(trainingExampleView(undefined)).toBe("registrar");
    expect(trainingExampleView(null)).toBe("registrar");
  });

  it("formats dates and counts", () => {
    expect(TODAY).toBe("2026-10-04");
    expect(xOfY(1, 2)).toBe("1 of 2");
    expect(formatDayFullMonth("2027-01-29")).toBe("29 January");
    expect(formatShortMonth("2026-11-23")).toBe("Nov");
  });

  it("says how far away a date is", () => {
    expect(timeUntil(TODAY, "2026-10-04")).toBe("today");
    expect(timeUntil(TODAY, "2026-10-05")).toBe("tomorrow");
    expect(timeUntil(TODAY, "2026-10-03")).toBe("yesterday");
    expect(timeUntil(TODAY, "2026-10-16")).toBe("in 12 days");
    expect(timeUntil(TODAY, "2026-11-01")).toBe("in 4 weeks");
    expect(timeUntil(TODAY, "2027-01-29")).toBe("in about 17 weeks");
  });
});

describe("training assessments: registrar EPAs", () => {
  it("counts the sample's EPAs as the mock-up shows them", () => {
    expect(attainedEpas(SAMPLE_REGISTRAR_ASSESSMENTS)).toHaveLength(1);
    expect(epasInProgress(SAMPLE_REGISTRAR_ASSESSMENTS)).toHaveLength(2);
    expect(epaSegmentsSentence(1, 2)).toBe("1 of the minimum 2 EPAs marked attained this rotation.");
  });

  it("says what is still needed by the rotation's end, and when the minimum is reached", () => {
    expect(epaNextBySentence(1, 2, "2027-01-29")).toBe(
      "At least 1 more by 29 January. The minimum is 2 for each 6-month full-time rotation, pro rata if part-time.",
    );
    expect(epaNextBySentence(0, 2, "2027-01-29")).toMatch(/^At least 2 more by 29 January\./);
    expect(epaNextBySentence(2, 2, "2027-01-29")).toBe(
      "You have marked 2 attained this rotation. The minimum is 2 for each 6-month full-time rotation, pro rata if part-time.",
    );
  });

  it("words each EPA row in the mock-up's words", () => {
    const [one, two, three] = SAMPLE_REGISTRAR_ASSESSMENTS.epas;
    expect(epaRowDetail(one, 3)).toBe("2 of 3 WBAs logged · Dr Example");
    expect(epaRowDetail(two, 3)).toBe("0 of 3 WBAs logged · not started");
    expect(epaRowDetail(three, 3)).toBe("You marked it attained on 14 Sep · keep your COE form in InTrain");
    expect(epaRowDetail({ ...one, assessor: null }, 3)).toBe("2 of 3 WBAs logged");
  });
});

describe("training assessments: junior doctor", () => {
  it("works out the week of the term", () => {
    expect(termWeek(TODAY, "2026-09-14", "2026-11-22")).toEqual({ week: 3, weeks: 10 });
    expect(termWeek("2026-09-14", "2026-09-14", "2026-11-22")).toEqual({ week: 1, weeks: 10 });
    expect(termWeek("2026-11-22", "2026-09-14", "2026-11-22")).toEqual({ week: 10, weeks: 10 });
    // Clamped outside the term.
    expect(termWeek("2026-09-01", "2026-09-14", "2026-11-22").week).toBe(1);
    expect(termWeek("2026-12-30", "2026-09-14", "2026-11-22").week).toBe(10);
  });

  it("words the term row", () => {
    const term4 = SAMPLE_INTERN_ASSESSMENTS.terms[3];
    expect(termRowDetail(TODAY, term4)).toBe("Mon 14 Sep to Sun 22 Nov · week 3 of 10");
  });

  it("counts EPA assessments and labels every term in the chart", () => {
    expect(epaAssessmentsLogged(SAMPLE_INTERN_ASSESSMENTS)).toBe(7);
    expect(epaAssessmentsRuleLine(SAMPLE_INTERN_ASSESSMENTS)).toBe("logged · at least 10 a year, at least 2 each term");
    const bars = termBars(SAMPLE_INTERN_ASSESSMENTS);
    expect(bars.map((bar) => bar.caption)).toEqual(["3", "2", "2", "0 of 2", "Nov"]);
    expect(bars.map((bar) => bar.state)).toEqual(["done", "done", "done", "current", "future"]);
    expect(termChartSentence(bars)).toBe("Term 1: 3, term 2: 2, term 3: 2, term 4: 0 so far, term 5 not started.");
  });

  it("fills the A to D grid and counts each row", () => {
    const [a, b, c, d] = SAMPLE_INTERN_ASSESSMENTS.experience;
    expect([a, b, c, d].map((row) => experienceCount(row, 3))).toEqual(["2 of 3", "1 of 3", "2 of 3", "0 of 3"]);
    expect([1, 2, 3, 4, 5].map((term) => experienceCell(a, term, 4))).toEqual([
      "covered",
      "open",
      "covered",
      "current",
      "open",
    ]);
  });
});

describe("training assessments: record summary rows", () => {
  it("summarises the sample registrar's record and milestones", () => {
    const position = currentPosition(SAMPLE_TRAINING_PERIODS, TODAY);
    expect(trainingRecordSummary(SAMPLE_TRAINING_PERIODS, position, TODAY)).toBe(
      "Stage 3 · rotation 2 of 4 · 1 rotation done",
    );
    const next = nextMilestone(SAMPLE_TRAINING_MILESTONES, SAMPLE_TRAINING_PERIODS, TODAY);
    expect(milestoneSummary(SAMPLE_TRAINING_MILESTONES, next, TODAY)).toBe("3 open · next Mon 2 Nov");
  });

  it("says plainly when there is nothing, everything is done, or something is overdue", () => {
    expect(trainingRecordSummary([], currentPosition([], TODAY), TODAY)).toBe("Nothing recorded yet");
    expect(milestoneSummary([], null, TODAY)).toBe("None yet");
    const done = SAMPLE_TRAINING_MILESTONES.map((milestone) => ({ ...milestone, completedOn: "2026-10-01" }));
    expect(milestoneSummary(done, null, TODAY)).toBe("Every milestone is marked done");
    const overdue = [{ ...SAMPLE_TRAINING_MILESTONES[0], dueOn: "2026-09-01" }];
    expect(milestoneSummary(overdue, nextMilestone(overdue, SAMPLE_TRAINING_PERIODS, TODAY), TODAY)).toBe(
      "1 open · overdue since Tue 1 Sep",
    );
    const onBreak = [
      { id: "s", kind: "stage" as const, label: "Stage 1", startsOn: "2026-01-01", endsOn: null, fte: 1 },
      { id: "b", kind: "break" as const, label: "Leave", startsOn: "2026-09-01", endsOn: null, fte: 0 },
    ];
    expect(trainingRecordSummary(onBreak, currentPosition(onBreak, TODAY), TODAY)).toBe("Stage 1 · on a break");
  });
});

describe("training assessments: the sample fixture", () => {
  it("is labelled a sample and keeps assessor names in the fixture only", () => {
    expect(sampleTrainingAssessments("registrar")).toMatchObject({ status: "sample", view: "registrar" });
    expect(sampleTrainingAssessments("intern")).toMatchObject({ status: "sample", view: "intern" });
    expect(SAMPLE_REGISTRAR_ASSESSMENTS.epas.map((epa) => epa.assessor)).toEqual(["Dr Example", null, null]);
  });
});
