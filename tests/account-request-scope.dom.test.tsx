/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAccountRequestScope } from "@/components/use-account-request-scope";
import { createAuthRequestLifecycle } from "@/lib/auth-request-lifecycle";
import type { useAuthSession } from "@/lib/supabase/client";

type Auth = ReturnType<typeof useAuthSession>;
const state = vi.hoisted(() => ({ auth: null as Auth | null }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => state.auth }));

let lifecycle: ReturnType<typeof createAuthRequestLifecycle>;

beforeEach(() => {
  lifecycle = createAuthRequestLifecycle(7);
  // Keep every field of the real AuthProvider contract, including its stable,
  // imperative epoch methods. No provider, cookie or network request is used.
  state.auth = {
    client: null,
    session: {
      access_token: "synthetic-token-1",
      refresh_token: "synthetic-refresh",
      expires_in: 3600,
      token_type: "bearer",
      user: {
        id: "synthetic-A",
        app_metadata: {},
        user_metadata: {},
        aud: "authenticated",
        created_at: "2020-01-01T00:00:00Z",
      },
    },
    status: "authenticated",
    error: null,
    notice: null,
    isConfigured: true,
    authorizationHeader: { Authorization: "Bearer synthetic-token-1" },
    authEpoch: lifecycle.currentEpoch(),
    registerAuthRequest: lifecycle.register,
    isAuthEpochCurrent: lifecycle.isCurrent,
    signInWithEmail: vi.fn(async () => undefined),
    signInWithPassword: vi.fn(async () => undefined),
    signUpWithPassword: vi.fn(async () => undefined),
    signInWithOAuth: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    markSessionExpired: vi.fn(),
  } satisfies Auth;
});

describe("account request scope with AuthProvider's epoch contract", () => {
  it("rejects captured work when the real lifecycle invalidates before React publishes another auth value", () => {
    const view = renderHook(useAccountRequestScope);
    const captured = view.result.current.isCurrent;
    const publishedAuth = state.auth!;
    const controller = new AbortController();
    const registration = publishedAuth.registerAuthRequest(controller);
    expect(captured()).toBe(true);

    // AuthProvider invalidates imperatively before its queued React render.
    // Deliberately do not mutate auth fields, replace the object or rerender.
    lifecycle.invalidate();
    expect(state.auth).toBe(publishedAuth);
    expect(state.auth!.authEpoch).toBe(7);
    expect(controller.signal.aborted).toBe(true);
    expect(captured()).toBe(false);
    registration.release();
  });

  it("rejects retained work after unmount even while the auth epoch is still current", () => {
    const view = renderHook(useAccountRequestScope);
    const captured = view.result.current.isCurrent;
    expect(captured()).toBe(true);
    view.unmount();
    expect(state.auth!.isAuthEpochCurrent(state.auth!.authEpoch)).toBe(true);
    expect(captured()).toBe(false);
  });

  it("preserves the scope, dependent read and queued callback across same-owner token refresh", async () => {
    const dependentRead = vi.fn();
    const queuedWrite = vi.fn();
    const view = renderHook(() => {
      const scope = useAccountRequestScope();
      useEffect(() => {
        dependentRead();
      }, [scope.isCurrent]);
      return scope;
    });
    const captured = view.result.current.isCurrent;
    const scope = view.result.current.scope;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = barrier.then(() => {
      if (captured()) queuedWrite();
    });

    const previous = state.auth!;
    act(() => {
      state.auth = {
        ...previous,
        authorizationHeader: { Authorization: "Bearer synthetic-token-2" },
        session: { ...previous.session!, access_token: "synthetic-token-2" },
      };
      view.rerender();
    });
    expect(state.auth).not.toBe(previous);
    expect(view.result.current.scope).toBe(scope);
    expect(view.result.current.isCurrent).toBe(captured);
    expect(captured()).toBe(true);
    expect(dependentRead).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
      await queued;
    });
    expect(queuedWrite).toHaveBeenCalledTimes(1);
  });
});
