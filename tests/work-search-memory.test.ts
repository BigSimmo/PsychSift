import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearedNoticeOwed,
  countAllRecents,
  forgetAllRecents,
  markKeystroke,
  measureKeystrokeToResults,
  measureOpenToFirstResult,
  noteClosing,
  recentsFor,
  rememberQuery,
  resetWorkSearchMemory,
  resumableSearch,
  takeClearedFlag,
  WORK_SEARCH_TIMINGS,
} from "@/lib/work-search/memory";
import { patientClinicalHandOff } from "@/lib/work-search/signals";

/**
 * Every place Search my work keeps anything (privacy fix approved by Josh,
 * 7 Oct 2026): patient details never reach Recent, the last-search memory or a
 * timing, and each write re-runs the check itself.
 */

const PATIENT = [
  "UR 4471823",
  "Mr Smith",
  "dob 3/4/81",
  "Smith, John",
  "72 F with delirium",
  "bed 12",
  // Caught through the shared patient-detail check: a Cyrillic letter, a hidden character, words.
  "\u041Cr Smith",
  "D467\u200B8677",
  "Patient John",
  "bed twelve",
];

beforeEach(() => resetWorkSearchMemory());

describe("recent searches", () => {
  it("keeps ordinary searches, most recent first, at most five", () => {
    for (const query of ["leave", "nights", "cpd", "pager", "forms", "swaps"]) rememberQuery(query, 1);
    expect(recentsFor(1)).toEqual(["swaps", "forms", "pager", "cpd", "nights"]);
    expect(recentsFor(2)).toEqual([]);
  });

  it.each(PATIENT)("refuses %s, whoever calls it", (text) => {
    expect(rememberQuery(text, 1)).toBe(false);
    expect(rememberQuery(`leave form ${text}`, 1)).toBe(false);
    expect(recentsFor(1)).toEqual([]);
  });
});

describe("Privacy's Clear recent searches", () => {
  it("forgets Recent and the unfinished search for every account", () => {
    rememberQuery("leave", 1);
    rememberQuery("nights", 1);
    noteClosing("night shift", 1, false, 1_000);
    expect(countAllRecents()).toBe(2);
    forgetAllRecents();
    expect(countAllRecents()).toBe(0);
    expect(recentsFor(1)).toEqual([]);
    expect(resumableSearch(1, 2_000)).toBe("");
  });
});

describe("the last-search memory", () => {
  it("restores an unfinished search within five minutes, for the same account", () => {
    noteClosing("night shift", 1, false, 1_000);
    expect(resumableSearch(1, 1_000 + 60_000)).toBe("night shift");
    expect(resumableSearch(2, 1_000 + 60_000)).toBe("");
    expect(resumableSearch(1, 1_000 + 5 * 60_000)).toBe("");
  });

  it("keeps nothing after a result was opened", () => {
    noteClosing("night shift", 1, true, 1_000);
    expect(resumableSearch(1, 2_000)).toBe("");
  });

  it.each(PATIENT)("never keeps %s, and owes the Cleared notice instead", (text) => {
    noteClosing(text, 1, false, 1_000);
    expect(resumableSearch(1, 2_000)).toBe("");
    expect(clearedNoticeOwed(1)).toBe(true);
    expect(takeClearedFlag(1)).toBe(true);
    expect(clearedNoticeOwed(1)).toBe(false);
  });
});

describe("timings", () => {
  const names: string[] = [];
  beforeEach(() => {
    names.length = 0;
    const marks = new Set<string>();
    vi.stubGlobal("performance", {
      mark: (name: string) => {
        names.push(name);
        marks.add(name);
      },
      measure: (name: string, from: string) => names.push(`${name}<${from}`),
      getEntriesByName: (name: string, type: string) => (type === "mark" && marks.has(name) ? [{}] : []),
      clearMarks: (name: string) => marks.delete(name),
      clearMeasures: () => undefined,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("records only the fixed names, so typed text has no way in", () => {
    // The functions take no arguments at all: what was typed cannot be passed to them.
    expect([markKeystroke.length, measureKeystrokeToResults.length, measureOpenToFirstResult.length]).toEqual([
      0, 0, 0,
    ]);
    markKeystroke();
    measureKeystrokeToResults();
    performance.mark(WORK_SEARCH_TIMINGS.open);
    measureOpenToFirstResult();
    const allowed = Object.values(WORK_SEARCH_TIMINGS) as string[];
    for (const name of names) {
      for (const part of name.split("<")) expect(allowed).toContain(part);
    }
    expect(names).toContain(`${WORK_SEARCH_TIMINGS.keyToResults}<${WORK_SEARCH_TIMINGS.key}`);
    for (const text of PATIENT) expect(names.join(" ")).not.toContain(text);
  });
});

describe("the clinical hand-off for patient details", () => {
  it("offers clinical search, empty, only when the patient text also asks a clinical question", () => {
    expect(patientClinicalHandOff("clozapine UR 4471823")).toBe("/?mode=answer&focus=1");
    expect(patientClinicalHandOff("lithium level Mr Smith")).toBe("/?mode=answer&focus=1");
    expect(patientClinicalHandOff("UR 4471823")).toBeNull();
    expect(patientClinicalHandOff("clozapine")).toBeNull();
  });
});
