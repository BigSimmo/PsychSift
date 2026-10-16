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
const announce = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/browser-client", () => ({
  browserSupabaseClientFor: () => ({ auth: { mfa: { listFactors } } }),
}));
vi.mock("@/components/ui/live-announcer", () => ({ announce }));
vi.mock("next/image", () => ({
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
  announce.mockReset();
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
    const user = userEvent.setup();
    renderPilot();
    await waitFor(() =>
      expect(screen.getByLabelText(/six-digit authenticator code/i)).toHaveProperty("disabled", false),
    );

    const expected = [
      screen.getByRole("combobox", { name: /authenticator/i }),
      screen.getByLabelText(/six-digit authenticator code/i),
      screen.getByRole("button", { name: /verify code/i }),
      screen.getByRole("combobox", { name: /approved pilot source/i }),
      screen.getByLabelText(/reviewed four-page native pdf/i),
      screen.getByRole("checkbox", { name: /operator-approved source authority/i }),
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
