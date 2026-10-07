import { describe, expect, it } from "vitest";

import {
  advertSourceProblem,
  applicationTextProblem,
  refereeNameProblem,
  refereeRoleProblem,
} from "@/lib/cme/applications";
import { cpdHomeRowProblems, cpdHomeRows, reflectionsToLeaveOut, titlesToHoldBack } from "@/lib/cme/cpd-home-send";
import {
  cpdTextLooksLikePatient,
  cpdTextPatientProblem,
  cpdTitleLooksLikePatient,
  cpdTitlePatientProblem,
} from "@/lib/cme/patient-detail-check";
import type { CmeEntry } from "@/lib/cme/types";
import { answerAgreementQuestion } from "@/lib/work-profile/agreement-answers";

// Every bypass the verifier found (verify-cpd-agreement.md, H2), as a reflection and as a title.
const BYPASSES = [
  "45​M with psychosis",
  "Mr​ Smith review",
  "M​r Smith review",
  "J.​S. on ward",
  "ＪＳ ４５Ｍ",
  "Ｍｒ Ｓｍｉｔｈ",
  "UMRN １２３４５６７",
  "case of ４５ｙｏ Ｆ",
  "Patient John Smith aged 45",
  "patient john smith",
  "Saw John Smith, 45",
  "Smith, John 45",
  "pt js 45m",
  "pt J S 45 M",
  "45 M",
  "45m with psychosis",
  "U1234567",
  "A1234567",
  "forty five year old woman",
  "Supervision of JS (registrar)",
  "RPH ward 6, JS",
];

function entry(id: string, overrides: Partial<CmeEntry>): CmeEntry {
  return {
    id,
    date: "2026-04-01",
    title: "Activity",
    allocations: [{ category: "educational", hours: 1 }],
    reflection: "",
    costCents: null,
    transcribed: false,
    routineId: null,
    documentId: null,
    buckets: [],
    ...overrides,
  };
}

describe("CPD patient-detail check, on the shared work-text check", () => {
  it.each(BYPASSES)("catches %j as a reflection and as a title", (text) => {
    expect(cpdTextLooksLikePatient(text, 2026)).toBe(true);
    expect(cpdTitleLooksLikePatient(text, 2026)).toBe(true);
    const rows = cpdHomeRows([entry("p", { title: text, reflection: text })], 2026);
    expect([...reflectionsToLeaveOut(rows, 2026)]).toEqual(["p"]);
    expect([...titlesToHoldBack([entry("p", { title: text })], 2026)]).toEqual(["p"]);
  });

  it.each([
    "Peer review 12/09/2026",
    "Dr J Smith lecture on lithium",
    "Lecture by Prof Lowe on clozapine",
    "APA webinar",
    "RANZCP congress day 2",
    "Grand round: ECT update",
    "30m webinar on ADHD",
    "45m webinar",
    "Journal Club, 2 papers",
    "Patient safety week",
    "Patient handover process review",
  ])("lets an ordinary CPD title through: %s", (title) => {
    expect(cpdTitleLooksLikePatient(title, 2026)).toBe(false);
    expect(cpdHomeRowProblems(cpdHomeRows([entry("a", { title })], 2026), 2026)).toEqual([]);
  });

  it("still reads an old full date in a title as a date of birth", () => {
    expect(cpdTitleLooksLikePatient("Review of case born 12/09/1980", 2026)).toBe(true);
    expect(cpdTitleLooksLikePatient("Case 12/09/1980", 2026)).toBe(true);
  });

  it("never changes the text it checks", () => {
    const title = "Ｍｒ Ｓｍｉｔｈ ½ day";
    const rows = cpdHomeRows([entry("p", { title })], 2026);
    cpdHomeRowProblems(rows, 2026);
    expect(rows[0]!.activity).toBe(title);
  });
});

describe("Job applications fields, on the shared check", () => {
  it.each(["Dr Ｊ.Ｓ.", "Dr J​.S​.", "Dr Grant ４５Ｍ", "Patient John Smith", "pt John Smith"])(
    "refuses %j as a referee name",
    (name) => {
      expect(refereeNameProblem(name, 2026)).not.toBeNull();
    },
  );

  it.each(["Dr Smith", "Mr Smith", "Dr J Smith", "A/Prof Jane Lowe"])("keeps %s as a referee name", (name) => {
    expect(refereeNameProblem(name, 2026)).toBeNull();
  });

  it.each([
    "Patient John Smith aged 45",
    "pt js 45m",
    "Consultant ＵＭＲＮ １２３４５６７",
    "Supervised me with JS on ward",
  ])("refuses %j as a role or in the statement", (text) => {
    expect(refereeRoleProblem(text, 2026)).not.toBeNull();
    expect(applicationTextProblem(text, 2026)).not.toBeNull();
  });

  it("lets hospital capitals through in a role", () => {
    expect(refereeRoleProblem("Consultant, RPH", 2026)).toBeNull();
    expect(refereeRoleProblem("Consultant, OPH", 2026)).toBeNull();
  });

  it("keeps an advert link and a job reference, and still refuses a patient detail", () => {
    expect(advertSourceProblem("https://jobs.health.wa.gov.au/en/job/583921/registrar-psychiatry", 2026)).toBeNull();
    expect(advertSourceProblem("Job ref 583921", 2026)).toBeNull();
    expect(advertSourceProblem("Hospital advert", 2026)).toBeNull();
    expect(advertSourceProblem("Mrs Smith URN 1234567", 2026)).not.toBeNull();
    expect(advertSourceProblem("https://example.org/x for pt js 45m", 2026)).not.toBeNull();
  });
});

describe("Ask the agreement, on the shared check", () => {
  it.each(["Ｍｒ Ｓｍｉｔｈ overtime after nights", "Mr​ Smith after nights", "pt js 45m after nights"])(
    "catches %j and never matches it",
    (question) => {
      expect(answerAgreementQuestion(question, { thisYear: 2026 }).kind).toBe("patient");
    },
  );

  it.each(["Do I get an RDO after 12 days?", "Can I have 3 days off for IVF?"])(
    "does not read %s as initials",
    (question) => {
      expect(answerAgreementQuestion(question, { thisYear: 2026 }).kind).not.toBe("patient");
    },
  );
});

describe("CPD form messages follow the CPD reading", () => {
  it("lets a speaker's title and a recent date through a title, as the CPD reading does", () => {
    for (const title of ["Dr J Smith lecture", "Peer review 12/09/2026", "Prof Lowe on lithium"]) {
      expect(cpdTitleLooksLikePatient(title, 2026)).toBe(false);
      expect(cpdTitlePatientProblem(title, 2026)).toBeNull();
    }
  });

  it("names the finding in words when a title or note holds a patient detail", () => {
    const title = cpdTitlePatientProblem("Discuss URN 1234567", 2026);
    expect(title?.title).toMatch(/record number/);
    expect(title?.suggestion).toBeNull();
    // A shape only the CPD layer catches still gets a plain message.
    const note = cpdTextPatientProblem("Saw John Smith, 45 with low mood", 2026);
    expect(cpdTextLooksLikePatient("Saw John Smith, 45 with low mood", 2026)).toBe(true);
    expect(note?.title).toBeTruthy();
    expect(cpdTextPatientProblem("Reflected on handover structure", 2026)).toBeNull();
  });
});
