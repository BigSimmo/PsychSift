/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ signInWithOAuth: vi.fn(), signInWithPassword: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      ...api,
    },
  }),
}));

import { AuthProvider, useAuthSession } from "@/lib/supabase/client";

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
