import { describe, expect, it } from "vitest";

import { clinicalQuestionPatientDetail } from "@/lib/clinical-question-patient-check";
import { checkPatientDetail } from "@/lib/work-text/patient-detail-check";

// Synthetic identifiers only. My Day's quick note keeps Work's stricter check: anything Ask refuses,
// My Day refuses too, and My Day also refuses the shapes Ask deliberately lets through.
const BOTH_REFUSE = [
  "Mrs Smith in bed 12",
  "UMRN D4678677",
  "DOB 01/02/1960",
  "MRN 12345678",
  "call 0412 345 678",
  "Patient John needs review",
];
const ONLY_WORK_REFUSES = ["45 year old male", "JS on ward 4", "pt js review"];

describe("My Day and Ask patient-detail checks", () => {
  it.each(BOTH_REFUSE)("both refuse %j", (text) => {
    expect(clinicalQuestionPatientDetail(text)).not.toBeNull();
    expect(checkPatientDetail(text)).not.toBeNull();
  });
  it.each(ONLY_WORK_REFUSES)("My Day's stricter check still refuses %j", (text) => {
    expect(checkPatientDetail(text)).not.toBeNull();
  });
  it("lets an ordinary reminder through on both", () => {
    expect(clinicalQuestionPatientDetail("Renew ALS before Friday")).toBeNull();
    expect(checkPatientDetail("Renew ALS before Friday")).toBeNull();
  });
});
