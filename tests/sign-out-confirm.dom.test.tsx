// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SIGN_OUT_CONFIRM_TITLE, useSignOutConfirm } from "@/components/clinical-dashboard/sign-out-confirm";
import { clearPatientLabels, patientLabelsOnDevice, writePatientLabels } from "@/lib/patient-label-storage";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function Harness({ signOut }: { readonly signOut: () => void }) {
  const { requestSignOut, dialog } = useSignOutConfirm(signOut);
  return (
    <>
      <button type="button" onClick={requestSignOut}>
        Sign out
      </button>
      {dialog}
    </>
  );
}

// D26-26: Sign out says what goes only when there is something to lose.
describe("useSignOutConfirm", () => {
  it("signs out at once when the phone holds no patient labels", () => {
    const signOut = vi.fn();
    render(<Harness signOut={signOut} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(SIGN_OUT_CONFIRM_TITLE)).toBeNull();
  });

  it("asks first when this shift's labels are on the phone, and Cancel keeps them", () => {
    writePatientLabels("fixture", "SYNTHETIC Bed 4");
    const signOut = vi.fn();
    render(<Harness signOut={signOut} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByText(SIGN_OUT_CONFIRM_TITLE)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]!);
    expect(signOut).not.toHaveBeenCalled();
    expect(patientLabelsOnDevice()).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("does not count the shift stamp alone, or labels from a finished shift", () => {
    const start = Date.now() - 13 * 60 * 60 * 1000;
    writePatientLabels("fixture", "SYNTHETIC", { now: start });
    expect(patientLabelsOnDevice()).toBe(false);
    writePatientLabels("fixture", "SYNTHETIC");
    clearPatientLabels("manual");
    expect(patientLabelsOnDevice()).toBe(false);
  });
});
