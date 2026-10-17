/** @vitest-environment jsdom */

// Admin NHMRC source pilot: the accessibility contract that
// docs/design-system/evidence/admin-source-pilot.json recorded on 14 Oct
// ("Native labels, keyboard traversal and polite status") against an earlier
// pilot-client digest. This pins it to the current client on every change.
// It is not a screen-reader run.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const listFactors = vi.hoisted(() => vi.fn());
const challenge = vi.hoisted(() => vi.fn());
const verify = vi.hoisted(() => vi.fn());
const getAuthenticatorAssuranceLevel = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/browser-client", () => ({
  browserSupabaseClientFor: () => ({
    auth: { mfa: { listFactors, challenge, verify, getAuthenticatorAssuranceLevel } },
  }),
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element -- Stand-in for next/image inside jsdom.
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));

import AdminPilot from "@/app/admin/pilot/pilot-client";
import { LiveAnnouncer, resetAnnouncerForTests } from "@/components/ui/live-announcer";

const verifiedFactor = {
  data: { totp: [{ id: "factor-synthetic", status: "verified", friendly_name: "Synthetic authenticator" }] },
  error: null,
};

function renderPilot() {
  return render(
    <>
      <AdminPilot url="https://synthetic.example" publishableKey="synthetic-key" />
      <LiveAnnouncer />
    </>,
  );
}

afterEach(() => {
  cleanup();
  resetAnnouncerForTests();
  listFactors.mockReset();
  challenge.mockReset();
  verify.mockReset();
  getAuthenticatorAssuranceLevel.mockReset();
});

describe("admin source pilot accessibility", () => {
  it("gives every control a native accessible name inside labelled sections", async () => {
    listFactors.mockResolvedValue(verifiedFactor);
    renderPilot();

    await screen.findByRole("combobox", { name: /authenticator/i });
    expect(screen.getByRole("region", { name: /verify your authenticator/i })).toBeTruthy();
    expect(screen.getByRole("region", { name: /admit one approved pilot source/i })).toBeTruthy();
    expect(screen.getByLabelText(/six-digit authenticator code/i)).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /approved pilot source/i })).toBeTruthy();
    expect(screen.getByLabelText(/reviewed four-page native pdf/i)).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /operator-approved source authority/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /verify code/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /admit this pdf/i })).toBeTruthy();
  });

  it("moves keyboard focus through the controls in reading order", async () => {
    listFactors.mockResolvedValue(verifiedFactor);
    challenge.mockResolvedValue({ data: { id: "challenge-synthetic" }, error: null });
    verify.mockResolvedValue({ error: null });
    getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal2" }, error: null });
    const user = userEvent.setup();
    renderPilot();
    await waitFor(() =>
      expect(screen.getByLabelText(/six-digit authenticator code/i)).toHaveProperty("disabled", false),
    );
    await user.type(screen.getByLabelText(/six-digit authenticator code/i), "123456");
    await user.click(screen.getByRole("button", { name: /verify code/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /admit this pdf/i })).toHaveProperty("disabled", false),
    );
    document.body.focus();

    const expected = [
      screen.getByRole("combobox", { name: /authenticator/i }),
      screen.getByLabelText(/six-digit authenticator code/i),
      screen.getByRole("button", { name: /verify code/i }),
      screen.getByRole("combobox", { name: /approved pilot source/i }),
      screen.getByLabelText(/reviewed four-page native pdf/i),
      screen.getByRole("checkbox", { name: /operator-approved source authority/i }),
      screen.getByRole("button", { name: /admit this pdf/i }),
    ];
    for (const control of expected) {
      await user.tab();
      expect(document.activeElement).toBe(control);
    }
  });

  it("covers the no-factor enrollment control and its keyboard position", async () => {
    listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
    const user = userEvent.setup();
    renderPilot();

    const setup = await screen.findByRole("button", { name: /set up an authenticator/i });
    expect(setup).toHaveProperty("disabled", false);
    document.body.focus();
    await user.tab();
    expect(document.activeElement).toBe(setup);
  });

  it("updates the file label and submit name for a TXT source", async () => {
    listFactors.mockResolvedValue(verifiedFactor);
    const user = userEvent.setup();
    renderPilot();

    await screen.findByRole("combobox", { name: /approved pilot source/i });
    await user.selectOptions(screen.getByRole("combobox", { name: /approved pilot source/i }), "txt");
    expect(screen.getByLabelText(/approved summary txt/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /admit this txt/i })).toBeTruthy();
  });

  it("renders a fail-closed factor read in the shared polite live region", async () => {
    listFactors.mockResolvedValue({ data: null, error: new Error("synthetic") });
    renderPilot();

    const politeRegion = await screen.findByTestId("live-announcer-polite");
    expect(politeRegion).toHaveAttribute("aria-live", "polite");
    await waitFor(() =>
      expect(politeRegion).toHaveTextContent("Authenticator factors could not be read. Sign in again."),
    );
    expect(screen.getByRole("button", { name: /verify code/i })).toHaveProperty("disabled", true);
  });
});
