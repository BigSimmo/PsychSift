// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ signedOutWorkHeld: true, resolveSignedOutWork: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));

import { SIGNED_OUT_WORK_TITLE, SignedOutWorkPrompt } from "@/components/front-door/signed-out-work-prompt";

afterEach(() => {
  cleanup();
  auth.resolveSignedOutWork.mockReset();
});

// D26-02: the sign-in question about work made on this phone while signed out.
describe("SignedOutWorkPrompt", () => {
  it("clears only on the deliberate Clear them", () => {
    render(<SignedOutWorkPrompt />);
    expect(screen.getByText(SIGNED_OUT_WORK_TITLE)).toBeTruthy();
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    expect(auth.resolveSignedOutWork).toHaveBeenCalledWith(false);
  });

  it("keeps the work when the sheet is answered with Keep", () => {
    render(<SignedOutWorkPrompt />);
    fireEvent.click(screen.getAllByRole("button", { name: "Keep with my account" })[0]!);
    expect(auth.resolveSignedOutWork).toHaveBeenCalledWith(true);
  });
});
