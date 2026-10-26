import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PP-04: a signed-out or blocked session must not keep writing on the proxy's locally verified
// claims until its access token expires. Synthetic users and tokens only.
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://testprojectref123.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
    SUPABASE_PROJECT_REF: "testprojectref123",
  },
}));

import {
  AuthenticationError,
  PROXY_AUTH_USER_HEADER,
  requireAuthenticatedUser,
  resolveOptionalAuthentication,
} from "@/lib/supabase/auth";
import { signProxyAuthPayload } from "@/lib/supabase/proxy-auth-crypto";

const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-service-role-key";
});

afterEach(() => {
  if (previousServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
});

function proxyHeader(id = "synthetic-user") {
  const header = signProxyAuthPayload(Buffer.from(JSON.stringify({ id, appMetadata: {} })).toString("base64"));
  if (!header) throw new Error("expected a signed proxy header");
  return header;
}

function requestWithProxyClaims(method: string) {
  return new Request("http://localhost/api/account/favourites", {
    method,
    headers: { [PROXY_AUTH_USER_HEADER]: proxyHeader(), cookie: "sb-access-token=synthetic-token" },
  });
}

function authClient(result: unknown) {
  return { auth: { getUser: vi.fn(async () => result) } };
}

describe("live account recheck on saves (PP-04)", () => {
  it("keeps the proxy fast path for reads", async () => {
    const client = authClient({ data: { user: null }, error: { message: "session not found" } });
    await expect(requireAuthenticatedUser(requestWithProxyClaims("GET"), client as never)).resolves.toMatchObject({
      id: "synthetic-user",
    });
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it("refuses a save from a signed-out session even with valid proxy claims", async () => {
    const client = authClient({ data: { user: null }, error: { message: "session not found" } });
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      await expect(requireAuthenticatedUser(requestWithProxyClaims(method), client as never)).rejects.toBeInstanceOf(
        AuthenticationError,
      );
    }
    expect(client.auth.getUser).toHaveBeenCalledWith("synthetic-token");
  });

  it("lets a save through when the live account is still valid", async () => {
    const client = authClient({ data: { user: { id: "synthetic-user", app_metadata: {} } }, error: null });
    await expect(requireAuthenticatedUser(requestWithProxyClaims("POST"), client as never)).resolves.toEqual({
      id: "synthetic-user",
      appMetadata: {},
    });
    expect(client.auth.getUser).toHaveBeenCalledTimes(1);
  });

  it("refuses a blocked account on a save", async () => {
    const bannedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const client = authClient({
      data: { user: { id: "synthetic-user", app_metadata: {}, banned_until: bannedUntil } },
      error: null,
    });
    await expect(requireAuthenticatedUser(requestWithProxyClaims("POST"), client as never)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("refuses a blocked account presenting a bearer token, and accepts one whose ban has passed", async () => {
    const bearer = (bannedUntil: string) => ({
      request: new Request("http://localhost/api/search", { headers: { authorization: "Bearer synthetic-token" } }),
      client: authClient({
        data: { user: { id: "synthetic-user", app_metadata: {}, banned_until: bannedUntil } },
        error: null,
      }),
    });
    const blocked = bearer(new Date(Date.now() + 60_000).toISOString());
    await expect(resolveOptionalAuthentication(blocked.request, blocked.client as never)).resolves.toEqual({
      status: "invalid",
    });
    const unreadable = bearer("not a date");
    await expect(resolveOptionalAuthentication(unreadable.request, unreadable.client as never)).resolves.toEqual({
      status: "invalid",
    });
    const lifted = bearer(new Date(Date.now() - 60_000).toISOString());
    await expect(resolveOptionalAuthentication(lifted.request, lifted.client as never)).resolves.toMatchObject({
      status: "valid",
    });
  });
});
