/** @vitest-environment jsdom */

// sharedGet lets reads that start together share one request. An account
// switch in the same tab must never let the next person's read join the
// previous person's request still in flight: On Call restarts its read the
// moment its cache is cleared, which happens before the auth provider's own
// later reset, so the shared reads are dropped first.

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authApi = vi.hoisted(() => {
  const listeners = new Set<(event: string, session: unknown) => void>();
  const session = {
    access_token: "user-a-token",
    refresh_token: "refresh",
    expires_in: 3600,
    token_type: "bearer",
    user: { id: "user-a" },
  };
  return {
    listeners,
    session,
    signOut: vi.fn(async () => {
      for (const listener of listeners) listener("SIGNED_OUT", null);
      return { error: null };
    }),
    getUser: vi.fn(async () => ({ data: { user: session.user }, error: null })),
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
      listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
    }),
  };
});

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: {
      getUser: authApi.getUser,
      getSession: authApi.getSession,
      signOut: authApi.signOut,
      onAuthStateChange: authApi.onAuthStateChange,
      signInWithOtp: vi.fn(),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signInWithOAuth: vi.fn(),
    },
  }),
}));

import { onCallEntryCacheChangedEvent } from "@/lib/on-call/entry-cache-keys";
import { sharedGet } from "@/lib/shared-get";
import { AuthProvider, useAuthSession } from "@/lib/supabase/client";

const USER_B_SESSION = { ...authApi.session, access_token: "user-b-token", user: { id: "user-b" } };

function Status() {
  const { status } = useAuthSession();
  return <span data-testid="status">{status}</span>;
}

describe("an account switch never shares a read with the previous account", () => {
  beforeEach(() => {
    cleanup();
    authApi.listeners.clear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sjrfecxgysukkwxsowpy.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_account_transition_key_123456");
    vi.stubEnv("SUPABASE_PROJECT_REF", "sjrfecxgysukkwxsowpy");
    vi.stubEnv("SUPABASE_PROJECT_NAME", "PsychSift Production");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("gives a read restarted by On Call's clear its own request", async () => {
    render(
      <AuthProvider>
        <Status />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));

    // Account A's read is still waiting on a slow signal.
    const pending: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(resolve);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const accountARead = sharedGet("/api/on-call/entries");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // On Call restarts its read the moment its cache is cleared, as the store does.
    let accountBRead: Promise<Response> | null = null;
    const restart = () => {
      accountBRead = sharedGet("/api/on-call/entries");
    };
    window.addEventListener(onCallEntryCacheChangedEvent, restart);
    try {
      await act(async () => {
        for (const listener of authApi.listeners) listener("SIGNED_IN", USER_B_SESSION);
      });
    } finally {
      window.removeEventListener(onCallEntryCacheChangedEvent, restart);
    }

    expect(accountBRead).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending[0]?.(new Response(JSON.stringify({ account: "a" })));
    pending[1]?.(new Response(JSON.stringify({ account: "b" })));
    await expect((await accountARead).json()).resolves.toEqual({ account: "a" });
    await expect((await accountBRead!).json()).resolves.toEqual({ account: "b" });
  });
});
