/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// AuthProvider loads the Supabase library after first paint. A failed first load
// must not leave sign-in half working: when a later sign-in loads it, the provider
// has to adopt that client so the auth listener and session publishing start.
const api = vi.hoisted(() => ({
  loads: 0,
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
  signInWithPassword: vi.fn(async () => ({ data: { session: null }, error: null })),
}));
vi.mock("@/lib/supabase/browser-client", () => ({
  browserSupabaseClientFor: () => {
    api.loads += 1;
    if (api.loads === 1) throw new Error("chunk failed to load");
    return {
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: api.onAuthStateChange,
        signInWithPassword: api.signInWithPassword,
      },
    };
  },
}));

import { AuthProvider, useAuthSession } from "@/lib/supabase/client";

function Probe() {
  const auth = useAuthSession();
  return (
    <>
      <p>{auth.status}</p>
      <button type="button" onClick={() => void auth.signInWithPassword("person@example.com", "passphrase")}>
        Password
      </button>
    </>
  );
}

beforeEach(() => {
  api.loads = 0;
  api.onAuthStateChange.mockClear();
  api.signInWithPassword.mockClear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sjrfecxgysukkwxsowpy.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_offline_test");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("AuthProvider lazy Supabase client", () => {
  it("adopts a client that loads on a sign-in retry after the first load failed", async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("error");
    expect(api.onAuthStateChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Password" }));
    await waitFor(() => expect(api.signInWithPassword).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.onAuthStateChange).toHaveBeenCalledTimes(1));
    await screen.findByText("signed_out");
  });
});
