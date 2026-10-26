/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ signInWithOAuth: vi.fn(), signInWithPassword: vi.fn(), signOut: vi.fn() }));
// A synthetic signed-in session, and the auth listener, for the tests where a session ends.
const authState = vi.hoisted(() => ({
  session: null as { user: { id: string }; access_token: string } | null,
  listeners: [] as Array<(event: string, session: unknown) => void>,
}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: authState.session?.user ?? null }, error: null }),
      getSession: async () => ({ data: { session: authState.session }, error: null }),
      onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
        authState.listeners.push(listener);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      ...api,
    },
  }),
}));

import { AuthProvider, useAuthSession } from "@/lib/supabase/client";
import { patientLabelsOnDevice, writePatientLabels } from "@/lib/patient-label-storage";

function Probe() {
  const auth = useAuthSession();
  return (
    <>
      <p>{auth.status}</p>
      {auth.error && <p role="alert">{auth.error}</p>}
      <button type="button" onClick={() => void auth.signInWithOAuth("azure")}>
        Microsoft
      </button>
      <button type="button" onClick={() => void auth.signInWithOAuth("google")}>
        Google
      </button>
      <button type="button" onClick={() => void auth.signInWithPassword("person@example.com", "passphrase")}>
        Password
      </button>
      <button type="button" onClick={() => auth.markSessionExpired()}>
        Expire
      </button>
      <button type="button" onClick={() => void auth.signOut()}>
        Sign out
      </button>
      <p data-testid="cleared">{auth.deviceDataClearedAt ? "cleared" : "kept"}</p>
      <p data-testid="held">{auth.signedOutWorkHeld ? "held" : "not held"}</p>
      <button type="button" onClick={() => auth.resolveSignedOutWork?.(false)}>
        Clear held
      </button>
      <button type="button" onClick={() => auth.resolveSignedOutWork?.(true)}>
        Keep held
      </button>
    </>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sjrfecxgysukkwxsowpy.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_offline_test");
  api.signInWithOAuth.mockResolvedValue({ error: null });
});
afterEach(() => {
  cleanup();
  authState.session = null;
  authState.listeners = [];
  vi.unstubAllEnvs();
  window.history.replaceState({}, "", "/");
});

describe("provider login requests", () => {
  it("clears provider diagnostics and retains safe feedback through Strict Mode", async () => {
    window.history.replaceState(
      {},
      "",
      "/?mode=documents#error=server_error&error_code=unexpected_failure&error_description=private%2525diagnostic",
    );
    render(
      <StrictMode>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </StrictMode>,
    );
    await screen.findByText("signed_out");
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in could not be completed. Please try again.");
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?mode=documents");
    expect(screen.queryByText(/private/)).toBeNull();
  });

  it.each(["Microsoft", "Google"])("requests only the required scope for %s", async (name) => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("signed_out");
    await user.click(screen.getByRole("button", { name }));
    expect(api.signInWithOAuth).toHaveBeenCalledWith({
      provider: name === "Microsoft" ? "azure" : "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        ...(name === "Microsoft" ? { scopes: "email" } : {}),
      },
    });
  });

  it("returns to the current page after sign-in without carrying search text", async () => {
    window.history.replaceState({}, "", "/medications?q=lithium+level&run=1");
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("signed_out");
    await user.click(screen.getByRole("button", { name: "Google" }));
    const redirectTo = api.signInWithOAuth.mock.calls[0]?.[0]?.options?.redirectTo as string;
    expect(redirectTo).toBe(`${window.location.origin}/auth/callback?next=%2Fmedications`);
    expect(redirectTo).not.toMatch(/lithium|run=/);
  });

  it.each([
    "/teaching/c/synthetic-checkin-token",
    "/teaching/assessments/respond/synthetic-response-token",
    "/teaching/display/synthetic-display-token",
    `/somewhere/${"a1".repeat(32)}`,
  ])("never sends a secret link path (%s) through sign-in", async (path) => {
    window.history.replaceState({}, "", path);
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("signed_out");
    await user.click(screen.getByRole("button", { name: "Google" }));
    const redirectTo = api.signInWithOAuth.mock.calls[0]?.[0]?.options?.redirectTo as string;
    expect(redirectTo).toBe(`${window.location.origin}/auth/callback`);
  });

  it("records that an ended sign-in cleared this device, for the notice that says so", async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("signed_out");
    expect(screen.getByTestId("cleared")).toHaveTextContent("kept");
    await user.click(screen.getByRole("button", { name: "Expire" }));
    expect(screen.getByTestId("cleared")).toHaveTextContent("cleared");
  });

  it("records a session that ended by itself in an open tab, but not the reader's own Sign out", async () => {
    authState.session = { user: { id: "synthetic-user" }, access_token: "synthetic-token" };
    api.signOut.mockImplementation(async () => {
      for (const listener of authState.listeners) listener("SIGNED_OUT", null);
      return { error: null };
    });
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("authenticated");
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByText("signed_out");
    expect(screen.getByTestId("cleared")).toHaveTextContent("kept");

    cleanup();
    authState.listeners = [];
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("authenticated");
    act(() => {
      for (const listener of authState.listeners) listener("SIGNED_OUT", null);
    });
    expect(screen.getByTestId("cleared")).toHaveTextContent("cleared");
  });

  // D26-02: signing in from signed out asks about this shift's signed-out work instead of wiping it.
  it("holds signed-out patient labels at sign-in until told to keep or clear them", async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("signed_out");
    writePatientLabels("fixture", "SYNTHETIC Bed 4");
    act(() => {
      for (const listener of authState.listeners)
        listener("SIGNED_IN", { user: { id: "synthetic-user" }, access_token: "synthetic-token" });
    });
    await screen.findByText("authenticated");
    expect(screen.getByTestId("held")).toHaveTextContent("held");
    expect(patientLabelsOnDevice()).toBe(true);
    await user.click(screen.getByRole("button", { name: "Clear held" }));
    expect(screen.getByTestId("held")).toHaveTextContent("not held");
    expect(patientLabelsOnDevice()).toBe(false);
  });

  it("keeps held work when told to, and never holds anything across an account switch", async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("signed_out");
    act(() => {
      for (const listener of authState.listeners)
        listener("SIGNED_IN", { user: { id: "synthetic-user" }, access_token: "synthetic-token" });
    });
    await screen.findByText("authenticated");
    // Nothing on the phone at sign-in: nothing to ask about.
    expect(screen.getByTestId("held")).toHaveTextContent("not held");

    writePatientLabels("fixture", "SYNTHETIC Bed 4");
    act(() => {
      for (const listener of authState.listeners)
        listener("SIGNED_IN", { user: { id: "another-synthetic-user" }, access_token: "synthetic-token-2" });
    });
    expect(screen.getByTestId("held")).toHaveTextContent("not held");
    expect(patientLabelsOnDevice()).toBe(false);

    act(() => {
      for (const listener of authState.listeners) listener("SIGNED_OUT", null);
    });
    writePatientLabels("fixture", "SYNTHETIC Bed 7");
    act(() => {
      for (const listener of authState.listeners)
        listener("SIGNED_IN", { user: { id: "synthetic-user" }, access_token: "synthetic-token" });
    });
    expect(screen.getByTestId("held")).toHaveTextContent("held");
    await user.click(screen.getByRole("button", { name: "Keep held" }));
    expect(screen.getByTestId("held")).toHaveTextContent("not held");
    expect(patientLabelsOnDevice()).toBe(true);
    window.localStorage.clear();
  });

  it("settles a rejected password request so the user can retry", async () => {
    api.signInWithPassword.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("signed_out");
    await user.click(screen.getByRole("button", { name: "Password" }));
    await waitFor(() => expect(screen.getByText("error")).toBeVisible());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sign-in failed. Check your email and password, or confirm your email address.",
    );
  });
});
