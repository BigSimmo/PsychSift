import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const { TEST_PROJECT_REF, TEST_SESSION_COOKIE } = vi.hoisted(() => {
  const TEST_PROJECT_REF = "testprojectref123";
  return {
    TEST_PROJECT_REF,
    TEST_SESSION_COOKIE: `sb-${TEST_PROJECT_REF}-auth-token`,
  };
});

// Synthetic project identity for cookie-name resolution. Do not use the live
// project ref here — presence helpers derive `sb-<ref>-auth-token` from this URL.
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: `https://${TEST_PROJECT_REF}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
    SUPABASE_PROJECT_REF: TEST_PROJECT_REF,
  },
}));

import { publicAccessContext } from "@/lib/public-api-access";
import {
  AuthenticationError,
  getOptionalAuthenticatedUser,
  requireAuthenticatedUser,
  resolveOptionalAuthentication,
} from "@/lib/supabase/auth";

function authClient(result: unknown) {
  return {
    auth: {
      getUser: vi.fn(async () => result),
    },
  };
}

describe("optional authentication", () => {
  it("owns a request-scoped user-context client for bearer and chunked-cookie publication commands", () => {
    const source = readFileSync("src/lib/supabase/auth.ts", "utf8");
    expect(source).toContain("requireAuthenticatedUserContext");
    expect(source).toContain("publicationClient");
    expect(source).toContain("global: { headers: { Authorization: `Bearer ${bearerToken}` } }");
    expect(source).toContain("parseCookieHeader(cookieHeader)");
    expect(source).toMatch(/request\.headers\.has\(["']authorization["']\)/);
  });

  it("distinguishes absent credentials without calling Supabase auth", async () => {
    const client = authClient({ data: { user: null }, error: null });
    const request = new Request("http://localhost/api/search");

    await expect(resolveOptionalAuthentication(request, client as never)).resolves.toEqual({ status: "absent" });
    expect(client.auth.getUser).not.toHaveBeenCalled();
    await expect(getOptionalAuthenticatedUser(request, client as never)).resolves.toBeNull();
  });

  it("returns a valid bearer user with immutable app metadata", async () => {
    const client = authClient({
      data: { user: { id: "user-1", app_metadata: { site_role: "administrator" } } },
      error: null,
    });
    const request = new Request("http://localhost/api/search", {
      headers: { authorization: "Bearer valid-token" },
    });

    await expect(resolveOptionalAuthentication(request, client as never)).resolves.toEqual({
      status: "valid",
      user: { id: "user-1", appMetadata: { site_role: "administrator" } },
    });
    expect(client.auth.getUser).toHaveBeenCalledWith("valid-token");
  });

  it("rejects a presented bearer credential that Supabase reports as invalid", async () => {
    const client = authClient({
      data: { user: null },
      error: { message: "Invalid token" },
    });
    const request = new Request("http://localhost/api/search", {
      headers: { authorization: "Bearer expired-token" },
    });

    await expect(getOptionalAuthenticatedUser(request, client as never)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a malformed authorization header without trying cookie fallback", async () => {
    const client = authClient({
      data: { user: { id: "user-1", app_metadata: {} } },
      error: null,
    });
    const request = new Request("http://localhost/api/search", {
      headers: {
        authorization: "Basic credentials",
        cookie: "sb-access-token=valid-cookie-token",
      },
    });

    await expect(resolveOptionalAuthentication(request, client as never)).resolves.toEqual({ status: "invalid" });
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it("does not let a valid cookie override an invalid bearer credential", async () => {
    const client = {
      auth: {
        getUser: vi.fn(async (token: string) =>
          token === "valid-cookie-token"
            ? { data: { user: { id: "user-1", app_metadata: {} } }, error: null }
            : { data: { user: null }, error: { message: "Invalid token" } },
        ),
      },
    };
    const request = new Request("http://localhost/api/search", {
      headers: {
        authorization: "Bearer expired-token",
        cookie: "sb-access-token=valid-cookie-token",
      },
    });

    await expect(resolveOptionalAuthentication(request, client as never)).resolves.toEqual({ status: "invalid" });
    expect(client.auth.getUser).toHaveBeenCalledTimes(1);
    expect(client.auth.getUser).toHaveBeenCalledWith("expired-token");
  });

  it("validates a legacy session cookie when no authorization header is present", async () => {
    const client = authClient({ data: { user: { id: "user-1", app_metadata: {} } }, error: null });
    const request = new Request("http://localhost/api/search", {
      headers: { cookie: "sb-access-token=valid-cookie-token" },
    });

    await expect(resolveOptionalAuthentication(request, client as never)).resolves.toMatchObject({
      status: "valid",
      user: { id: "user-1" },
    });
    expect(client.auth.getUser).toHaveBeenCalledWith("valid-cookie-token");
  });

  it("prefers a current Supabase session cookie over a stale legacy access-token cookie", async () => {
    const client = {
      auth: {
        getUser: vi.fn(async (token: string) =>
          token === "current-cookie-token"
            ? { data: { user: { id: "user-1", app_metadata: {} } }, error: null }
            : { data: { user: null }, error: { message: "Invalid token" } },
        ),
      },
    };
    const currentSession = encodeURIComponent(
      JSON.stringify({ access_token: "current-cookie-token", refresh_token: "refresh-token", type: "bearer" }),
    );
    const request = new Request("http://localhost/api/search", {
      headers: {
        cookie: `sb-access-token=expired-legacy-token; ${TEST_SESSION_COOKIE}=${currentSession}`,
      },
    });

    await expect(resolveOptionalAuthentication(request, client as never)).resolves.toMatchObject({
      status: "valid",
      user: { id: "user-1" },
    });
    expect(client.auth.getUser).toHaveBeenCalledTimes(1);
    expect(client.auth.getUser).toHaveBeenCalledWith("current-cookie-token");
  });

  it("ignores a stale project's session cookie when the live legacy token is valid", async () => {
    const client = {
      auth: {
        getUser: vi.fn(async (token: string) =>
          token === "valid-legacy-token"
            ? { data: { user: { id: "user-1", app_metadata: {} } }, error: null }
            : { data: { user: null }, error: { message: "Invalid token" } },
        ),
      },
    };
    const staleSession = encodeURIComponent(
      JSON.stringify({ access_token: "stale-project-token", refresh_token: "refresh-token", type: "bearer" }),
    );
    const request = new Request("http://localhost/api/search", {
      headers: {
        cookie: `sb-qjgitjyhxrwxsrydablr-auth-token=${staleSession}; sb-access-token=valid-legacy-token`,
      },
    });

    await expect(resolveOptionalAuthentication(request, client as never)).resolves.toMatchObject({
      status: "valid",
      user: { id: "user-1" },
    });
    expect(client.auth.getUser).toHaveBeenCalledTimes(1);
    expect(client.auth.getUser).toHaveBeenCalledWith("valid-legacy-token");
  });

  it("falls through blank current session cookies to a valid legacy token", async () => {
    const client = {
      auth: {
        getUser: vi.fn(async (token: string) =>
          token === "valid-legacy-token"
            ? { data: { user: { id: "user-1", app_metadata: {} } }, error: null }
            : { data: { user: null }, error: { message: "Invalid token" } },
        ),
      },
    };
    const request = new Request("http://localhost/api/search", {
      headers: {
        cookie: `${TEST_SESSION_COOKIE}=; sb-access-token=valid-legacy-token`,
      },
    });

    await expect(resolveOptionalAuthentication(request, client as never)).resolves.toMatchObject({
      status: "valid",
      user: { id: "user-1" },
    });
    expect(client.auth.getUser).toHaveBeenCalledTimes(1);
    expect(client.auth.getUser).toHaveBeenCalledWith("valid-legacy-token");
  });

  it("falls through whitespace-only current chunk cookies to a valid legacy token", async () => {
    const client = {
      auth: {
        getUser: vi.fn(async (token: string) =>
          token === "valid-legacy-token"
            ? { data: { user: { id: "user-1", app_metadata: {} } }, error: null }
            : { data: { user: null }, error: { message: "Invalid token" } },
        ),
      },
    };
    const request = new Request("http://localhost/api/search", {
      headers: {
        cookie: `${TEST_SESSION_COOKIE}.0=%20; sb-access-token=valid-legacy-token`,
      },
    });

    await expect(resolveOptionalAuthentication(request, client as never)).resolves.toMatchObject({
      status: "valid",
      user: { id: "user-1" },
    });
    expect(client.auth.getUser).toHaveBeenCalledWith("valid-legacy-token");
  });

  it("treats a blank legacy session cookie as absent credentials", async () => {
    const client = authClient({ data: { user: null }, error: null });
    const request = new Request("http://localhost/api/search", {
      headers: { cookie: "sb-access-token=" },
    });

    await expect(resolveOptionalAuthentication(request, client as never)).resolves.toEqual({ status: "absent" });
    expect(client.auth.getUser).not.toHaveBeenCalled();
    await expect(getOptionalAuthenticatedUser(request, client as never)).resolves.toBeNull();
  });

  it("treats a whitespace-only legacy session cookie as absent credentials", async () => {
    const client = authClient({ data: { user: null }, error: null });
    const request = new Request("http://localhost/api/search", {
      headers: { cookie: "sb-access-token=%20" },
    });

    await expect(resolveOptionalAuthentication(request, client as never)).resolves.toEqual({ status: "absent" });
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it("does not fall back to legacy when a non-empty current session cookie is invalid", async () => {
    const client = {
      auth: {
        getUser: vi.fn(async (token: string) =>
          token === "valid-legacy-token"
            ? { data: { user: { id: "user-1", app_metadata: {} } }, error: null }
            : { data: { user: null }, error: { message: "Invalid token" } },
        ),
      },
    };
    const expiredCurrent = encodeURIComponent(
      JSON.stringify({ access_token: "expired-current-token", refresh_token: "refresh-token", type: "bearer" }),
    );
    const request = new Request("http://localhost/api/search", {
      headers: {
        cookie: `sb-access-token=valid-legacy-token; ${TEST_SESSION_COOKIE}=${expiredCurrent}`,
      },
    });

    await expect(resolveOptionalAuthentication(request, client as never)).resolves.toEqual({ status: "invalid" });
    expect(client.auth.getUser).toHaveBeenCalledTimes(1);
    expect(client.auth.getUser).toHaveBeenCalledWith("expired-current-token");
  });

  it("rejects a legacy session cookie that Supabase reports as invalid", async () => {
    const client = authClient({ data: { user: null }, error: { message: "Invalid token" } });
    const request = new Request("http://localhost/api/search", {
      headers: { cookie: "sb-access-token=expired-cookie-token" },
    });

    await expect(getOptionalAuthenticatedUser(request, client as never)).rejects.toBeInstanceOf(AuthenticationError);
    expect(client.auth.getUser).toHaveBeenCalledWith("expired-cookie-token");
  });

  it("propagates dependency failures instead of treating them as anonymous", async () => {
    const client = {
      auth: { getUser: vi.fn(async () => Promise.reject(new Error("Supabase unavailable"))) },
    };
    const request = new Request("http://localhost/api/search", {
      headers: { authorization: "Bearer valid-token" },
    });

    await expect(getOptionalAuthenticatedUser(request, client as never)).rejects.toThrow("Supabase unavailable");
  });

  it("never constructs anonymous access for invalid credentials", async () => {
    const client = authClient({ data: { user: null }, error: { message: "Invalid token" } });
    const invalidRequest = new Request("http://localhost/api/search", {
      headers: { authorization: "Bearer expired-token", "x-real-ip": "198.51.100.10" },
    });
    const anonymousRequest = new Request("http://localhost/api/search", {
      headers: { "x-real-ip": "198.51.100.10" },
    });

    await expect(publicAccessContext(invalidRequest, client as never)).rejects.toBeInstanceOf(AuthenticationError);
    await expect(publicAccessContext(anonymousRequest, client as never)).resolves.toMatchObject({
      authenticated: false,
      ownerId: undefined,
      rateLimitSubject: { kind: "anonymous" },
    });
  });

  it("lets public catalogue GETs fall back to anonymous when credentials are invalid", async () => {
    const { publicCatalogueAccessContext } = await import("@/lib/public-api-access");
    const client = authClient({ data: { user: null }, error: { message: "Invalid token" } });
    const invalidRequest = new Request("http://localhost/api/registry/records?kind=service", {
      headers: { authorization: "Bearer expired-token", "x-real-ip": "198.51.100.10" },
    });

    await expect(publicCatalogueAccessContext(invalidRequest, client as never)).resolves.toMatchObject({
      authenticated: false,
      ownerId: undefined,
      rateLimitSubject: { kind: "anonymous" },
    });
  });

  it("binds unmocked requireAuthenticatedUser exclusively to the verified session user despite conflicting owner_id in URL or body", async () => {
    const client = authClient({
      data: { user: { id: "user-verified-123", app_metadata: { site_role: "clinician" } } },
      error: null,
    });
    const request = new Request("http://localhost/api/documents?owner_id=user-victim-999&userId=user-victim-999", {
      method: "POST",
      headers: {
        authorization: "Bearer valid-session-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        owner_id: "user-victim-999",
        userId: "user-victim-999",
      }),
    });

    const authenticatedUser = await requireAuthenticatedUser(request, client as never);
    expect(authenticatedUser).toEqual({
      id: "user-verified-123",
      appMetadata: { site_role: "clinician" },
    });
    expect(authenticatedUser.id).not.toBe("user-victim-999");

    const access = await publicAccessContext(request, client as never);
    expect(access).toMatchObject({
      authenticated: true,
      ownerId: "user-verified-123",
      rateLimitSubject: { kind: "owner" },
    });
  });
});
