import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function callbackRequest(query: string) {
  return new Request(`https://clinical.example/auth/callback?${query}`);
}

describe("/auth/callback", () => {
  it("exchanges the PKCE code and redirects to a same-origin path", async () => {
    const exchangeCodeForSession = vi.fn(async () => ({ error: null }));
    vi.doMock("@/lib/supabase/server", () => ({
      createSupabaseServerClient: vi.fn(async () => ({ auth: { exchangeCodeForSession } })),
    }));
    const { GET } = await import("../src/app/auth/callback/route");

    const response = await GET(callbackRequest("code=pkce-code&next=%2Fdocuments%3Fq%3Dlithium"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://clinical.example/documents?q=lithium");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
  });

  it("forwards auth cookies and anti-cache headers to the final redirect", async () => {
    const createSupabaseServerClient = vi.fn(
      async (options: {
        setAllCookies: (
          cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>,
          headers: Record<string, string>,
        ) => void;
      }) => ({
        auth: {
          exchangeCodeForSession: vi.fn(async () => {
            options.setAllCookies(
              [{ name: "sb-session", value: "session-value", options: { httpOnly: true, path: "/" } }],
              {
                "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
                Expires: "0",
                Pragma: "no-cache",
              },
            );
            return { error: null };
          }),
        },
      }),
    );
    vi.doMock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));
    const { GET } = await import("../src/app/auth/callback/route");

    const response = await GET(callbackRequest("code=pkce-code&next=%2Fdocuments"));

    expect(createSupabaseServerClient).toHaveBeenCalledWith({ setAllCookies: expect.any(Function) });
    expect(response.cookies.get("sb-session")?.value).toBe("session-value");
    expect(response.headers.get("cache-control")).toBe("private, no-cache, no-store, must-revalidate, max-age=0");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  /*
   * ⚠️ **EVERY `Location` ASSERTION ABOVE PASSES BY CONSTRUCTION, AND THAT IS WHY THIS DEFECT
   * SURVIVED.** `callbackRequest` builds `new Request("https://clinical.example/auth/callback?…")`
   * with no headers, so the redirect origin the route derives from `request.url` is trivially the
   * origin the test wrote into the URL. A real request does not look like that.
   *
   * Measured 2026-09-07 against this project's live `next dev` on port 4215:
   *
   *     curl -s -D - http://localhost:4215/auth/callback
   *     location: http://0.0.0.0:4215/?auth_error=missing_auth_code
   *
   * Next builds `request.url` as `${protocol}://${routerServerContext?.hostname}${req.url}`
   * (`node_modules/next/dist/server/route-modules/route-module.js:384`) unless
   * `experimental.trustHostHeader` is set, which this project does not set. The dev server binds
   * `0.0.0.0` and the container runs `next start -H 0.0.0.0`, so `request.url` carries the address
   * the server BOUND to and never the host the browser asked for. Sign-in therefore redirects the
   * browser to a non-browsable address.
   *
   * These cases use the live shape: bind address in the URL, real host in `Host`.
   */
  describe("redirects to the host the browser asked for, not the address the server bound to", () => {
    async function callbackWithHeaders(url: string, headers: Record<string, string>, query: string) {
      const exchangeCodeForSession = vi.fn(async () => ({ error: null }));
      vi.doMock("@/lib/supabase/server", () => ({
        createSupabaseServerClient: vi.fn(async () => ({ auth: { exchangeCodeForSession } })),
      }));
      const { GET } = await import("../src/app/auth/callback/route");
      return GET(new Request(`${url}?${query}`, { headers }));
    }

    it("uses the Host header when request.url carries the bind address", async () => {
      const response = await callbackWithHeaders(
        "http://0.0.0.0:4215/auth/callback",
        { host: "localhost:4215" },
        "code=pkce-code&next=%2Fdocuments",
      );

      expect(response.headers.get("location")).toBe("http://localhost:4215/documents");
    });

    it("keeps the caller's host on the error paths too, which is where a dead redirect strands you", async () => {
      // The failure redirect matters more than the success one: it is the path a user hits when
      // sign-in has already gone wrong, and sending them to 0.0.0.0 removes the error message too.
      const response = await callbackWithHeaders(
        "http://0.0.0.0:4215/auth/callback",
        { host: "127.0.0.1:4215" },
        "error=access_denied",
      );

      expect(response.headers.get("location")).toBe("http://127.0.0.1:4215/?auth_error=access_denied");
    });

    it("prefers X-Forwarded-Host and X-Forwarded-Proto, which is the deployed shape", async () => {
      // Railway terminates TLS in front of the app, so the browser's host and scheme arrive in the
      // forwarded headers rather than on the socket. Same reasoning as src/lib/api-csrf.ts.
      const response = await callbackWithHeaders(
        "http://0.0.0.0:8080/auth/callback",
        {
          host: "0.0.0.0:8080",
          "x-forwarded-host": "psychiatry.tools",
          "x-forwarded-proto": "https",
        },
        "code=pkce-code&next=%2Fdocuments",
      );

      expect(response.headers.get("location")).toBe("https://psychiatry.tools/documents");
    });

    it("takes only the first entry of a forwarded-host chain", async () => {
      const response = await callbackWithHeaders(
        "http://0.0.0.0:8080/auth/callback",
        { "x-forwarded-host": "psychiatry.tools, internal.railway", "x-forwarded-proto": "https, http" },
        "code=pkce-code&next=%2F",
      );

      expect(response.headers.get("location")).toBe("https://psychiatry.tools/");
    });

    it("still refuses an off-site next even when the origin comes from a header", async () => {
      // The open-redirect guard must not be weakened by the new origin source.
      const response = await callbackWithHeaders(
        "http://0.0.0.0:4215/auth/callback",
        { host: "localhost:4215" },
        "code=pkce-code&next=%2F%2Fevil.example%2Fsteal",
      );

      expect(response.headers.get("location")).toBe("http://localhost:4215/");
    });

    it("falls back to the request URL when no host header is present", async () => {
      // Pins the behaviour the cases above this block rely on, so their green stops being an
      // accident of the fixture and becomes a stated contract.
      const response = await callbackWithHeaders(
        "https://clinical.example/auth/callback",
        {},
        "code=pkce-code&next=%2Fdocuments",
      );

      expect(response.headers.get("location")).toBe("https://clinical.example/documents");
    });
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/\\evil.example/steal",
    "/\\/evil.example/steal",
    "/\t/evil.example/steal",
  ])("rejects unsafe redirect target %s", async (next) => {
    const exchangeCodeForSession = vi.fn(async () => ({ error: null }));
    vi.doMock("@/lib/supabase/server", () => ({
      createSupabaseServerClient: vi.fn(async () => ({ auth: { exchangeCodeForSession } })),
    }));
    const { GET } = await import("../src/app/auth/callback/route");

    const response = await GET(callbackRequest(`code=pkce-code&next=${encodeURIComponent(next)}`));

    expect(response.headers.get("location")).toBe("https://clinical.example/");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
  });

  it("returns provider errors without attempting a code exchange", async () => {
    const createSupabaseServerClient = vi.fn();
    vi.doMock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));
    const { GET } = await import("../src/app/auth/callback/route");

    const response = await GET(callbackRequest("error_description=Link+expired"));

    expect(response.headers.get("location")).toBe("https://clinical.example/?auth_error=Link%20expired");
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("falls back to the provider error code when no description is supplied", async () => {
    const createSupabaseServerClient = vi.fn();
    vi.doMock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));
    const { GET } = await import("../src/app/auth/callback/route");

    const response = await GET(callbackRequest("error=access_denied"));

    expect(response.headers.get("location")).toBe("https://clinical.example/?auth_error=access_denied");
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("reports missing codes and unconfigured auth", async () => {
    const createSupabaseServerClient = vi.fn(async () => null);
    vi.doMock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));
    const { GET } = await import("../src/app/auth/callback/route");

    const missingCodeResponse = await GET(callbackRequest("next=%2Fdocuments"));
    const unconfiguredResponse = await GET(callbackRequest("code=pkce-code"));

    expect(missingCodeResponse.headers.get("location")).toBe(
      "https://clinical.example/documents?auth_error=missing_auth_code",
    );
    expect(unconfiguredResponse.headers.get("location")).toBe("https://clinical.example/?auth_error=auth_unconfigured");
    expect(createSupabaseServerClient).toHaveBeenCalledTimes(1);
  });

  it("surfaces exchange failures without redirecting into the app", async () => {
    const exchangeCodeForSession = vi.fn(async (code: string) => {
      void code;
      return { error: { message: "Code verifier mismatch" } };
    });
    vi.doMock("@/lib/supabase/server", () => ({
      createSupabaseServerClient: vi.fn(
        async (options: {
          setAllCookies: (
            cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>,
            headers: Record<string, string>,
          ) => void;
        }) => ({
          auth: {
            exchangeCodeForSession: vi.fn(async (code: string) => {
              options.setAllCookies([{ name: "sb-session", value: "", options: { maxAge: 0 } }], {
                "Cache-Control": "private, no-store",
                Pragma: "no-cache",
              });
              return exchangeCodeForSession(code);
            }),
          },
        }),
      ),
    }));
    const { GET } = await import("../src/app/auth/callback/route");

    const response = await GET(callbackRequest("code=bad-code&next=%2Fdocuments"));

    expect(response.headers.get("location")).toBe("https://clinical.example/documents?auth_error=link_other_browser");
    expect(response.cookies.get("sb-session")?.value).toBe("");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  it.each([
    [
      "PKCE code verifier not found in storage. This can happen if the auth flow was initiated in a different browser or device",
      "link_other_browser",
    ],
    ["invalid flow state, no valid flow state found", "link_expired"],
    ["Email link is invalid or has expired", "link_expired"],
    ["Database error granting user", "exchange_failed"],
  ])("turns the exchange failure %s into the short code %s", async (message, code) => {
    vi.doMock("@/lib/supabase/server", () => ({
      createSupabaseServerClient: vi.fn(async () => ({
        auth: { exchangeCodeForSession: vi.fn(async () => ({ error: { message } })) },
      })),
    }));
    const { GET } = await import("../src/app/auth/callback/route");

    const response = await GET(callbackRequest("code=x&next=%2Fdifferentials"));

    expect(response.headers.get("location")).toBe(`https://clinical.example/differentials?auth_error=${code}`);
  });

  it("preserves a validated reset destination when exchange fails", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createSupabaseServerClient: vi.fn(async () => ({
        auth: {
          exchangeCodeForSession: vi.fn(async () => ({ error: { message: "otp_expired" } })),
        },
      })),
    }));
    const { GET } = await import("../src/app/auth/callback/route");

    const response = await GET(callbackRequest("code=stale&next=%2Fauth%2Freset-password"));

    expect(response.headers.get("location")).toBe(
      "https://clinical.example/auth/reset-password?auth_error=link_expired",
    );
  });

  it("marks successful reset-bound exchanges with a short-lived recovery cookie", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createSupabaseServerClient: vi.fn(async () => ({
        auth: {
          exchangeCodeForSession: vi.fn(async () => ({ error: null })),
        },
      })),
    }));
    const { GET } = await import("../src/app/auth/callback/route");

    const response = await GET(callbackRequest("code=pkce-code&next=%2Fauth%2Freset-password"));

    expect(response.headers.get("location")).toBe("https://clinical.example/auth/reset-password");
    expect(response.cookies.get("ps_password_recovery")?.value).toBe("1");
  });

  it("does not mark ordinary sign-in exchanges as password recovery", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createSupabaseServerClient: vi.fn(async () => ({
        auth: {
          exchangeCodeForSession: vi.fn(async () => ({ error: null })),
        },
      })),
    }));
    const { GET } = await import("../src/app/auth/callback/route");

    const response = await GET(callbackRequest("code=pkce-code&next=%2Fdocuments"));

    expect(response.headers.get("location")).toBe("https://clinical.example/documents");
    expect(response.cookies.get("ps_password_recovery")).toBeUndefined();
  });
});
