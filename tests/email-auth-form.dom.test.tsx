/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  status: "signed_out",
  isConfigured: true,
  error: null,
  notice: null,
  signInWithEmail: vi.fn(),
  signInWithPassword: vi.fn(),
  signUpWithPassword: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));

import { EmailAuthForm } from "@/components/clinical-dashboard/email-auth-form";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  auth.status = "signed_out";
});

describe("email authentication form", () => {
  it("signs in with a password and clears the password afterwards", async () => {
    const user = userEvent.setup();
    render(<EmailAuthForm />);
    await user.type(screen.getByLabelText(/Email address/), "person@example.com");
    await user.type(screen.getByLabelText(/^Password/), "existing-passphrase");
    await user.click(screen.getByRole("button", { name: "Sign in with email" }));
    expect(auth.signInWithPassword).toHaveBeenCalledWith("person@example.com", "existing-passphrase");
    expect(screen.getByLabelText(/^Password/)).toHaveValue("");
    expect(auth.signInWithEmail).not.toHaveBeenCalled();
  });

  it("requires matching passwords before creating an account", async () => {
    const user = userEvent.setup();
    render(<EmailAuthForm />);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await user.type(screen.getByLabelText(/Email address/), "person@example.com");
    await user.type(screen.getByLabelText(/^Password/), "new-passphrase-one");
    await user.type(screen.getByLabelText(/Confirm password/), "new-passphrase-two");
    await user.click(screen.getByRole("button", { name: "Create account with email" }));
    expect(auth.signUpWithPassword).not.toHaveBeenCalled();
    expect(screen.getByText("The passwords do not match.")).toBeVisible();
    await user.clear(screen.getByLabelText(/Confirm password/));
    await user.type(screen.getByLabelText(/Confirm password/), "new-passphrase-one");
    await user.click(screen.getByRole("button", { name: "Create account with email" }));
    expect(auth.signUpWithPassword).toHaveBeenCalledWith("person@example.com", "new-passphrase-one");
  });

  it("links the Terms and the privacy notice beside account creation (PD-03)", async () => {
    const user = userEvent.setup();
    render(<EmailAuthForm />);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    const note = screen.getByTestId("email-auth-terms-note");
    expect(note.querySelector('a[href="/terms"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "privacy notice" })).toHaveAttribute("href", "/privacy");
  });

  it("keeps email links and password recovery available", async () => {
    const user = userEvent.setup();
    render(<EmailAuthForm />);
    await user.click(screen.getByRole("button", { name: "Email link" }));
    expect(screen.queryByLabelText(/^Password/)).toBeNull();
    await user.type(screen.getByLabelText(/Email address/), "person@example.com");
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }));
    expect(auth.signInWithEmail).toHaveBeenCalledWith("person@example.com");
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/auth/reset-password");
  });
});
