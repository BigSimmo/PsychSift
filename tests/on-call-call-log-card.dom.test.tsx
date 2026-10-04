// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OnCallCallLogCard } from "@/components/on-call/handover/call-log";
import { PATIENT_LABEL_EXPIRY_STORAGE_KEY, writePatientLabels } from "@/lib/patient-label-storage";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.useRealTimers();
});

function typeNote(value: string) {
  fireEvent.change(screen.getByTestId("on-call-call-log-note"), { target: { value } });
}

describe("OnCallCallLogCard cross-tab clearing", () => {
  it("starts the existing expiry window on the first unsaved edit without storing its content", () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-04T00:00:00Z");
    vi.setSystemTime(now);
    render(<OnCallCallLogCard />);
    typeNote("SYNTHETIC unsaved draft");
    const stamp = JSON.parse(window.localStorage.getItem(PATIENT_LABEL_EXPIRY_STORAGE_KEY)!);
    expect(stamp.startedAt).toBe(now.getTime());
    expect(stamp.expiresAt).toBe(now.getTime() + 12 * 60 * 60 * 1000);
    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.getItem(PATIENT_LABEL_EXPIRY_STORAGE_KEY)).not.toContain("SYNTHETIC");
    vi.setSystemTime(now.getTime() + 60 * 60 * 1000);
    typeNote("SYNTHETIC changed draft");
    expect(JSON.parse(window.localStorage.getItem(PATIENT_LABEL_EXPIRY_STORAGE_KEY)!).expiresAt).toBe(stamp.expiresAt);
  });

  it("uses an earlier existing shift end for the first draft without extending it", () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-04T00:00:00Z");
    vi.setSystemTime(now);
    writePatientLabels("fixture", "SYNTHETIC", { shiftEndsAt: now.getTime() + 2 * 60 * 60 * 1000 });
    render(<OnCallCallLogCard />);
    typeNote("SYNTHETIC unsaved draft");
    act(() => vi.advanceTimersByTime(2 * 60 * 60 * 1000));
    expect(screen.getByTestId("on-call-call-log-note")).toHaveValue("");
  });

  it("clears an unsaved first draft at its expiry without a saved label or auth watcher", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
    render(<OnCallCallLogCard />);
    typeNote("SYNTHETIC unsaved draft");
    act(() => vi.advanceTimersByTime(12 * 60 * 60 * 1000));
    expect(screen.getByTestId("on-call-call-log-note")).toHaveValue("");
  });

  it("refuses an expired sleeping-tab draft on submission before its timer can run", () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-04T00:00:00Z");
    vi.setSystemTime(now);
    render(<OnCallCallLogCard />);
    fireEvent.change(screen.getByTestId("on-call-call-log-label"), { target: { value: "JS" } });
    typeNote("SYNTHETIC unsaved draft");
    vi.setSystemTime(now.getTime() + 13 * 60 * 60 * 1000);
    fireEvent.submit(screen.getByTestId("on-call-call-log-form"));
    expect(screen.getByTestId("on-call-call-log-note")).toHaveValue("");
    expect(screen.getByTestId("on-call-call-log-label")).toHaveValue("");
    expect(window.localStorage.length).toBe(1);
    expect(screen.getByText("The shift has ended. This draft was cleared.")).toBeVisible();
  });

  it("clears an expired first draft on wake", () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-04T00:00:00Z");
    vi.setSystemTime(now);
    render(<OnCallCallLogCard />);
    typeNote("SYNTHETIC unsaved draft");
    vi.setSystemTime(now.getTime() + 13 * 60 * 60 * 1000);
    act(() => window.dispatchEvent(new Event("focus")));
    expect(screen.getByTestId("on-call-call-log-note")).toHaveValue("");
  });

  it("drops a half-typed note when another tab clears all storage", () => {
    render(<OnCallCallLogCard />);
    typeNote("URN 1234567 unsettled");
    expect(screen.getByTestId("on-call-call-log-note")).toHaveValue("URN 1234567 unsettled");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(screen.getByTestId("on-call-call-log-note")).toHaveValue("");
  });

  it("drops a half-typed note when another tab removes the shift stamp", () => {
    render(<OnCallCallLogCard />);
    typeNote("half typed");
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: PATIENT_LABEL_EXPIRY_STORAGE_KEY, newValue: null, oldValue: "{}" }),
      );
    });
    expect(screen.getByTestId("on-call-call-log-note")).toHaveValue("");
  });

  it("keeps a draft when an unrelated key changes", () => {
    render(<OnCallCallLogCard />);
    typeNote("keep me");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "other", newValue: null }));
    });
    expect(screen.getByTestId("on-call-call-log-note")).toHaveValue("keep me");
  });
});
