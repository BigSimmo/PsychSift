import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The key field on the developer gate screen.
 *
 * The passwordless credential has always existed, but the only way to present
 * it was to hand-edit `?devkey=…` onto a URL — unusable on a phone, which is
 * where the owner actually opens this area. The field submits the typed secret
 * through that same, already-proven exchange in `src/proxy.ts` rather than
 * through a second verification path, so what is asserted here is the wiring:
 * that the field appears only when the deployment has a key, that it produces
 * the exact URL the proxy expects, that it never uses a soft navigation (the
 * cookie rides a redirect response and a soft navigation may not commit it),
 * and that a refused key is reported rather than swallowed.
 */

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  authStatus: "idle" as "idle" | "loading",
  signInWithEmail: vi.fn(async () => undefined),
  signInWithOAuth: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({
    status: mocks.authStatus,
    isConfigured: true,
    notice: null,
    error: null,
    signInWithEmail: mocks.signInWithEmail,
    signInWithOAuth: mocks.signInWithOAuth,
    signOut: mocks.signOut,
  }),
}));

import { DeveloperGateScreen } from "@/components/developer-area/developer-gate-screen";

const KEY = "developer-area-test-key".padEnd(32, "-");

beforeEach(() => {
  // jsdom refuses a real navigation; the assertion is on the URL asked for.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, replace: mocks.replace, assign: vi.fn() },
  });
});

afterEach(() => {
  cleanup();
  mocks.authStatus = "idle";
  vi.clearAllMocks();
});

type ScreenProps = ComponentProps<typeof DeveloperGateScreen>;

function renderScreen(props: Partial<ScreenProps> = {}) {
  return render(
    <DeveloperGateScreen state="unauthenticated" next="/admin/developer-hub" email={null} keyEntryEnabled {...props} />,
  );
}

describe("DeveloperGateScreen key field", () => {
  it("is not offered when the deployment has no developer key configured", () => {
    renderScreen({ keyEntryEnabled: false });

    // A field that cannot possibly succeed is worse than no field: it reads as
    // a forgotten password rather than as a route that was never switched on.
    expect(screen.queryByTestId("developer-gate-key-form")).toBeNull();
    expect(screen.getByTestId("developer-gate-email-submit")).toBeInTheDocument();
  });

  it("submits the typed key as a full-document replace onto the requested page", () => {
    renderScreen({ next: "/admin/developer-hub/ledger" });

    fireEvent.change(screen.getByTestId("developer-gate-key-input"), { target: { value: KEY } });
    fireEvent.click(screen.getByTestId("developer-gate-key-submit"));

    expect(mocks.replace).toHaveBeenCalledTimes(1);
    const target = new URL(mocks.replace.mock.calls[0][0] as string, "https://psychiatry.tools");
    expect(target.pathname).toBe("/admin/developer-hub/ledger");
    expect(target.searchParams.get("devkey")).toBe(KEY);
  });

  it("masks the key and trims incidental whitespace before submitting it", () => {
    renderScreen();
    const input = screen.getByTestId("developer-gate-key-input");
    // A key pasted from a password manager or a message often arrives with a
    // trailing space; rejecting it for that would be indistinguishable from
    // rejecting it for being wrong.
    expect(input).toHaveAttribute("type", "password");

    fireEvent.change(input, { target: { value: `  ${KEY}  ` } });
    fireEvent.click(screen.getByTestId("developer-gate-key-submit"));

    const target = new URL(mocks.replace.mock.calls[0][0] as string, "https://psychiatry.tools");
    expect(target.searchParams.get("devkey")).toBe(KEY);
  });

  it("does not navigate on an empty key", () => {
    renderScreen();

    fireEvent.submit(screen.getByTestId("developer-gate-key-form"));

    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("says so when the proxy refused the previous key, and clears that once it is being corrected", () => {
    renderScreen({ keyRejected: true });

    expect(screen.getByText(/wasn't accepted/i)).toBeInTheDocument();

    // The verdict was about the value that was submitted; it stops applying the
    // moment that value changes.
    fireEvent.change(screen.getByTestId("developer-gate-key-input"), { target: { value: KEY } });
    expect(screen.queryByText(/wasn't accepted/i)).toBeNull();
  });

  it("offers the key to a signed-in account that lacks the administrator claim", () => {
    // The `unauthorized` state used to show a lone "Sign out" button. For the
    // owner signed in on a personal account, the key is the shorter way in.
    renderScreen({ state: "unauthorized", email: "someone@example.com" });

    expect(screen.getByTestId("developer-gate-key-form")).toBeInTheDocument();
    expect(screen.getByTestId("developer-gate-sign-out")).toBeInTheDocument();
  });

  it("stays usable while the Supabase session is still loading", () => {
    // `AuthProvider` sits at status "loading" from mount until its client-side
    // getUser()/getSession() resolves (src/lib/supabase/client.tsx), and on a
    // slow, stalled or unreachable Supabase that is a long time. Sharing the
    // sign-in's busy flag would disable the key field exactly then — disabling
    // the one credential that needs no provider round trip, in the situation it
    // exists to answer.
    mocks.authStatus = "loading";
    renderScreen();

    const submit = screen.getByTestId("developer-gate-key-submit");
    fireEvent.change(screen.getByTestId("developer-gate-key-input"), { target: { value: KEY } });
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);

    expect(mocks.replace).toHaveBeenCalledTimes(1);
    const target = new URL(mocks.replace.mock.calls[0][0] as string, "https://psychiatry.tools");
    expect(target.searchParams.get("devkey")).toBe(KEY);
  });
});
