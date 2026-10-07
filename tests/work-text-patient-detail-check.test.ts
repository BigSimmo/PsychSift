import { describe, expect, it } from "vitest";

import { cpdTextLooksLikePatient, cpdTitleLooksLikePatient } from "@/lib/cme/patient-detail-check";
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
    ["title run into a name", "Mr.Smith"],
    ["title run into a name, Mrs", "Mrs.Jones"],
    ["a bed with a colon", "Bed: 12"],
    ["Cyrillic M in a title", "\u041Cr Smith"],
    ["Cyrillic P in Patient", "\u0420atient John Smith"],
    ["Cyrillic e in Bed", "B\u0435d 12"],
    ["Greek capitals in a title", "\u039C\u03A1 Smith"],
    ["an emoji inside a name", "Mr S\u{1F600}mith"],
    ["a combining mark inside a name", "Mr Sm\u0301ith"],
    ["a variation selector inside a name", "Mr Smi\uFE0Fth"],
    ["an age in words with a hyphen", "forty-five year old man"],
    ["a hyphenated yo with a sex letter", "45-yo M"],
    ["a title and an initial", "Mrs S"],
    ["an international mobile", "+61 412 345 678"],
    ["a UMRN broken by spaces", "D 467 8677"],
    ["a labelled UMRN broken by spaces", "UMRN 123 4567"],
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
    "MS Teams call at 2",
    "Zoë from HR",
    "Night 2100 to 0800, RDO Friday",
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

  it("never offers a safer wording built from a folded copy of what was typed", () => {
    // "½" folds to "1⁄2"; Use this wording must never put that in the doctor's text.
    const folded = checkPatientDetail("JS ½ day");
    expect(folded).not.toBeNull();
    expect(folded?.suggestion).toBeNull();
    expect(checkPatientDetail("JS half day")?.suggestion).toBe("half day");
  });

  it("puts capitals read past back as typed in the safer wording", () => {
    expect(checkPatientDetail("KGH bed 4 tonight", { allowCapitals: true })?.suggestion).toBe("KGH tonight");
  });

  it("folds look-alike characters and drops invisible ones", () => {
    expect(normaliseWorkText("ｂｅｄ​１２")).toBe("bed12");
  });

  describe("round 4: shapes the Teaching review found still passing", () => {
    it.each([
      "MrSmith",
      "Mr-Smith",
      "Mr/Smith",
      "Cot 3",
      "Chair 4",
      "cot: 2",
      "J\u{1F600}o\u{1F600}h\u{1F600}n Smith",
      "J o h n Smith",
      "JS45M",
      "JS 45 M",
      "js 45m",
      "js45f",
      "Jane, 45, ward 3",
      "Saw Jane, 45",
      "SMITH, John",
      "O'BRIEN, Mary",
      "the patient, John, was",
      "9123 4567",
      "6457-1234",
      "record 12 34 567",
      "file no 12 34 567",
      "1 2 3 4 5 6 7",
    ])("catches %s", (text) => {
      expect(looksLikePatientDetail(text)).toBe(true);
    });

    it.each([
      "Smith J",
      "John S.",
      "MET call",
      "RDO",
      "IVF",
      "RPH orientation",
      "MS Teams call",
      "Zoë from HR",
      "MRIs this week",
      "MSc in psychiatry",
      "MasterClass on ECT",
      "in 45m",
      "mtg 30m",
      "Chair 2 sessions",
      "Hi Sarah, 2 things to do",
      "Monday, 12, then Tuesday",
      "URGENT, Please call",
      "Plan A or B",
      "Call 1300 555 123",
      "Shifts 2026 to 2027",
      "The patient was seen",
    ])("passes %s", (text) => {
      expect(looksLikePatientDetail(text)).toBe(false);
    });

    it("still reads a colleague's initial and surname past with allowName", () => {
      expect(looksLikePatientDetail("Dr J Smith lecture", { allowName: true })).toBe(false);
    });

    it("keeps the body honest that it catches some details, not all", () => {
      expect(checkPatientDetail("MrSmith")?.body).toContain("catches some details, not all");
      expect(checkPatientDetail("1 2 3 4 5 6 7")?.body).toContain("catches some details, not all");
    });

    it("never turns an ordinary word into a workplace capital in the safer wording", () => {
      // "It" and "Ed" are ordinary words here, not the IT department or the ED.
      expect(checkPatientDetail("JS said It was Ed")?.suggestion).toBe("said It was Ed");
      expect(checkPatientDetail("JS needs IT and ED")?.suggestion).toBe("needs IT and ED");
    });
  });

  describe("two-letter work capitals", () => {
    it.each(["AI in psychiatry", "OT and PT workshop", "QI project", "QA audit", "NZ and UK training", "EU rules"])(
      "passes %s in the shared check and in CPD",
      (text) => {
        expect(looksLikePatientDetail(text)).toBe(false);
        expect(cpdTextLooksLikePatient(text, 2026)).toBe(false);
        expect(cpdTitleLooksLikePatient(text, 2026)).toBe(false);
      },
    );

    it("still reads two capitals that are a person's initials", () => {
      expect(looksLikePatientDetail("Supervision of JS")).toBe(true);
      expect(cpdTextLooksLikePatient("Supervision of JS", 2026)).toBe(true);
      expect(cpdTitleLooksLikePatient("Supervision of JS", 2026)).toBe(true);
      expect(looksLikePatientDetail("pt OT")).toBe(false);
      expect(looksLikePatientDetail("pt js")).toBe(true);
    });
  });
});
