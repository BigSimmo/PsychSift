/** @vitest-environment jsdom */

// The recorder notes a psychiatry record the reader opens, by the page's own
// title, and writes nothing while "Save recent searches" is off.

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let pathname = "/dsm/diagnoses/mdd";
let mayRecord = true;
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/components/clinical-dashboard/use-app-preferences", () => ({ mayRecordRecentSearches: () => mayRecord }));

import { PsychiatryVisitRecorder } from "@/components/psychiatry/psychiatry-visit-recorder";
import { clearPsychiatryVisits, loadPsychiatryVisitState } from "@/lib/psychiatry-hub/visits";

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  clearPsychiatryVisits();
  document.title = "Major depressive disorder | DSM-5 Diagnosis | PsychSift";
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PsychiatryVisitRecorder", () => {
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
