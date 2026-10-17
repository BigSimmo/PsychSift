/** @vitest-environment jsdom */

// Admin NHMRC source pilot: the accessibility contract that
// docs/design-system/evidence/admin-source-pilot.json recorded on 14 Oct
// ("Native labels, keyboard traversal and polite status") against an earlier
// pilot-client digest. This pins it to the current client on every change.
// It is not a screen-reader run.

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const listFactors = vi.hoisted(() => vi.fn());
const challenge = vi.hoisted(() => vi.fn());
const verifyCode = vi.hoisted(() => vi.fn());
const getAuthenticatorAssuranceLevel = vi.hoisted(() => vi.fn());
const announce = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/browser-client", () => ({
  browserSupabaseClientFor: () => ({
    auth: { mfa: { listFactors, challenge, verify: verifyCode, getAuthenticatorAssuranceLevel } },
  }),
}));
vi.mock("@/components/ui/live-announcer", () => ({ announce }));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element -- Stand-in for next/image inside jsdom.
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));

import AdminPilot from "@/app/admin/pilot/pilot-client";

const verifiedFactor = {
  data: { totp: [{ id: "factor-synthetic", status: "verified", friendly_name: "Synthetic authenticator" }] },
  error: null,
};

function renderPilot() {
  return render(<AdminPilot url="https://synthetic.example" publishableKey="synthetic-key" />);
}

afterEach(() => {
  cleanup();
  listFactors.mockReset();
  challenge.mockReset();
  verifyCode.mockReset();
  getAuthenticatorAssuranceLevel.mockReset();
  announce.mockReset();
});

describe("admin source pilot accessibility", () => {
  it("gives every control a native accessible name inside labelled sections", async () => {
    listFactors.mockResolvedValue(verifiedFactor);
    renderPilot();

    await screen.findByRole("combobox", { name: /authenticator/i });
    const mfa = within(screen.getByRole("region", { name: /verify your authenticator/i }));
    expect(mfa.getByRole("combobox", { name: /authenticator/i })).toBeTruthy();
    expect(mfa.getByLabelText(/six-digit authenticator code/i)).toBeTruthy();
    expect(mfa.getByRole("button", { name: /verify code/i })).toBeTruthy();

    const upload = within(screen.getByRole("region", { name: /admit one approved pilot source/i }));
    expect(upload.getByRole("combobox", { name: /approved pilot source/i })).toBeTruthy();
    expect(upload.getByLabelText(/reviewed four-page native pdf/i)).toBeTruthy();
    expect(upload.getByRole("checkbox", { name: /operator-approved source authority/i })).toBeTruthy();
    expect(upload.getByRole("button", { name: /admit this pdf/i })).toBeTruthy();
  });

  it("moves keyboard focus through the controls in reading order once verified", async () => {
    listFactors.mockResolvedValue(verifiedFactor);
    challenge.mockResolvedValue({ data: { id: "challenge-synthetic" }, error: null });
    verifyCode.mockResolvedValue({ data: {}, error: null });
    getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal2" }, error: null });
    const user = userEvent.setup();
    renderPilot();
    const code = screen.getByLabelText(/six-digit authenticator code/i);
    await waitFor(() => expect(code).toHaveProperty("disabled", false));

    // Verify first, so the admit button is enabled and must sit in the tab sequence too.
    await user.type(code, "123456");
    await user.click(screen.getByRole("button", { name: /verify code/i }));
    const admit = screen.getByRole("button", { name: /admit this pdf/i });
    await waitFor(() => expect(admit).toHaveProperty("disabled", false));
    (document.activeElement as HTMLElement | null)?.blur();

    const expected = [
      screen.getByRole("combobox", { name: /authenticator/i }),
      code,
      screen.getByRole("button", { name: /verify code/i }),
      screen.getByRole("combobox", { name: /approved pilot source/i }),
      screen.getByLabelText(/reviewed four-page native pdf/i),
      screen.getByRole("checkbox", { name: /operator-approved source authority/i }),
      admit,
    ];
    for (const control of expected) {
      await user.tab();
      expect(document.activeElement).toBe(control);
    }
  });

  it("announces a fail-closed factor read through the shared polite announcer", async () => {
    listFactors.mockResolvedValue({ data: null, error: new Error("synthetic") });
    renderPilot();

    await waitFor(() =>
      expect(announce).toHaveBeenCalledWith("Authenticator factors could not be read. Sign in again."),
    );
    expect(announce.mock.calls[0]).toHaveLength(1);
    expect(screen.getByRole("button", { name: /verify code/i })).toHaveProperty("disabled", true);
  });
});
