/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEACHING_TERM_TRACKER_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import { setSharedDevice } from "@/lib/alerts/shared-device";
import { sampleTermTracker } from "@/lib/teaching/term-tracker";
import { useTermTrackerStore } from "@/lib/teaching/term-tracker-store";

function Probe() {
  const { state, update } = useTermTrackerStore(null);
  return (
    <button
      type="button"
      onClick={() => update(() => sampleTermTracker("2026-10-06"))}
      data-terms={state?.terms.length ?? 0}
    >
      Save term
    </button>
  );
}

describe("term tracker store when the browser refuses to save", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setSharedDevice(false);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("keeps an edit for this page when storage can be read but not written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    render(<Probe />);
    const button = screen.getByRole("button", { name: "Save term" });
    expect(button.getAttribute("data-terms")).toBe("0");

    fireEvent.click(button);

    expect(window.localStorage.getItem(TEACHING_TERM_TRACKER_STORAGE_KEY)).toBeNull();
    expect(Number(button.getAttribute("data-terms"))).toBeGreaterThan(0);
  });
});
