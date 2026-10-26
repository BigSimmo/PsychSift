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
import { REMEMBERED_EMAIL_KEY } from "@/lib/remembered-email";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  auth.status = "signed_out";
  window.localStorage.clear();
});

describe("email authentication form", () => {
  it("signs in with a password and clears the password afterwards", async () => {
    const user = userEvent.setup();
    render(<EmailAuthForm />);
    await user.type(screen.getByLabelText(/Email address/), "person@example.com");
    await user.type(screen.getByLabelText(/^Password/), "existing-passphrase");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(auth.signInWithPassword).toHaveBeenCalledWith("person@example.com", "existing-passphrase");
    expect(screen.getByLabelText(/^Password/)).toHaveValue("");
    expect(auth.signInWithEmail).not.toHaveBeenCalled();
  });

  it("requires matching passwords before creating an account", async () => {
    const user = userEvent.setup();
    render(<EmailAuthForm />);
    await user.click(screen.getByRole("radio", { name: "Create account" }));
    await user.type(screen.getByLabelText(/Email address/), "person@example.com");
    await user.type(screen.getByLabelText(/^Create a password/), "new-passphrase-one");
    await user.type(screen.getByLabelText(/Confirm password/), "new-passphrase-two");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(auth.signUpWithPassword).not.toHaveBeenCalled();
    expect(screen.getByText("The passwords do not match.")).toBeVisible();
    await user.clear(screen.getByLabelText(/Confirm password/));
    await user.type(screen.getByLabelText(/Confirm password/), "new-passphrase-one");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(auth.signUpWithPassword).toHaveBeenCalledWith("person@example.com", "new-passphrase-one");
  });

  it("links the Terms and the privacy notice beside account creation (PD-03)", async () => {
    const user = userEvent.setup();
    render(<EmailAuthForm />);
    await user.click(screen.getByRole("radio", { name: "Create account" }));
    const note = screen.getByTestId("email-auth-terms-note");
    expect(note.querySelector('a[href="/terms"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "privacy notice" })).toHaveAttribute("href", "/privacy");
  });

  it("keeps email links and password recovery available", async () => {
    const user = userEvent.setup();
    render(<EmailAuthForm />);
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/auth/reset-password");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link instead" }));
    expect(screen.queryByLabelText(/^Password/)).toBeNull();
    await user.type(screen.getByLabelText(/Email address/), "person@example.com");
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }));
    expect(auth.signInWithEmail).toHaveBeenCalledWith("person@example.com");
    await user.click(screen.getByRole("button", { name: "Sign in with a password instead" }));
    expect(screen.getByLabelText(/^Password/)).toBeVisible();
  });

  it("shows sign in and create account as one clear switch", async () => {
    const user = userEvent.setup();
    render(<EmailAuthForm />);
    expect(screen.getByRole("radio", { name: "Sign in" })).toBeChecked();
    expect(screen.queryByLabelText(/Confirm password/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    expect(screen.getByRole("radio", { name: "Create account" })).toBeChecked();
    expect(screen.getByLabelText(/Confirm password/)).toBeVisible();
    // Password recovery belongs to signing in, not to a new account.
    expect(screen.queryByRole("link", { name: "Forgot password?" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Sign in instead" }));
    expect(screen.getByRole("radio", { name: "Sign in" })).toBeChecked();
  });

  it("explains a missing field instead of submitting", async () => {
    const user = userEvent.setup();
    render(<EmailAuthForm />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your email address.")).toBeVisible();
    await user.type(screen.getByLabelText(/Email address/), "person@example.com");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your password.")).toBeVisible();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("shows and hides the password on request", async () => {
    const user = userEvent.setup();
    render(<EmailAuthForm />);
    const field = screen.getByLabelText(/^Password/);
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(field).toHaveAttribute("type", "password");
    await user.click(toggle);
    expect(field).toHaveAttribute("type", "text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("remembers only the email address on this device, and forgets it when unticked", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<EmailAuthForm />);
    expect(screen.getByRole("checkbox", { name: "Remember my email on this device" })).toBeChecked();
    await user.type(screen.getByLabelText(/Email address/), "person@example.com");
    await user.type(screen.getByLabelText(/^Password/), "existing-passphrase");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(window.localStorage.getItem(REMEMBERED_EMAIL_KEY)).toBe("person@example.com");
    expect(JSON.stringify({ ...window.localStorage })).not.toContain("existing-passphrase");
    unmount();

    render(<EmailAuthForm />);
    expect(await screen.findByDisplayValue("person@example.com")).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "Remember my email on this device" }));
    expect(window.localStorage.getItem(REMEMBERED_EMAIL_KEY)).toBeNull();
  });
});
