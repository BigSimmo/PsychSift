/** @vitest-environment jsdom */

// The recorder notes a psychiatry record the reader opens, by the page's own
// title, and writes nothing while "Save recent searches" is off.

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let pathname = "/dsm/diagnoses/mdd";
let mayRecord = true;
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
let bootstrapReady = true;
vi.mock("@/components/clinical-dashboard/use-app-preferences", () => ({
  mayRecordRecentSearches: () => mayRecord && bootstrapReady,
  useAppPreferences: () => ({ canRecordRecentSearches: mayRecord && bootstrapReady }),
}));

import { PsychiatryVisitRecorder } from "@/components/psychiatry/psychiatry-visit-recorder";
import {
  clearPsychiatryVisits,
  loadPsychiatryVisitState,
  PSYCHIATRY_OPEN_LIMIT,
  psychiatryMonthFigures,
  recordPsychiatryVisit,
} from "@/lib/psychiatry-hub/visits";

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  clearPsychiatryVisits();
  bootstrapReady = true;
  document.title = "Major depressive disorder | DSM-5 Diagnosis | PsychSift";
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PsychiatryVisitRecorder", () => {
  it("records the open once the account preferences have loaded", () => {
    pathname = "/dsm/diagnoses/mdd";
    mayRecord = true;
    bootstrapReady = false;
    const view = render(<PsychiatryVisitRecorder />);
    vi.advanceTimersByTime(500);
    expect(loadPsychiatryVisitState().visits).toEqual([]);
    bootstrapReady = true;
    view.rerender(<PsychiatryVisitRecorder />);
    vi.advanceTimersByTime(500);
    expect(loadPsychiatryVisitState().visits).toMatchObject([{ href: "/dsm/diagnoses/mdd" }]);
  });

  it("records a record page by its title", () => {
    pathname = "/dsm/diagnoses/mdd";
    mayRecord = true;
    render(<PsychiatryVisitRecorder />);
    vi.advanceTimersByTime(500);
    expect(loadPsychiatryVisitState().visits).toMatchObject([
      { href: "/dsm/diagnoses/mdd", title: "Major depressive disorder", kind: "dsm" },
    ]);
  });

  it("writes nothing while Save recent searches is off", () => {
    pathname = "/dsm/diagnoses/mdd";
    mayRecord = false;
    render(<PsychiatryVisitRecorder />);
    vi.advanceTimersByTime(500);
    expect(loadPsychiatryVisitState().visits).toEqual([]);
  });

  it("ignores pages outside the psychiatry sections", () => {
    pathname = "/psychiatry";
    mayRecord = true;
    render(<PsychiatryVisitRecorder />);
    vi.advanceTimersByTime(500);
    expect(loadPsychiatryVisitState().visits).toEqual([]);
  });
});

describe("the on-device store", () => {
  it("keeps the month's total exact beyond the capped list of opens", () => {
    const start = Date.parse("2026-10-01T02:00:00Z");
    const total = PSYCHIATRY_OPEN_LIMIT + 20;
    for (let index = 0; index < total; index += 1) {
      recordPsychiatryVisit({
        href: `/forms/form-${index}`,
        title: `Form ${index}`,
        kind: "forms",
        at: start + index * 10_000,
      });
    }
    const state = loadPsychiatryVisitState(start + total * 10_000);
    expect(state.opens).toHaveLength(PSYCHIATRY_OPEN_LIMIT);
    expect(psychiatryMonthFigures(state.months, start + total * 10_000).thisMonth).toBe(total);
  });
});
