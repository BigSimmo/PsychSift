import { describe, expect, it } from "vitest";

import { EPAS, EVIDENCE_SOURCES, GLOSSARY } from "@/lib/teaching/assessments/content";
import {
  assessmentsReducer,
  epaNeedMore,
  epaRecords,
  epaStillNeeded,
  formBlockers,
  initialAssessmentsState,
  stage,
  supervisorTodo,
  type AssessmentsAction,
  type AssessmentsState,
} from "@/lib/teaching/assessments/model";
import { SAMPLE_EPA_RECORDS, type EpaRecord } from "@/lib/teaching/assessments/sample";

/*
 * Assessments review 2, worker A (9 Oct 2026): end of term follows CLA, EPA counts respect every AMC floor,
 * and guest assessors' EPAs are marked Unapproved. Sources: work-mode-build/assessments-cla-sources-check.md.
 */

const run = (...actions: AssessmentsAction[]) =>
  actions.reduce<AssessmentsState>((s, a) => assessmentsReducer(s, a), initialAssessmentsState());

describe("EPAs still needed (AMC Section 3A, p.50)", () => {
  it("counts at least 2 in each remaining term, not just EPA 1 and 10 a year (the audit's worked case)", () => {
    // Nine EPAs. Term 4 has EPA 3 and EPA 4 but no EPA 1. Term 5 has none yet.
    const records: Pick<EpaRecord, "term" | "epa">[] = [
      { term: "t1", epa: 1 },
      { term: "t1", epa: 2 },
      { term: "t2", epa: 1 },
      { term: "t2", epa: 3 },
      { term: "t3", epa: 1 },
      { term: "t3", epa: 2 },
      { term: "t3", epa: 4 },
      { term: "t4", epa: 3 },
      { term: "t4", epa: 4 },
    ];
    // EPA 1 in term 4, then EPA 1 and one more in term 5: 3, where the old count said 2.
    expect(epaStillNeeded(records, ["t4", "t5"])).toBe(3);
  });

  it("adds EPAs 2 to 4 still short only beyond the free slots", () => {
    // Six EPA 1s in term 1, so the 10-a-year floor (4 more) is not the binding rule here.
    const records: Pick<EpaRecord, "term" | "epa">[] = Array.from({ length: 6 }, () => ({ term: "t1", epa: 1 }));
    // Term 2 needs EPA 1 and one free slot. EPAs 2, 3 and 4 need 6 between them, 1 of which fits the free slot.
    expect(epaStillNeeded(records, ["t2"])).toBe(2 + 5);
  });

  it("never needs fewer than 10 in a year", () => {
    expect(epaStillNeeded([], [])).toBe(10);
  });

  it("gives 3 for the sample on Mon 5 Oct", () => {
    expect(epaNeedMore(initialAssessmentsState())).toBe(3);
  });
});

describe("Guest assessors' EPAs (CLA detailed FAQs v2.0, p.5)", () => {
  it("marks a guest assessor's EPA unapproved, and nobody else's", () => {
    const s = run(
      { type: "request-epa", epa: 2, who: "guest", guest: "nurse" },
      { type: "record-epa", index: 0, level: "proximal" },
      { type: "request-epa", epa: 1, who: "sup" },
      { type: "record-epa", index: 1, level: "minimal" },
    );
    const added = epaRecords(s).slice(SAMPLE_EPA_RECORDS.length);
    expect(added[0]).toMatchObject({ epa: 2, by: "Guest assessor", unapproved: true });
    expect(added[1]?.unapproved).toBeUndefined();
  });
});

describe("End of term follows CLA (CLA Training Guide for Prevocational Doctors, p.12)", () => {
  it("lets the supervisor start a draft before the doctor says they're ready", () => {
    const s = run({ type: "set-rating", who: "sup", domain: 1, rating: 4 });
    expect(s.request.sent).toBe(false);
    expect(stage(s)).toBe("sup-draft");
  });

  it("counts Sam's form on the supervisor's To do from the start", () => {
    expect(supervisorTodo(initialAssessmentsState())).toBe(3);
  });

  it("never blocks the form on telling the MEU about an improvement plan", () => {
    const s = run(
      { type: "form-example", who: "sup" },
      { type: "set-global", who: "sup", rating: "cond" },
      { type: "form-finish", who: "sup" },
    );
    expect(formBlockers(s.sup, "sup")).toEqual([]);
    expect(s.sup.status).toBe("done");
  });
});

describe("Wording against the AMC and owner defaults", () => {
  it("drops the unsourced DPME title and keeps DCT", () => {
    const terms = GLOSSARY.map(([term]) => term);
    expect(terms).not.toContain("DPME");
    expect(GLOSSARY.find(([term]) => term === "DCT")?.[1]).toMatch(/Some hospitals use a different title\./);
  });

  it("uses the AMC form's evidence sources and EPA 2 title", () => {
    expect(EVIDENCE_SOURCES).toContain("Allied health professionals");
    expect(EVIDENCE_SOURCES).toContain("PGY1/PGY2 record of learning");
    expect(EPAS[1]?.title).toBe("Recognition and care of the acutely unwell patient");
  });

  it("says PMCWA accredits, not runs, the framework", () => {
    expect(GLOSSARY.find(([term]) => term === "PMCWA")?.[1]).toMatch(/Accredits/);
  });
});
