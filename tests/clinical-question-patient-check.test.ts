import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  clinicalQuestionPatientDetail,
  clinicalQuestionPatientDetailMessage,
} from "@/lib/clinical-question-patient-check";

/**
 * The Clinical question check reuses Work's patient-detail check. The decisive risk is the
 * other direction: a check that refuses ordinary clinical questions would push clinicians off
 * the tool. So the fixture questions below — the 20 high-risk evaluation questions plus the
 * retrieval golden set — must all pass, and so must the shapes a clinician types every day.
 */

type Fixture = { cases?: Array<{ question?: string; query?: string }> };

function fixtureQuestions(path: string): string[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Fixture | Array<{ question?: string; query?: string }>;
  const cases = Array.isArray(parsed) ? parsed : (parsed.cases ?? []);
  return cases.map((entry) => entry.question ?? entry.query ?? "").filter(Boolean);
}

const HIGH_RISK_QUESTIONS = fixtureQuestions("tests/fixtures/high-risk-eval-cases.draft.json");
const GOLDEN_QUERIES = fixtureQuestions("scripts/fixtures/rag-retrieval-golden.json");

const EVERYDAY_QUESTIONS = [
  "lithium dose for 70 year old",
  "clozapine in pregnancy",
  "ECT for catatonia",
  "NMS vs serotonin syndrome",
  "MAOI washout before starting an SSRI",
  "QTc limit for haloperidol",
  "TCA overdose management",
  "dose of Li in CKD stage 3",
  "Clozapine ANC < 1.5",
  "45 year old male with first episode psychosis",
  "aged 80 with delirium, haloperidol dose",
  "olanzapine IM max dose in 24 hours",
  "Form 1A criteria",
  "ADHD in adults stimulant dose",
  "QTc 480 ms on citalopram",
  "QTc over 500 ms with haloperidol",
  "is a QTc of 470 ms safe",
  "QRS widening over 100 ms in TCA overdose",
  "QTc 480msec on escitalopram",
  "patient with MS on interferon depression",
  "lithium in pt with renal impairment",
  "Pt on clozapine with fever",
];

describe("clinicalQuestionPatientDetail: ordinary clinical questions pass", () => {
  it("reads the 20 high-risk evaluation questions as safe", () => {
    expect(HIGH_RISK_QUESTIONS.length).toBeGreaterThanOrEqual(20);
    const flagged = HIGH_RISK_QUESTIONS.filter((question) => clinicalQuestionPatientDetail(question));
    expect(flagged).toEqual([]);
  });

  it("reads every retrieval golden query as safe", () => {
    expect(GOLDEN_QUERIES.length).toBeGreaterThan(0);
    const flagged = GOLDEN_QUERIES.filter((query) => clinicalQuestionPatientDetail(query));
    expect(flagged).toEqual([]);
  });

  it("reads capitals, doses and ages in a question as clinical content", () => {
    const flagged = EVERYDAY_QUESTIONS.filter((question) => clinicalQuestionPatientDetail(question));
    expect(flagged).toEqual([]);
  });
});

describe("clinicalQuestionPatientDetail: patient details are held back", () => {
  it.each([
    ["Mr Smith on lithium, level 1.2", "a name"],
    ["Mr John Smith 45 year old on clozapine", "a name"],
    ["SMITH, John lithium level", ""],
    ["Patient Jones has a rising creatinine", "a name"],
    ["pt js 45m on lithium", ""],
    ["UMRN D4678677 clozapine bloods", ""],
    ["bed 12 agitation options", ""],
    ["DOB: 01/02/1960 lithium dose", ""],
    ["call 0412 345 678 about clozapine", ""],
    ["Ms Jones on clozapine", "a name"],
    ["Ms Jones QTc 480 ms on citalopram", "a name"],
    ["pt John Smith lithium", "a name"],
    ["pt js with renal impairment", ""],
    ["Ward 4 Ms Smith clozapine", ""],
    ["2 Ms Jones lithium", ""],
    ["seen at 9 Ms Jones on lithium", ""],
    ["QTc 480 ms Ms Jones citalopram", ""],
  ])("refuses %s", (question, finding) => {
    const problem = clinicalQuestionPatientDetail(question);
    expect(problem).not.toBeNull();
    if (finding) expect(problem!.title).toContain(finding);
  });

  it("keeps refusing when an age sits beside another detail", () => {
    expect(clinicalQuestionPatientDetail("Mrs Brown 82 year old delirium")).not.toBeNull();
    expect(clinicalQuestionPatientDetail("70 year old in bed 4, haloperidol dose")).not.toBeNull();
  });

  it("shares Work's known gap: a bare first and last name with no title is not caught", () => {
    // Recorded, not endorsed: Work's check reads past a bare name too, and the page says the
    // check catches some details, not all. An age beside it no longer stands in for the name.
    expect(clinicalQuestionPatientDetail("John Smith on clozapine")).toBeNull();
  });

  it("never flags empty text", () => {
    expect(clinicalQuestionPatientDetail("   ")).toBeNull();
  });

  it("names the kind of detail and never repeats the matched text", () => {
    const question = "Mr Smith on lithium";
    const message = clinicalQuestionPatientDetailMessage(clinicalQuestionPatientDetail(question)!);
    expect(message).toMatch(/^This question looks like it holds a patient detail \(.+\)\. Remove it and ask again/);
    expect(message).toContain("overseas AI service");
    expect(message).not.toContain("Smith");
  });
});
