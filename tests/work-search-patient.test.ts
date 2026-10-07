import { describe, expect, it } from "vitest";

import { looksLikePatientDetails, workSearchGate } from "@/lib/work-search/signals";
import { looksLikePatientDetail } from "@/lib/work-text/patient-detail-check";

/**
 * The patient-detail check behind the amber "Looks like patient details" state
 * in Search my work (work-mode redesign, owner request 6 Oct 2026). Whatever it
 * flags is never looked up, never kept in Recent and is cleared from the box.
 * It leans towards true: a false alarm costs one notice, a miss could put a
 * patient's details into a search screen.
 */

const YEAR = 2026;

describe("looksLikePatientDetails: hospital and record numbers", () => {
  it.each([
    "UR 4471823",
    "ur4471823",
    "UR: 4471823",
    "U/R 4471823",
    "U.R. 447182",
    "URN 12345",
    "urn12345",
    "UMRN 4471023",
    "umrn A1234567",
    "MRN# 99812",
    "mrn: 12345",
    "UR no. 4471823",
    "hospital number 4471823",
    "hospital no 12345",
    "A1234567",
    "b998877",
    "1234567",
    "4471823 bloods",
    "pt 4471823",
    "patient no 12345",
    "patient #44718",
    "2123 45670 1",
    "2123456701",
    "medicare 2123 45670",
    "8003 6012 3456 7890",
  ])("flags %s", (text) => {
    expect(looksLikePatientDetails(text, YEAR)).toBe(true);
  });
});

describe("looksLikePatientDetails: names, ages and beds", () => {
  it.each([
    "Mr Smith",
    "mrs jones review",
    "Miss Taylor",
    "Ms Nguyen",
    "Mx Lee",
    "master brown",
    "Smith, John",
    "SMITH, John",
    "pt smith",
    "bed 12",
    "bed12a",
    "45M",
    "72 F with delirium",
    "80 yo",
    "34 y/o",
    "6 year old",
    "60 years old",
    "aged 64",
  ])("flags %s", (text) => {
    expect(looksLikePatientDetails(text, YEAR)).toBe(true);
  });
});

describe("looksLikePatientDetails: dates of birth", () => {
  it.each([
    "DOB 03/04/1981",
    "dob",
    "d.o.b.",
    "d/o/b 3/4/81",
    "date of birth",
    "born 1981",
    "12/03/1980",
    "3.4.81",
    "1980-03-12",
    "12 March 1980",
    "3 Apr 81",
    "3rd of April, 1981",
    "March 12, 1980",
    "Apr 3 1981",
    "Jane Citizen 3/4/81",
  ])("flags %s", (text) => {
    expect(looksLikePatientDetails(text, YEAR)).toBe(true);
  });
});

describe("looksLikePatientDetails: ordinary work searches stay searchable", () => {
  it.each([
    "leave form",
    "night shift allowance",
    "CPD hours 2026",
    "ward 4",
    "0892241000",
    "9224 1000",
    "13 11 14",
    "ext 4410",
    "pager 4410",
    "12/10/2026",
    "2026-10-12",
    "Wed 7 Oct 08:00",
    "12 Oct 2026",
    "When am I next on nights?",
    "What is due this month?",
    "Am I working tomorrow?",
    "Ms Teams",
    "MS Word template",
    "Dr Moss",
    "pt hours",
    "part time roster",
    "page 4",
    "aged care policy",
    "Melbourne conference",
    "journal club",
    "Basic life support",
    "mask fit",
    "Medical Workforce",
    "PDL 5 days",
    "30 min",
  ])("leaves %s alone", (text) => {
    expect(looksLikePatientDetails(text, YEAR)).toBe(false);
  });

  it("ignores anything under three characters", () => {
    expect(looksLikePatientDetails("UR", YEAR)).toBe(false);
    expect(looksLikePatientDetails("  ", YEAR)).toBe(false);
  });
});

describe("workSearchGate", () => {
  it("never searches or answers patient details, however they are mixed in", () => {
    for (const text of ["UR 4471823", "leave form for Mr Smith", "night shift 45M", "clozapine 4471823"]) {
      expect(workSearchGate(text), text).toEqual({ patient: true, clinical: false, search: false, answer: false });
    }
  });

  it("searches a clinical question in your own records but gives it no work answer", () => {
    expect(workSearchGate("clozapine")).toEqual({ patient: false, clinical: true, search: true, answer: false });
    expect(workSearchGate("lithium level timing")).toMatchObject({ clinical: true, answer: false });
  });

  it("searches and answers ordinary work questions", () => {
    expect(workSearchGate("When am I next on nights?")).toEqual({
      patient: false,
      clinical: false,
      search: true,
      answer: true,
    });
  });

  it("does nothing for an empty box", () => {
    expect(workSearchGate("   ")).toEqual({ patient: false, clinical: false, search: false, answer: false });
  });
});

describe("the search gate reads the shared patient-detail check", () => {
  // Final review (7 Oct 2026): the search used only its own patterns, so look-alike letters, hidden
  // characters, "Patient John" and "bed twelve" were searched and kept in Recent while every note field
  // refused them. The gate now hands the text to the one shared check as well.
  const sharedCatches = [
    "D467 8677",
    "bed twelve",
    "Bed: 12",
    "Cot 3",
    "forty five year old",
    "js 45m",
    "Pt: Smith",
    "Patient John",
    "client Jones",
    "pt js",
    "pt J S",
    "Мr Smith",
    "M​r Smith",
    "Ｍｒｓ Ｓｍｉｔｈ",
    "U​R 4471823",
    "１２３４５６７",
    "Mr.Smith",
    "MrSmith",
    "Jane, 45, ward 3",
    "J o h n",
    "1 2 3 4 5 6 7",
    "J. Smith",
    "Ρt Smith",
  ];

  it.each(sharedCatches)("flags %s in the search, as the shared check does", (text) => {
    expect(looksLikePatientDetail(text), text).toBe(true);
    expect(looksLikePatientDetails(text, YEAR), text).toBe(true);
    expect(workSearchGate(text).search, text).toBe(false);
  });

  it("never lets the search pass what the shared check flags, apart from what a search looks up", () => {
    // Phone, pager and extension numbers (On Call contacts), dates within a few years (the roster) and
    // bare capitals ("AL", "SL") are read past in the search only.
    const lookedUp = [
      "0412 345 678",
      "9224 1000",
      "pager 44101",
      "ext 61234",
      "12/10/2026",
      "12 Oct 2026",
      "AL next week",
    ];
    for (const text of lookedUp) expect(looksLikePatientDetails(text, YEAR), text).toBe(false);
    for (const text of [...sharedCatches, "UR 4471823", "DOB 3/4/81", "12/03/1980", "Mrs Brown bed 4", "JS 45M"]) {
      if (looksLikePatientDetail(text)) expect(looksLikePatientDetails(text, YEAR), text).toBe(true);
    }
  });

  it("still reads a title in capitals as software, not a person", () => {
    expect(looksLikePatientDetails("MS Word template", YEAR)).toBe(false);
    expect(looksLikePatientDetail("MS Word template", { allowCapitals: true })).toBe(false);
  });
});
