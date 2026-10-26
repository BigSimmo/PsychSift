import { describe, expect, it } from "vitest";

import { clinicalQuestionPatientDetail } from "@/lib/clinical-question-patient-check";

import {
  corpusClinical,
  corpusIdentifiers,
  holdoutClinical,
  holdoutIdentifiers,
} from "./fixtures/patient-detail-corpus";

/**
 * Floors for the Clinical question check on the synthetic corpus (privacy audit PD-01 and PD-02,
 * 2026-10-26). Before the check was widened it caught 149 of 214 identifiers and held back 7 of
 * 158 ordinary questions; on the held-out set it caught 0 of 36 and held back 11 of 36. A change
 * that lowers recall or adds a false refusal fails here.
 */
function flagged(set: Record<string, string[]>): { caught: string[]; passed: string[] } {
  const all = Object.values(set).flat();
  return {
    caught: all.filter((text) => clinicalQuestionPatientDetail(text) !== null),
    passed: all.filter((text) => clinicalQuestionPatientDetail(text) === null),
  };
}

describe("patient-detail check on the synthetic corpus", () => {
  it("catches at least 187 of the 214 audit identifiers", () => {
    const { caught, passed } = flagged(corpusIdentifiers);
    expect(caught.length + passed.length).toBe(214);
    expect(caught.length).toBeGreaterThanOrEqual(187);
  });

  it("refuses none of the 158 ordinary audit questions", () => {
    const { caught, passed } = flagged(corpusClinical);
    expect(caught.length + passed.length).toBe(158);
    expect(caught).toEqual([]);
  });

  it("catches at least 35 of the 36 held-out names", () => {
    const { caught, passed } = flagged(holdoutIdentifiers);
    expect(caught.length + passed.length).toBe(36);
    expect(caught.length).toBeGreaterThanOrEqual(35);
  });

  it("refuses at most one of the 36 held-out ordinary questions", () => {
    const { caught } = flagged(holdoutClinical);
    // "Ken Kesey One Flew Over" is the known false refusal: Ken is a listed given name.
    expect(caught.length).toBeLessThanOrEqual(1);
  });
});
