import { describe, expect, it } from "vitest";

import { traineeHref } from "@/components/teaching/assessments/assessments-parts";
import { resolveRole } from "@/components/teaching/assessments/teaching-assessments";
import { PANEL_FACTS, guestAssessors, GUEST_ASSESSORS } from "@/lib/teaching/assessments/dct";
import { assessmentsReducer, initialAssessmentsState, type AssessmentsAction } from "@/lib/teaching/assessments/model";
import { cellLabel, cellWord, doctorTimeline, overviewDoctors } from "@/lib/teaching/assessments/overview";
import { EXAMPLE_ASSESSMENTS_SUPERVISION } from "@/lib/example-data/datasets/assessments-supervision";
import { initialTraineeState, traineeView } from "@/lib/work-screens/assessments/trainee";

const SIGNED_BY_BOTH: AssessmentsAction[] = [
  { type: "form-example", who: "self" },
  { type: "form-finish", who: "self" },
  { type: "send-request" },
  { type: "form-example", who: "sup" },
  { type: "form-finish", who: "sup" },
  { type: "set-now", now: 1 },
  { type: "book", day: 2, time: "14:30" },
  { type: "set-now", now: 2 },
  { type: "meeting-held" },
  { type: "sign", who: "sup", typed: "Robin Wattle", image: null },
  { type: "sign", who: "self", typed: "Sam Karri", image: null },
];

const run = (actions: AssessmentsAction[]) => actions.reduce(assessmentsReducer, initialAssessmentsState());

describe("Assessments: views the DCT does not have (site audit B2)", () => {
  it("draws the doctor's screen, never the DCT's home under another title", () => {
    for (const view of ["all", "form", "sign", "pdf", "times", "side", "record", "inbox"] as const) {
      expect(resolveRole(view, "dct", "dct"), view).toBe("doctor");
      expect(resolveRole(view, null, "dct"), view).toBe("doctor");
    }
  });

  it("keeps the DCT on the DCT's own views", () => {
    for (const view of ["home", "progress", "overview", "words", "help", "epaform"] as const) {
      expect(resolveRole(view, null, "dct"), view).toBe("dct");
    }
    expect(resolveRole("dctsign", "doctor", "doctor")).toBe("dct");
    expect(resolveRole("plan", null, "doctor")).toBe("dct");
    expect(resolveRole("all", null, "supervisor")).toBe("supervisor");
  });
});

describe("Assessments: a doctor's own page keeps the caller's side (M4)", () => {
  it("names the side it was opened from", () => {
    expect(traineeHref("ravi", "dct")).toBe("/teaching/assessments/trainee/ravi?as=dct");
    expect(traineeHref("sam", "doctor")).toBe("/teaching/assessments/trainee/sam?as=doctor");
    expect(traineeHref("ben")).toBe("/teaching/assessments/trainee/ben?as=supervisor");
  });
});

describe("Assessments: the term overview's status rules (rules audit M13)", () => {
  it("shows EPAs as done only with EPA 1 among this term's two", () => {
    const sam = (actions: AssessmentsAction[]) => overviewDoctors(run(actions)).find((r) => r.id === "sam")!;
    const noEpa1 = sam([
      { type: "record-epa-direct", epa: 2, level: "proximal" },
      { type: "record-epa-direct", epa: 3, level: "proximal" },
    ]);
    expect(noEpa1.epas.count).toBeGreaterThanOrEqual(2);
    expect(noEpa1.epas.status).toBe("due");
    expect(noEpa1.epas.detail).toContain("no EPA 1 yet");
    const withEpa1 = sam([
      { type: "record-epa-direct", epa: 1, level: "proximal" },
      { type: "record-epa-direct", epa: 3, level: "proximal" },
    ]);
    expect(withEpa1.epas.status).toBe("done");
  });

  it("shows the end-of-term as signed by both until the DCT signs it off", () => {
    const s = run(SIGNED_BY_BOTH);
    const before = overviewDoctors(s).find((r) => r.id === "sam")!;
    expect(cellWord(before.end)).toBe("Signed by both");
    expect(cellLabel("End-of-term", before.end)).toBe("End-of-term signed by both");
    expect(doctorTimeline(before).at(-1)?.word).toBe("Signed by both");
    // Still due until the DCT signs off, so it stays in the due list and its reminders.
    expect(before.end.status).toBe("due");
    expect(before.bucket).not.toBe("on_track");
    const after = overviewDoctors(s, "Wed 28 Oct").find((r) => r.id === "sam")!;
    expect(cellWord(after.end)).toBe("Done");
    expect(after.end.detail).toBe("DCT sign-off Wed 28 Oct");
    expect(after.end.status).toBe("done");
  });

  it("gives the doctor's own page the same end-of-term word as the Term overview", () => {
    const s = run(SIGNED_BY_BOTH);
    const end = (dct: string | null) =>
      traineeView(s, initialTraineeState, "sam", EXAMPLE_ASSESSMENTS_SUPERVISION, dct)!.timeline.at(-1)!;
    expect(cellWord(end(null))).toBe("Signed by both");
    expect(end(null).status).toBe("due");
    expect(cellWord(end("Wed 28 Oct"))).toBe("Done");
  });
});

describe("Assessments: DCT facts (M16, M13)", () => {
  it("words the panel as the AMC guide does", () => {
    expect(PANEL_FACTS).toContain("Prevocational doctors (PGY1 and PGY2) are never panellists.");
    expect(PANEL_FACTS[0]).toContain("The chair should generally be a senior doctor, but not the DCT.");
  });

  it("adds a story guest once they answer, as CLA makes them Unapproved on submitting", () => {
    const asked = run([{ type: "request-epa", epa: 3, who: "guest", guest: "pharmacist" }]);
    expect(guestAssessors(asked)).toHaveLength(GUEST_ASSESSORS.length);
    const answered = assessmentsReducer(asked, { type: "record-epa", index: 0, level: "proximal" });
    const guests = guestAssessors(answered);
    expect(guests).toHaveLength(GUEST_ASSESSORS.length + 1);
    expect(guests.at(-1)).toEqual({ name: null, role: "Pharmacist", what: "EPA 3 for Dr Sam Karri" });
  });
});
