import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BARE_NAME_GIVEN_NAMES, BARE_NAME_SURNAMES } from "@/lib/clinical-question-bare-name";
import {
  clinicalQuestionPatientDetail,
  clinicalQuestionPatientDetailMessage,
} from "@/lib/clinical-question-patient-check";
import { medicationEntitiesInText } from "@/lib/medication-entities";

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
  // Owner decision 13 Oct 2026: lowercase ms before a capitalised term is a reading, not a title.
  "QTc 480 ms ECG monitoring",
  "QRS 120 ms TCA overdose",
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
    ["bed 12 male agitation options", ""],
    ["Room 4 female on clozapine", ""],
    ["Bed: 12 male agitation", ""],
    ["Bed #12 male agitation", ""],
    ["rm 4 female clozapine", ""],
    ["cubicle 2 male agitation", ""],
    ["chair 3 female agitation", ""],
    ["bed  12 male agitation", ""],
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

  it("holds back a bare first and last name with no title (owner decision, 25 Oct 2026)", () => {
    // Work's check reads past a bare name; the Clinical question check no longer does.
    expect(clinicalQuestionPatientDetail("John Smith on clozapine")?.title).toBe("This looks like a name");
  });

  it("keeps a place number that looks like a millisecond reading (bed 4 ms smith)", () => {
    for (const question of [
      "bed 4 ms smith clozapine",
      "ward 4 ms jones lithium",
      "Bed: 12 ms Smith",
      "BED 4 ms smith clozapine",
      "RM 4 ms smith clozapine",
      "CHAIR 3 ms jones lithium",
    ]) {
      expect(clinicalQuestionPatientDetail(question), question).not.toBeNull();
    }
    expect(clinicalQuestionPatientDetail("QTc 480 ms ECG monitoring")).toBeNull();
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

/**
 * Owner decision, 25 Oct 2026: a bare first and last name and a street address are held back
 * too, with eponyms, medicines and capitalised clinical terms left alone.
 */
describe("clinicalQuestionPatientDetail: bare names and street addresses", () => {
  it.each([
    ["lithium dose for John Smith", "a name"],
    ["Sarah Jones lithium level 1.4 what next", "a name"],
    ["lithium toxicity in jane doe", "a name"],
    ["SARAH JONES lithium level", "a name"],
    ["Can Emily Nguyen take clozapine with valproate", "a name"],
    ["olanzapine for Michael O'Brien", "a name"],
    ["sertraline dose for Fiona McDonald", "a name"],
    ["John Smith's lithium level", "a name"],
    ["Sar​ah Jones lithium level", "a name"],
    ["lithium toxicity 8 Smith St Perth", "an address"],
    ["clozapine review, lives at 12/4 Ocean View Drive", "an address"],
    ["8 smith street lithium level", "an address"],
    ["42 Albany Hwy agitation", "an address"],
  ])("refuses %s", (question, finding) => {
    const problem = clinicalQuestionPatientDetail(question);
    expect(problem, question).not.toBeNull();
    expect(problem!.title).toContain(finding);
  });

  it("keeps the existing refusal wording, naming the kind of detail and never the name", () => {
    const message = clinicalQuestionPatientDetailMessage(clinicalQuestionPatientDetail("Sarah Jones lithium level")!);
    expect(message).toBe(
      "This question looks like it holds a patient detail (a name). Remove it and ask again: questions are sent to an overseas AI service. This check catches some details, not all.",
    );
    expect(message).not.toContain("Jones");
  });

  it.each([
    // Capitalised clinical pairs start with no given name.
    "Lithium Toxicity",
    "Bipolar Disorder management",
    "Clozapine Monitoring Guidelines",
    "Mental Health Act Form 1A",
    "Serotonin Syndrome vs NMS",
    "Treatment Resistant Depression",
    "Borderline Personality Disorder DBT",
    // Eponyms (owner's list), with and without the person's given name.
    "Asperger syndrome in adults",
    "Hans Asperger",
    "Tourette syndrome aripiprazole",
    "Korsakoff syndrome thiamine",
    "Wernicke encephalopathy thiamine dose",
    "Wernicke Korsakoff syndrome",
    "Capgras delusion",
    "Munchausen syndrome by proxy",
    "Lewy Body Dementia antipsychotics",
    "Huntington disease chorea",
    "Parkinson disease psychosis quetiapine",
    "Alzheimer disease donepezil",
    "Cotard delusion",
    "De Clerambault syndrome",
    "Ekbom syndrome",
    "Charles Bonnet syndrome",
    "Fregoli delusion",
    // People and places a question names.
    "Aaron Beck cognitive model",
    "Fiona Stanley Hospital ED",
    "Sir Charles Gairdner Hospital",
    "King Edward Memorial Hospital perinatal",
    "Princess Margaret Hospital",
    "Alma Street Centre referral",
    "Kimberley Adult Mental Health Service",
    "St Vincent de Paul Society",
    "St John's wort and sertraline",
    "300 mg St John's Wort interaction",
    "Bradley et al. 2007 thresholds",
    // Numbers before capitalised words that are not streets.
    "every 4 Hours Close observation",
    "Na 130 Cl 95",
    "QTc 480 ms Monitoring",
    // A given name with no surname is not a bare full name.
    "Emily lithium",
  ])("reads %s as safe", (question) => {
    expect(clinicalQuestionPatientDetail(question)).toBeNull();
  });

  it("starts no name with a medicine in the medication lexicon", () => {
    const medicines = [...BARE_NAME_GIVEN_NAMES, ...BARE_NAME_SURNAMES].filter(
      (name) => medicationEntitiesInText(name).length > 0,
    );
    expect(medicines).toEqual([]);
  });

  it("reads a medicine written after a capitalised word as clinical content", () => {
    for (const question of ["Starting Clozapine", "Switching Sertraline to Fluoxetine", "Lithium Carbonate dose"]) {
      expect(clinicalQuestionPatientDetail(question), question).toBeNull();
    }
  });
});

// Privacy audit PD-01 and PD-02 (2026-10-26). Every name, number and date here is invented.
describe("clinicalQuestionPatientDetail: wider names (PD-01)", () => {
  it.each([
    // Given names beyond the English list.
    "Minh Pham lithium level",
    "Arjun Patel olanzapine weight",
    "Ngozi Okafor clozapine",
    "Aroha Ngata risk assessment",
    "Kirra Hill depot overdue",
    "Fatima Haddad postpartum",
    "Mary Walker lithium",
    "mary walker lithium",
    // A listed surname on either side, including surname first.
    "Nguyen Thi Lan clozapine",
    "Chen Wei olanzapine",
    "Xiaoling Chen lithium",
    // A surname then a given name.
    "Testpatient Jane clozapine",
    // A given name in a shape that holds only a person.
    "Jane T. olanzapine",
    "Jane (Testpatient) lithium",
    "Jane's lithium is 1.4",
    // Senior titles and a lower-case title with one letter.
    "Prof Testpatient lithium",
    "Sr Testpatient clozapine",
    "mrs t on lithium",
  ])("refuses %s", (question) => {
    const problem = clinicalQuestionPatientDetail(question);
    expect(problem, question).not.toBeNull();
    expect(problem!.title).toContain("a name");
  });

  it.each([
    "Mary Jane cannabis slang",
    "Sally Anne test theory of mind",
    "John Cade lithium discovery",
    "Lee Silverman voice treatment",
    "Miller Fisher syndrome",
    "Marsha Linehan DBT",
    "Kurt Schneider first rank symptoms",
    "Royal Alexandra Hospital",
    "Wilson disease copper psychosis",
    "Williams syndrome anxiety",
    "Young Mania Rating Scale",
    "Hamilton Depression Rating Scale",
    "Smith-Magenis syndrome behaviour",
    "Stevens-Johnson syndrome lamotrigine",
    "Edwards Syndrome",
    "Chen et al. 2019 meta-analysis",
    "Can Clozapine Cause Myocarditis",
    "What Is The Starting Dose Of Lithium",
    "QTc 480 ms a concern",
    "Prof Kraepelin dementia praecox",
  ])("reads %s as safe", (question) => {
    expect(clinicalQuestionPatientDetail(question)).toBeNull();
  });
});

describe("clinicalQuestionPatientDetail: public numbers and document dates (PD-02)", () => {
  it.each([
    "Mental Health Emergency Response Line 1300 555 788",
    "Kids Helpline 1800 55 1800",
    "Lifeline 13 11 14",
    "clozapine protocol updated 01/03/2024",
    "Chief Psychiatrist guideline 15/06/2023",
    "clozapine guideline version 2.1 dated 03/04/2025",
    "lithium policy reviewed 12/08/2022",
  ])("reads %s as safe", (question) => {
    expect(clinicalQuestionPatientDetail(question)).toBeNull();
  });

  it.each([
    "call her on 0412 345 678 about lithium",
    "landline 08 9123 4567 clozapine",
    "protocol DOB 01/02/1990 lithium",
    "guideline born 01/02/1990",
    "DOB: 01/02/1990 lithium",
    "seen 01/02/2024 lithium level",
    // Review findings on PR #3834: service-number digits as a labelled record number or an email,
    // and a visit verb with no document word.
    "lithium MRN: 1300555788",
    "1300555788@example.com clozapine",
    "patient reviewed 01/02/1990",
    "reviewed patient 01/02/1990 lithium",
    "updated 01/02/1990 lithium",
    "guideline reviewed patient 01/02/1990",
  ])("still refuses %s", (question) => {
    expect(clinicalQuestionPatientDetail(question), question).not.toBeNull();
  });
});
