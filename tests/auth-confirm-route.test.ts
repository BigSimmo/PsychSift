import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function confirmRequest(query: string, headers?: Record<string, string>) {
  return new Request(`https://clinical.example/auth/confirm?${query}`, { headers });
}

/** The Continue button's form post: same fields, sent from the page this site served. */
function confirmPost(query: string, headers: Record<string, string> = { origin: "https://clinical.example" }) {
  return postTo("https://clinical.example/auth/confirm", query, headers);
}

function postTo(url: string, query: string, headers: Record<string, string>) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: query,
  });
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
    const { POST } = await loadConfirm(verifyOtp);

    const response = await POST(confirmPost("token_hash=hash-1&type=email&next=%2Fdocuments%3Fq%3Dlithium"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://clinical.example/documents?q=lithium");
    expect(verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "hash-1" });
  });

  it("unwraps the app's own callback URL passed through {{ .RedirectTo }}", async () => {
    const { POST } = await loadConfirm(vi.fn(async () => ({ error: null })));
    const redirectTo = encodeURIComponent("https://clinical.example/auth/callback?next=%2Fdocuments%3Fq%3Dlithium");

    const response = await POST(confirmPost(`token_hash=h&type=signup&next=${redirectTo}`));

    expect(response.headers.get("location")).toBe("https://clinical.example/documents?q=lithium");
  });

  it("keeps the path of an absolute same-origin next that is not the callback", async () => {
    const { POST } = await loadConfirm(vi.fn(async () => ({ error: null })));
    const next = encodeURIComponent("https://clinical.example/favourites?tab=pinned");

    const response = await POST(confirmPost(`token_hash=h&type=magiclink&next=${next}`));

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
    const { POST } = await loadConfirm(vi.fn(async () => ({ error: null })));

    const response = await POST(confirmPost(`token_hash=h&type=email&next=${next}`));

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
    const { POST } = await import("../src/app/auth/confirm/route");

    const response = await POST(confirmPost("token_hash=h&type=email&next=%2Fdocuments"));

    expect(createSupabaseServerClient).toHaveBeenCalledWith({ setAllCookies: expect.any(Function) });
    expect(response.cookies.get("sb-session")?.value).toBe("session-value");
    expect(response.headers.get("cache-control")).toBe("private, no-cache, no-store, must-revalidate, max-age=0");
  });

  it("sends a recovery link to the reset page with the recovery cookie, whatever next says", async () => {
    const { POST } = await loadConfirm(vi.fn(async () => ({ error: null })));

    const response = await POST(confirmPost("token_hash=h&type=recovery&next=%2Fdocuments"));

    expect(response.headers.get("location")).toBe("https://clinical.example/auth/reset-password");
    expect(response.cookies.get("ps_password_recovery")?.value).toBe("1");
  });

  it("does not mark ordinary sign-in links as password recovery", async () => {
    const { POST } = await loadConfirm(vi.fn(async () => ({ error: null })));

    const response = await POST(confirmPost("token_hash=h&type=email&next=%2Fdocuments"));

    expect(response.cookies.get("ps_password_recovery")).toBeUndefined();
  });

  it.each([
    ["no token hash", "type=email&next=%2Fdocuments"],
    ["no type", "token_hash=h&next=%2Fdocuments"],
    ["an unknown type", "token_hash=h&type=sms&next=%2Fdocuments"],
  ])("reports a broken link with %s, without calling Supabase", async (_label, query) => {
    const verifyOtp = vi.fn(async () => ({ error: null }));
    const { POST } = await loadConfirm(verifyOtp);

    const response = await POST(confirmPost(query));

    expect(response.headers.get("location")).toBe("https://clinical.example/documents?auth_error=missing_auth_code");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("reports unconfigured auth", async () => {
    vi.doMock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(async () => null) }));
    const { POST } = await import("../src/app/auth/confirm/route");

    const response = await POST(confirmPost("token_hash=h&type=email"));

    expect(response.headers.get("location")).toBe("https://clinical.example/?auth_error=auth_unconfigured");
  });

  it.each([
    ["Email link is invalid or has expired", "link_expired"],
    ["Token has expired or is invalid", "link_expired"],
    ["User is banned", "account_blocked"],
    ["Something else went wrong", "verify_failed"],
  ])("maps the verify error %j to %s", async (message, code) => {
    const { POST } = await loadConfirm(vi.fn(async () => ({ error: { message } })));

    const response = await POST(confirmPost("token_hash=h&type=email&next=%2Fdocuments"));

    expect(response.headers.get("location")).toBe(`https://clinical.example/documents?auth_error=${code}`);
  });

  it("uses the Host header when request.url carries the bind address", async () => {
    const { POST } = await loadConfirm(vi.fn(async () => ({ error: null })));

    const response = await POST(
      postTo("http://0.0.0.0:4215/auth/confirm", "token_hash=h&type=email&next=%2Fdocuments", {
        host: "localhost:4215",
        origin: "http://localhost:4215",
      }),
    );

    expect(response.headers.get("location")).toBe("http://localhost:4215/documents");
  });

  it("matches an absolute next against the forwarded origin, which is the deployed shape", async () => {
    const { POST } = await loadConfirm(vi.fn(async () => ({ error: null })));
    const next = encodeURIComponent("https://psychiatry.tools/auth/callback?next=%2Fdocuments");

    const response = await POST(
      postTo("http://0.0.0.0:8080/auth/confirm", `token_hash=h&type=email&next=${next}`, {
        host: "0.0.0.0:8080",
        "x-forwarded-host": "psychiatry.tools",
        "x-forwarded-proto": "https",
        origin: "https://psychiatry.tools",
      }),
    );

    expect(response.headers.get("location")).toBe("https://psychiatry.tools/documents");
  });

  it("refuses a cross-site post without spending the code", async () => {
    const verifyOtp = vi.fn(async () => ({ error: null }));
    const { POST } = await loadConfirm(verifyOtp);

    for (const headers of [{ origin: "https://evil.example" }, {}] as Array<Record<string, string>>) {
      const response = await POST(confirmPost("token_hash=h&type=email&next=%2Fdocuments", headers));
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("https://clinical.example/documents?auth_error=verify_failed");
    }
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});

describe("/auth/confirm GET (the link a mail scanner may open first)", () => {
  it.each([
    ["recovery", "Continue to reset your password"],
    ["signup", "Continue to confirm your email"],
    ["email", "Continue to sign in"],
    ["magiclink", "Continue to sign in"],
    ["invite", "Continue to accept your invitation"],
    ["email_change", "Continue to confirm your new email address"],
  ])("shows a Continue page for %s without calling verifyOtp", async (type, title) => {
    const verifyOtp = vi.fn(async () => ({ error: null }));
    const { GET } = await loadConfirm(verifyOtp);

    const response = await GET(confirmRequest(`token_hash=hash-1&type=${type}&next=%2Fdocuments`));
    const html = await response.text();

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain('<form method="post" action="/auth/confirm">');
    expect(html).toContain('<input type="hidden" name="token_hash" value="hash-1">');
    expect(html).toContain(`<input type="hidden" name="type" value="${type}">`);
    expect(html).toContain('<button type="submit">Continue</button>');
    // no-referrer would make the browser post `Origin: null`, which the same-origin check refuses.
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(html).not.toContain("<script");
  });

  it("carries the validated next, and the reset page for recovery", async () => {
    const { GET } = await loadConfirm(vi.fn(async () => ({ error: null })));

    const email = await (await GET(confirmRequest("token_hash=h&type=email&next=https%3A%2F%2Fevil.example"))).text();
    const reset = await (await GET(confirmRequest("token_hash=h&type=recovery&next=%2Fdocuments"))).text();

    expect(email).toContain('<input type="hidden" name="next" value="/">');
    expect(reset).toContain('<input type="hidden" name="next" value="/auth/reset-password">');
  });

  it("HTML-escapes the token hash and next", async () => {
    const { GET } = await loadConfirm(vi.fn(async () => ({ error: null })));
    const hostile = encodeURIComponent(`"><script>alert(1)</script>&'`);

    const html = await (
      await GET(confirmRequest(`token_hash=${hostile}&type=email&next=%2Fa%3Fq%3D%22%3E%3Cb%3E`))
    ).text();

    expect(html).not.toContain("<script");
    expect(html).toContain('value="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;&#39;"');
    expect(html).not.toContain('"><b>');
  });

  it.each([
    ["no token hash", "type=email&next=%2Fdocuments"],
    ["no type", "token_hash=h&next=%2Fdocuments"],
    ["an unknown type", "token_hash=h&type=sms&next=%2Fdocuments"],
  ])("still redirects a broken link with %s", async (_label, query) => {
    const { GET } = await loadConfirm(vi.fn(async () => ({ error: null })));

    const response = await GET(confirmRequest(query));

    expect(response.headers.get("location")).toBe("https://clinical.example/documents?auth_error=missing_auth_code");
  });
});
