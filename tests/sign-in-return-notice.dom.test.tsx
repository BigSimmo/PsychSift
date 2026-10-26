/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SIGN_IN_RETURN_TITLE, SignInReturnNotice } from "@/components/front-door/sign-in-return-notice";
import { ToastProvider } from "@/components/ui/toast";

// Sign-in stress test, 26 Oct 2026: an email link opened in a different browser (a phone's email
// app often uses its own) landed on the sign-in card with no word about why. The reason now shows
// on the page it landed on.
let state: { signInReturnError: string | null; status: string } = { signInReturnError: null, status: "signed_out" };
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => state }));

afterEach(() => {
  cleanup();
  state = { signInReturnError: null, status: "signed_out" };
});

const view = () => (
  <ToastProvider>
    <SignInReturnNotice />
  </ToastProvider>
);

describe("sign-in return notice", () => {
  it("says nothing when the page was not opened by a failed sign-in", () => {
    render(view());
    expect(screen.queryByText(SIGN_IN_RETURN_TITLE)).toBeNull();
  });

  it("says once why the link did not sign the reader in", () => {
    state = { signInReturnError: "That sign-in link has expired.", status: "signed_out" };
    const rendered = render(view());
    expect(screen.getByText(SIGN_IN_RETURN_TITLE)).toBeTruthy();
    act(() => rendered.rerender(view()));
    expect(screen.getAllByText("That sign-in link has expired.")).toHaveLength(1);
  });

  it("takes the notice down once sign-in works", () => {
    state = { signInReturnError: "That sign-in link has expired.", status: "signed_out" };
    const rendered = render(view());
    expect(screen.getByText("That sign-in link has expired.")).toBeTruthy();
    state = { ...state, status: "authenticated" };
    act(() => rendered.rerender(view()));
    expect(screen.queryByText("That sign-in link has expired.")).toBeNull();
  });
});
