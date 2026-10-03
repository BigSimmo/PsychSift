// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OnCallCallLogCard } from "@/components/on-call/handover/call-log";
import { PATIENT_LABEL_EXPIRY_STORAGE_KEY } from "@/lib/patient-label-storage";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function typeNote(value: string) {
  fireEvent.change(screen.getByTestId("on-call-call-log-note"), { target: { value } });
}

describe("OnCallCallLogCard cross-tab clearing", () => {
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
