import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The proxy's second job (session-cookie refresh via supabase.auth.getClaims)
// must run on page navigations and cookie-authenticated API routes. Route
// handlers can validate an SSR cookie, but their read-only adapter cannot return
// rotated Set-Cookie headers to the browser.

const getClaims = vi.fn(async () => ({ data: { claims: null }, error: null }));
// When set, the next getClaims stalls like an unresponsive Supabase auth server and only
// writes (cleared) cookies long after the proxy's deadline has passed.
const stall = { next: false };

vi.mock("@supabase/ssr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/ssr")>();
  return {
    ...actual,
    createServerClient: vi.fn(
      (_url, _key, options: { cookies: { setAll: (cookies: never[], headers: Record<string, string>) => void } }) => ({
        auth: {
          getClaims: async () => {
            if (stall.next) {
              stall.next = false;
              await new Promise((resolve) => setTimeout(resolve, 100_000));
              options.cookies.setAll(
                [{ name: "sb-unit-test-auth-token", value: "", options: { path: "/", maxAge: 0 } }] as never[],
                {},
              );
              return { data: { claims: { sub: "late-user" } }, error: null };
            }
            options.cookies.setAll(
              [
                {
                  name: "sb-unit-test-auth-token",
                  value: "rotated-session",
                  options: { path: "/", httpOnly: true },
                },
              ] as never[],
              {
                "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
                Expires: "0",
                Pragma: "no-cache",
              },
            );
            return getClaims();
          },
        },
      }),
    ),
  };
});

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/env")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      NEXT_PUBLIC_SUPABASE_URL: "https://unit-test.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit_test",
    },
  };
});

function requestWithSessionCookie(path: string): NextRequest {
  const request = new NextRequest(new URL(`http://localhost${path}`));
  request.cookies.set("sb-unit-test-auth-token", "base64-opaque-session");
  return request;
}

beforeEach(() => {
  getClaims.mockClear();
  stall.next = false;
  vi.useRealTimers();
});

describe("proxy session refresh scoping", () => {
  it("refreshes SSR cookies for cookie-authenticated API routes and stamps the CSP", async () => {
    const { proxy } = await import("../src/proxy");
    const response = await proxy(requestWithSessionCookie("/api/answer"));

    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(response.cookies.get("sb-unit-test-auth-token")?.value).toBe("rotated-session");
    expect(response.headers.get("cache-control")).toBe("private, no-cache, no-store, must-revalidate, max-age=0");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("content-security-policy")).toBeTruthy();
  });

  it("refreshes the session on page navigations that carry an sb- cookie", async () => {
    const { proxy } = await import("../src/proxy");
    const response = await proxy(requestWithSessionCookie("/documents/some-id"));

    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(response.cookies.get("sb-unit-test-auth-token")?.value).toBe("rotated-session");
    expect(response.headers.get("content-security-policy")).toBeTruthy();
    // A check that answered in time never raises the slow sign-in note.
    expect(response.cookies.get("psychsift_sign_in_slow")).toBeUndefined();
  });

  it("lets a signed-in page load as signed out when the sign-in check stalls (performance audit H1)", async () => {
    vi.useFakeTimers();
    const { proxy, PROXY_AUTH_USER_HEADER } = await import("../src/proxy");
    const { SERVER_AUTH_DEADLINE_MS } = await import("../src/lib/supabase/auth-deadline");
    stall.next = true;

    const pending = proxy(requestWithSessionCookie("/mha-clock"));
    await vi.advanceTimersByTimeAsync(SERVER_AUTH_DEADLINE_MS);
    const response = await pending;

    expect(response.headers.get("content-security-policy")).toBeTruthy();
    const overridden = (response.headers.get("x-middleware-override-headers") ?? "").split(",");
    expect(overridden).not.toContain(PROXY_AUTH_USER_HEADER);
    expect(response.cookies.get("sb-unit-test-auth-token")).toBeUndefined();
    // The browser is told why, so it can show the slow sign-in note (owner "Build" 27 Oct 2026).
    const { SLOW_SIGN_IN_COOKIE } = await import("../src/lib/supabase/auth-deadline");
    expect(response.cookies.get(SLOW_SIGN_IN_COOKIE)?.value).toBe("1");

    // The stalled refresh finishing later must not clear the browser's session cookie.
    await vi.advanceTimersByTimeAsync(100_000);
    expect(response.cookies.get("sb-unit-test-auth-token")).toBeUndefined();
  });

  it("never calls getClaims without an sb- cookie", async () => {
    const { proxy } = await import("../src/proxy");
    await proxy(new NextRequest(new URL("http://localhost/documents/some-id")));

    expect(getClaims).not.toHaveBeenCalled();
  });

  it.each(["/sw.js", "/offline.html", "/manifest.webmanifest", "/apple-icon", "/icon.svg", "/icons/icon-192"])(
    "keeps the public PWA bootstrap path %s independent from user sessions",
    async (path) => {
      const { proxy } = await import("../src/proxy");
      const response = await proxy(requestWithSessionCookie(path));

      expect(getClaims).not.toHaveBeenCalled();
      expect(response.headers.get("content-security-policy")).toBeNull();
    },
  );

  it("does not classify clinical API routes as public PWA resources", async () => {
    const { isPublicPwaPath } = await import("../src/proxy");

    expect(isPublicPwaPath("/api/answer")).toBe(false);
    expect(isPublicPwaPath("/documents/private-id")).toBe(false);
    expect(isPublicPwaPath("/pwa/private-export.json")).toBe(false);
  });
});
