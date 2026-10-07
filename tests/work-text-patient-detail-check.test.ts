import { describe, expect, it } from "vitest";

import { checkPatientDetail, looksLikePatientDetail, normaliseWorkText } from "@/lib/work-text/patient-detail-check";

describe("shared patient-detail check for work free text", () => {
  it.each([
    ["zero-width space between title and name", "Mrs​Smith"],
    ["zero-width space inside a bed number", "bed​12"],
    ["zero-width joiner inside a name", "Mr Sm‍ith"],
    ["soft hyphen and BOM", "﻿Mrs Sm­ith"],
    ["full-width bed number", "ｂｅｄ １２"],
    ["full-width title and name", "Ｍｒｓ Ｓｍｉｔｈ"],
    ["full-width record number", "UR１２３４５６７"],
    ["age and sex in words", "45 year old male"],
    ["age with a bed in words", "45 year old woman in bed twelve"],
    ["age written out", "forty five year old"],
    ["patient and a name", "patient John Smith"],
    ["Pt and a surname", "Pt: Jones"],
    ["initial and surname", "J Smith"],
    ["age and sex shorthand", "45M"],
    ["a room", "Room 4"],
    ["a mobile number", "0412 345 678"],
    ["a mobile number with no spaces", "0412345678"],
    ["a landline", "(08) 9224 1234"],
    ["bare initials", "JS to call back"],
    ["lower-case initials after pt", "pt js 45m"],
    ["spaced initials after pt", "pt J S 45 M"],
    ["lower-case initials after patient", "patient ab review"],
    ["age with a spaced sex letter", "45 M"],
    ["a bare WA UMRN", "D4678677"],
    ["another bare UMRN", "U1234567 seen"],
  ])("catches %s", (_label, text) => {
    expect(checkPatientDetail(text)).not.toBeNull();
    expect(looksLikePatientDetail(text)).toBe(true);
  });

  it.each([
    "MET call",
    "RPH orientation",
    "Fiona Stanley Hospital (FSH)",
    "Copy of contract on my USB",
    "Ask about PD leave",
    "Night shift 2100 to 0800",
    "Patient Safety week",
    "Dr Lowe is on instead",
    "SHO",
    "visa condition review",
    "patient was seen",
    "Pt is on the ward",
    "js", // lower case is read as initials only after a patient word
    "RDO",
    "IVF leave",
    "Ask about OSCE dates",
    "ECT list",
    "RANZCP exam",
    "",
    "   ",
  ])("lets ordinary work text through: %j", (text) => {
    expect(checkPatientDetail(text)).toBeNull();
  });

  it("lets common course and leave capitals through with allowCapitals", () => {
    for (const text of ["RDO", "IVF", "OSCE", "ECT", "RANZCP", "RDO on Friday, IVF leave, OSCE and RANZCP"])
      expect(checkPatientDetail(text, { allowCapitals: true })).toBeNull();
    // Capitals read past are still initials after a patient word.
    expect(checkPatientDetail("Pt JS", { allowCapitals: true })).not.toBeNull();
  });

  it("reads past hospital capitals only when the field allows them", () => {
    expect(checkPatientDetail("Ward at KGH")).not.toBeNull();
    expect(checkPatientDetail("Ward at KGH", { allowCapitals: true })).toBeNull();
    // Dotted initials still count with allowCapitals.
    expect(checkPatientDetail("J.S. called", { allowCapitals: true })).not.toBeNull();
  });

  it("allows a colleague's initial and surname only with allowName, never a patient label", () => {
    expect(checkPatientDetail("Ask J Smith", { allowName: true })).toBeNull();
    expect(checkPatientDetail("patient John Smith", { allowName: true })).not.toBeNull();
    expect(checkPatientDetail("Mrs Smith", { allowName: true })).not.toBeNull();
  });

  it("keeps the workplace capitals in the safer wording", () => {
    const problem = checkPatientDetail("JS needs RPH letter");
    expect(problem?.title).toBe("This looks like initials");
    expect(problem?.suggestion).toBe("needs RPH letter");
  });

  it("folds look-alike characters and drops invisible ones", () => {
    expect(normaliseWorkText("ｂｅｄ​１２")).toBe("bed12");
  });
});
