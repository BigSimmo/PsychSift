import { afterEach, describe, expect, it, vi } from "vitest";

import {
  boundServerAuthChecks,
  createServerAuthDeadline,
  SERVER_AUTH_DEADLINE_MS,
} from "../src/lib/supabase/auth-deadline";

afterEach(() => {
  vi.useRealTimers();
});

const never = <T>() => new Promise<T>(() => undefined);

describe("server sign-in check deadline (performance audit H1)", () => {
  it("keeps the deadline short enough that a stalled check cannot hold a page", () => {
    expect(SERVER_AUTH_DEADLINE_MS).toBeGreaterThanOrEqual(3_000);
    expect(SERVER_AUTH_DEADLINE_MS).toBeLessThanOrEqual(5_000);
  });

  it("returns the check's own result when it answers in time", async () => {
    const deadline = createServerAuthDeadline(1_000);
    await expect(deadline.run(async () => "signed-in", "fallback")).resolves.toEqual({
      value: "signed-in",
      timedOut: false,
    });
    expect(deadline.expired).toBe(false);
  });

  it("falls back once the deadline expires, and aborts the stalled auth request", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const baseFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return never<Response>();
    });
    const deadline = createServerAuthDeadline(4_000, baseFetch as typeof fetch);

    const pending = deadline.run(() => deadline.fetch("https://project.supabase.co/auth/v1/user"), null);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(deadline.expired).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toEqual({ value: null, timedOut: true });
    expect(deadline.expired).toBe(true);
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(true);
  });

  it("rejects later auth requests at once after expiry, so auth-js retries cannot stretch the wait", async () => {
    vi.useFakeTimers();
    const baseFetch = vi.fn(() => never<Response>());
    const deadline = createServerAuthDeadline(10, baseFetch as typeof fetch);
    const pending = deadline.run(() => never(), "fallback");
    await vi.advanceTimersByTimeAsync(10);
    await pending;

    await expect(deadline.fetch("https://project.supabase.co/auth/v1/token?grant_type=refresh_token")).rejects.toThrow(
      /timed out/,
    );
    await expect(deadline.run(async () => "late", "fallback")).resolves.toEqual({ value: "fallback", timedOut: true });
    expect(baseFetch).not.toHaveBeenCalled();
  });

  it("leaves database and storage requests on their own timing", async () => {
    vi.useFakeTimers();
    const baseFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      return new Response("[]");
    });
    const deadline = createServerAuthDeadline(10, baseFetch as typeof fetch);
    const pending = deadline.run(() => never(), null);
    await vi.advanceTimersByTimeAsync(10);
    await pending;

    await deadline.fetch("https://project.supabase.co/rest/v1/documents");
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(baseFetch.mock.calls[0][1]).toBeUndefined();
  });

  it("passes a check that fails before the deadline straight through", async () => {
    const deadline = createServerAuthDeadline(1_000);
    await expect(deadline.run(async () => Promise.reject(new Error("boom")), null)).rejects.toThrow("boom");
  });

  it("bounds a server client's getUser and getClaims in place, resolving as signed out on a stall", async () => {
    vi.useFakeTimers();
    const client = { auth: { getUser: vi.fn(() => never()), getClaims: vi.fn(() => never()) }, rpc: vi.fn() };
    const deadline = createServerAuthDeadline(4_000);
    const bounded = boundServerAuthChecks(client, deadline);
    expect(bounded).toBe(client);

    const user = bounded.auth.getUser();
    await vi.advanceTimersByTimeAsync(4_000);
    await expect(user).resolves.toMatchObject({ data: { user: null }, error: { name: "AuthRetryableFetchError" } });
    await expect(bounded.auth.getClaims()).resolves.toMatchObject({ data: null, error: { status: 0 } });
  });

  it("forwards arguments and results when the check answers", async () => {
    const getUser = vi.fn(async (jwt?: string) => ({ data: { user: { id: `user-for-${jwt}` } }, error: null }));
    const client = boundServerAuthChecks({ auth: { getUser } }, createServerAuthDeadline(1_000));

    await expect(client.auth.getUser("token")).resolves.toEqual({
      data: { user: { id: "user-for-token" } },
      error: null,
    });
    expect(getUser).toHaveBeenCalledWith("token");
  });

  it("tolerates a client without auth", () => {
    const client = { kind: "server-client" };
    expect(boundServerAuthChecks(client, createServerAuthDeadline())).toBe(client);
  });
});
