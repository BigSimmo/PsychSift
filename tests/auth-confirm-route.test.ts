import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function confirmRequest(query: string, headers?: Record<string, string>) {
  return new Request(`https://clinical.example/auth/confirm?${query}`, { headers });
}

async function loadConfirm(verifyOtp: (...args: unknown[]) => Promise<{ error: { message: string } | null }>) {
  vi.doMock("@/lib/supabase/server", () => ({
    createSupabaseServerClient: vi.fn(async () => ({ auth: { verifyOtp } })),
  }));
  return import("../src/app/auth/confirm/route");
}

describe("/auth/confirm", () => {
  it("verifies the token hash and redirects to a same-origin path", async () => {
    const verifyOtp = vi.fn(async () => ({ error: null }));
    const { GET } = await loadConfirm(verifyOtp);

    const response = await GET(confirmRequest("token_hash=hash-1&type=email&next=%2Fdocuments%3Fq%3Dlithium"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://clinical.example/documents?q=lithium");
    expect(verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "hash-1" });
  });

  it("unwraps the app's own callback URL passed through {{ .RedirectTo }}", async () => {
    const { GET } = await loadConfirm(vi.fn(async () => ({ error: null })));
    const redirectTo = encodeURIComponent("https://clinical.example/auth/callback?next=%2Fdocuments%3Fq%3Dlithium");

    const response = await GET(confirmRequest(`token_hash=h&type=signup&next=${redirectTo}`));

    expect(response.headers.get("location")).toBe("https://clinical.example/documents?q=lithium");
  });

  it("keeps the path of an absolute same-origin next that is not the callback", async () => {
    const { GET } = await loadConfirm(vi.fn(async () => ({ error: null })));
    const next = encodeURIComponent("https://clinical.example/favourites?tab=pinned");

    const response = await GET(confirmRequest(`token_hash=h&type=magiclink&next=${next}`));

    expect(response.headers.get("location")).toBe("https://clinical.example/favourites?tab=pinned");
  });

  it.each([
    ["an off-site absolute URL", encodeURIComponent("https://evil.example/steal")],
    ["a protocol-relative URL", encodeURIComponent("//evil.example/steal")],
    ["an off-site URL wrapped in the callback", encodeURIComponent("https://evil.example/auth/callback?next=%2Fx")],
    [
      "an off-site next inside the callback",
      encodeURIComponent("https://clinical.example/auth/callback?next=https%3A%2F%2Fevil.example"),
    ],
  ])("refuses %s and lands on the home page", async (_label, next) => {
    const { GET } = await loadConfirm(vi.fn(async () => ({ error: null })));

    const response = await GET(confirmRequest(`token_hash=h&type=email&next=${next}`));

    expect(response.headers.get("location")).toBe("https://clinical.example/");
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
          verifyOtp: vi.fn(async () => {
            options.setAllCookies(
              [{ name: "sb-session", value: "session-value", options: { httpOnly: true, path: "/" } }],
              { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0" },
            );
            return { error: null };
          }),
        },
      }),
    );
    vi.doMock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));
    const { GET } = await import("../src/app/auth/confirm/route");

    const response = await GET(confirmRequest("token_hash=h&type=email&next=%2Fdocuments"));

    expect(createSupabaseServerClient).toHaveBeenCalledWith({ setAllCookies: expect.any(Function) });
    expect(response.cookies.get("sb-session")?.value).toBe("session-value");
    expect(response.headers.get("cache-control")).toBe("private, no-cache, no-store, must-revalidate, max-age=0");
  });

  it("sends a recovery link to the reset page with the recovery cookie, whatever next says", async () => {
    const { GET } = await loadConfirm(vi.fn(async () => ({ error: null })));

    const response = await GET(confirmRequest("token_hash=h&type=recovery&next=%2Fdocuments"));

    expect(response.headers.get("location")).toBe("https://clinical.example/auth/reset-password");
    expect(response.cookies.get("ps_password_recovery")?.value).toBe("1");
  });

  it("does not mark ordinary sign-in links as password recovery", async () => {
    const { GET } = await loadConfirm(vi.fn(async () => ({ error: null })));

    const response = await GET(confirmRequest("token_hash=h&type=email&next=%2Fdocuments"));

    expect(response.cookies.get("ps_password_recovery")).toBeUndefined();
  });

  it.each([
    ["no token hash", "type=email&next=%2Fdocuments"],
    ["no type", "token_hash=h&next=%2Fdocuments"],
    ["an unknown type", "token_hash=h&type=sms&next=%2Fdocuments"],
  ])("reports a broken link with %s, without calling Supabase", async (_label, query) => {
    const verifyOtp = vi.fn(async () => ({ error: null }));
    const { GET } = await loadConfirm(verifyOtp);

    const response = await GET(confirmRequest(query));

    expect(response.headers.get("location")).toBe("https://clinical.example/documents?auth_error=missing_auth_code");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("reports unconfigured auth", async () => {
    vi.doMock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(async () => null) }));
    const { GET } = await import("../src/app/auth/confirm/route");

    const response = await GET(confirmRequest("token_hash=h&type=email"));

    expect(response.headers.get("location")).toBe("https://clinical.example/?auth_error=auth_unconfigured");
  });

  it.each([
    ["Email link is invalid or has expired", "link_expired"],
    ["Token has expired or is invalid", "link_expired"],
    ["Something else went wrong", "verify_failed"],
  ])("maps the verify error %j to %s", async (message, code) => {
    const { GET } = await loadConfirm(vi.fn(async () => ({ error: { message } })));

    const response = await GET(confirmRequest("token_hash=h&type=email&next=%2Fdocuments"));

    expect(response.headers.get("location")).toBe(`https://clinical.example/documents?auth_error=${code}`);
  });

  it("uses the Host header when request.url carries the bind address", async () => {
    const { GET } = await loadConfirm(vi.fn(async () => ({ error: null })));

    const response = await GET(
      new Request("http://0.0.0.0:4215/auth/confirm?token_hash=h&type=email&next=%2Fdocuments", {
        headers: { host: "localhost:4215" },
      }),
    );

    expect(response.headers.get("location")).toBe("http://localhost:4215/documents");
  });

  it("matches an absolute next against the forwarded origin, which is the deployed shape", async () => {
    const { GET } = await loadConfirm(vi.fn(async () => ({ error: null })));
    const next = encodeURIComponent("https://psychiatry.tools/auth/callback?next=%2Fdocuments");

    const response = await GET(
      new Request(`http://0.0.0.0:8080/auth/confirm?token_hash=h&type=email&next=${next}`, {
        headers: { host: "0.0.0.0:8080", "x-forwarded-host": "psychiatry.tools", "x-forwarded-proto": "https" },
      }),
    );

    expect(response.headers.get("location")).toBe("https://psychiatry.tools/documents");
  });
});
