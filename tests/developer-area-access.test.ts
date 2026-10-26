import { afterEach, describe, expect, it, vi } from "vitest";

import { issueDeveloperAccessToken } from "../src/lib/developer-area/link-access";

// resolveDeveloperAccessState() is the real authorization decision behind the
// Development hub and Care Plan routes in production (src/proxy.ts and
// mockups/layout.tsx only decide which requests reach it). It must distinguish
// three states — no session, a session that is not an administrator, and an
// administrator session — because the middle case (someone else's ordinary
// self-serve account) must NOT be treated the same as "please sign in".

const originalAccessKey = process.env.DEVELOPER_AREA_ACCESS_KEY;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  if (originalAccessKey === undefined) delete process.env.DEVELOPER_AREA_ACCESS_KEY;
  else process.env.DEVELOPER_AREA_ACCESS_KEY = originalAccessKey;
});

async function loadWithSupabaseUser(
  user: { id: string; email?: string; app_metadata?: Record<string, unknown> } | null,
) {
  vi.doMock("server-only", () => ({}));
  vi.doMock("@/lib/supabase/server", () => ({
    createSupabaseServerClient: vi.fn(async () => ({
      auth: { getUser: vi.fn(async () => ({ data: { user } })) },
    })),
  }));
  return import("../src/lib/developer-area/access");
}

describe("resolveDeveloperAccessState", () => {
  it("reports unauthenticated when Supabase is not configured (no client)", async () => {
    vi.doMock("server-only", () => ({}));
    vi.doMock("@/lib/supabase/server", () => ({
      createSupabaseServerClient: vi.fn(async () => null),
    }));
    const { resolveDeveloperAccessState } = await import("../src/lib/developer-area/access");

    await expect(resolveDeveloperAccessState()).resolves.toEqual({ state: "unauthenticated", email: null });
  });

  it("reports unauthenticated when there is no signed-in user", async () => {
    const { resolveDeveloperAccessState } = await loadWithSupabaseUser(null);

    await expect(resolveDeveloperAccessState()).resolves.toEqual({ state: "unauthenticated", email: null });
  });

  it("reports unauthorized for a signed-in user without the administrator claim", async () => {
    const { resolveDeveloperAccessState } = await loadWithSupabaseUser({
      id: "user-1",
      email: "someone-else@example.com",
      app_metadata: {},
    });

    await expect(resolveDeveloperAccessState()).resolves.toEqual({
      state: "unauthorized",
      email: "someone-else@example.com",
    });
  });

  it("reports authorized for a signed-in administrator", async () => {
    const { resolveDeveloperAccessState } = await loadWithSupabaseUser({
      id: "user-1",
      email: "josh@stoicable.com",
      app_metadata: { site_role: "administrator" },
    });

    await expect(resolveDeveloperAccessState()).resolves.toEqual({
      state: "authorized",
      email: "josh@stoicable.com",
    });
  });
});

describe("developerGateBypassAllowed", () => {
  it("allows the bypass outside production regardless of the mockups flag", async () => {
    vi.doMock("server-only", () => ({}));
    const { developerGateBypassAllowed } = await import("../src/lib/developer-area/access");

    expect(developerGateBypassAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(developerGateBypassAllowed({ NODE_ENV: "test" })).toBe(true);
  });

  it("does NOT bypass in production when only NEXT_PUBLIC_MOCKUPS_ENABLED is set (#L30)", async () => {
    vi.doMock("server-only", () => ({}));
    const { developerGateBypassAllowed } = await import("../src/lib/developer-area/access");

    expect(
      developerGateBypassAllowed({
        NODE_ENV: "production",
        NEXT_PUBLIC_MOCKUPS_ENABLED: "true",
      }),
    ).toBe(false);
  });

  it("bypasses in production only under the proxy's exact double-flag exception", async () => {
    vi.doMock("server-only", () => ({}));
    const { developerGateBypassAllowed } = await import("../src/lib/developer-area/access");

    expect(
      developerGateBypassAllowed({
        NODE_ENV: "production",
        NEXT_PUBLIC_MOCKUPS_ENABLED: "true",
        PLAYWRIGHT_OFFLINE_MODE: "true",
      }),
    ).toBe(true);
    expect(
      developerGateBypassAllowed({
        NODE_ENV: "production",
        NEXT_PUBLIC_MOCKUPS_ENABLED: "false",
        PLAYWRIGHT_OFFLINE_MODE: "true",
      }),
    ).toBe(false);
  });
});

describe("developerLinkAccessGranted", () => {
  // The passwordless credential the gate checks BEFORE Supabase. It must admit
  // only a cookie this deployment signed -- an absent, forged, or
  // differently-keyed value has to fall through to the sign-in screen, because
  // failing open here publishes the developer area to the internet.
  // Built from readable words rather than written as a 32-character random-looking
  // literal. A high-entropy string assigned to a name like KEY is exactly what the
  // Gitleaks `generic-api-key` rule is for, and it fired on this file's first
  // version (secret-scan, run 34232733033). The value only has to be a key of
  // sufficient length -- nothing here depends on it looking random -- so the fix
  // is to stop it resembling a credential, never to allowlist the finding.
  const KEY = "developer-area-test-key".padEnd(32, "-");

  async function loadWithCookie(value: string | undefined) {
    vi.doMock("server-only", () => ({}));
    vi.doMock("next/headers", () => ({
      cookies: vi.fn(async () => ({ get: (name: string) => (value === undefined ? undefined : { name, value }) })),
    }));
    vi.doMock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(async () => null) }));
    return import("../src/lib/developer-area/access");
  }

  it("grants access for a cookie signed by this deployment", async () => {
    process.env.DEVELOPER_AREA_ACCESS_KEY = KEY;
    const token = issueDeveloperAccessToken({ DEVELOPER_AREA_ACCESS_KEY: KEY }) as string;
    const { developerLinkAccessGranted } = await loadWithCookie(token);

    await expect(developerLinkAccessGranted()).resolves.toBe(true);
  });

  it("refuses an absent cookie, a forged one, and one signed under a rotated key", async () => {
    process.env.DEVELOPER_AREA_ACCESS_KEY = KEY;
    const foreign = issueDeveloperAccessToken({
      DEVELOPER_AREA_ACCESS_KEY: "developer-area-other-key".padEnd(32, "-"),
    }) as string;

    for (const value of [undefined, "v1.1.forged", foreign]) {
      vi.resetModules();
      const { developerLinkAccessGranted } = await loadWithCookie(value);
      await expect(developerLinkAccessGranted()).resolves.toBe(false);
    }
  });

  it("refuses every cookie when the deployment configures no key (fail closed)", async () => {
    const token = issueDeveloperAccessToken({ DEVELOPER_AREA_ACCESS_KEY: KEY }) as string;
    delete process.env.DEVELOPER_AREA_ACCESS_KEY;
    const { developerLinkAccessGranted } = await loadWithCookie(token);

    await expect(developerLinkAccessGranted()).resolves.toBe(false);
  });
});

describe("developerAreaRequestAuthorized", () => {
  // The check each developer-hub page repeats for itself, because the App Router
  // can skip the shared layout (and so `DeveloperAreaGate`) on a client-side
  // navigation. It must refuse exactly what the gate refuses.
  const KEY = "developer-area-test-key".padEnd(32, "-");

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function load({
    cookie,
    user,
  }: {
    cookie?: string;
    user: { id: string; app_metadata?: Record<string, unknown> } | null;
  }) {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLAYWRIGHT_OFFLINE_MODE", "");
    vi.doMock("server-only", () => ({}));
    vi.doMock("next/headers", () => ({
      cookies: vi.fn(async () => ({
        get: (name: string) => (cookie === undefined ? undefined : { name, value: cookie }),
      })),
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      createSupabaseServerClient: vi.fn(async () => ({
        auth: { getUser: vi.fn(async () => ({ data: { user } })) },
      })),
    }));
    return import("../src/lib/developer-area/access");
  }

  it("refuses a signed-out request and a signed-in non-administrator in production", async () => {
    const signedOut = await load({ user: null });
    await expect(signedOut.developerAreaRequestAuthorized()).resolves.toBe(false);

    vi.resetModules();
    const ordinary = await load({ user: { id: "user-1", app_metadata: {} } });
    await expect(ordinary.developerAreaRequestAuthorized()).resolves.toBe(false);
  });

  it("admits an administrator, or a holder of a valid access cookie", async () => {
    const admin = await load({ user: { id: "admin-1", app_metadata: { site_role: "administrator" } } });
    await expect(admin.developerAreaRequestAuthorized()).resolves.toBe(true);

    vi.resetModules();
    process.env.DEVELOPER_AREA_ACCESS_KEY = KEY;
    const token = issueDeveloperAccessToken({ DEVELOPER_AREA_ACCESS_KEY: KEY }) as string;
    const linkHolder = await load({ cookie: token, user: null });
    await expect(linkHolder.developerAreaRequestAuthorized()).resolves.toBe(true);
  });
});
