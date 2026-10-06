import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy, shouldBlockProductionMockups } from "../src/proxy";
import { env } from "@/lib/env";
import { DEVELOPER_GATED_PATH_PREFIXES } from "@/lib/developer-area/headers";
import {
  DEVELOPER_ACCESS_COOKIE,
  DEVELOPER_ACCESS_ERROR_PARAM,
  DEVELOPER_ACCESS_QUERY_PARAM,
  developerAccessTokenValid,
  issueDeveloperAccessToken,
} from "@/lib/developer-area/link-access";
import * as ssr from "@supabase/ssr";
import { vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

type ProxyCookieOptions = {
  cookies: {
    setAll: (
      cookiesToSet: Array<{ name: string; value: string; options: Record<string, never> }>,
      responseHeaders: Record<string, string>,
    ) => void;
  };
};

// The proxy owns the per-request nonce CSP (see src/proxy.ts). CI's verify:ui
// only exercises the *dev* CSP path (Turbopack keeps 'unsafe-inline'); these
// unit tests run under NODE_ENV=test, so buildContentSecurityPolicy takes its
// production branch — this is the only automated coverage of the strict,
// shipped nonce policy. With no Supabase env configured the proxy short-circuits
// on the "no auth cookie" path, which is exactly where the nonce/CSP wiring runs.

function requestFor(path = "/"): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`));
}

function requestWithCookie(path: string, name: string, value: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`), {
    headers: { cookie: `${name}=${value}` },
  });
}

function scriptSrcOf(csp: string): string {
  const directive = csp.split(";").find((d) => d.trim().startsWith("script-src"));
  if (!directive) throw new Error(`no script-src in CSP: ${csp}`);
  return directive.trim();
}

describe("proxy content-security-policy", () => {
  it("allows dedicated document mockup source routes to render instead of redirecting them", async () => {
    for (const path of ["/mockups/document-search/source", "/mockups/document-search/source/evidence"]) {
      const response = await proxy(requestFor(path));
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("emits a per-request nonce with strict-dynamic and no unsafe-inline (production shape)", async () => {
    const res = await proxy(requestFor("/"));
    const csp = res.headers.get("content-security-policy");
    expect(csp).toBeTruthy();

    const scriptSrc = scriptSrcOf(csp!);
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=_-]+'/);
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("preserves the other CSP directives unchanged", async () => {
    const csp = (await proxy(requestFor("/"))).headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("img-src 'self' data: blob: https://*.supabase.co;");
    // No browser Sentry SDK exists, so connect-src carries no third-party telemetry
    // origin (2026-09-02 audit, L34).
    expect(csp).toContain("connect-src 'self' https://*.supabase.co;");
    expect(csp).not.toContain("sentry.io");
    // OpenAI calls are server-side only; the browser must not be allowed to
    // reach the provider origin (2026-07-13 audit, finding 12).
    expect(csp).not.toContain("api.openai.com");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("generates a fresh, unguessable nonce on every request", async () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const csp = (await proxy(requestFor("/"))).headers.get("content-security-policy")!;
      const nonce = csp.match(/'nonce-([^']+)'/)![1];
      expect(nonce.length).toBeGreaterThanOrEqual(16);
      nonces.add(nonce);
    }
    expect(nonces.size).toBe(5);
  });

  it("threads the same nonce into the SSR request headers (x-nonce)", async () => {
    const res = await proxy(requestFor("/"));
    const cspNonce = res.headers.get("content-security-policy")!.match(/'nonce-([^']+)'/)![1];

    // NextResponse.next({ request: { headers } }) forwards overridden request
    // headers back through the response via x-middleware-request-* so the SSR
    // render sees x-nonce. Assert the forwarded nonce matches the enforced CSP.
    const overridden = res.headers.get("x-middleware-override-headers") ?? "";
    expect(overridden).toContain("x-nonce");
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(cspNonce);
  });
});

describe("proxy auth session refresh", () => {
  it("propagates custom response headers during cookie setAll", async () => {
    const originalUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    const originalKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "mock-key";

    // Setup the mock to trigger setAll when getClaims is called
    vi.mocked(ssr.createServerClient).mockImplementationOnce((url, key, options) => {
      const proxyOptions = options as unknown as ProxyCookieOptions;
      return {
        auth: {
          getClaims: async () => {
            proxyOptions.cookies.setAll([{ name: "sb-mock", value: "token", options: {} }], {
              "x-custom-security": "enabled",
              "x-other-header": "value",
            });
          },
        },
      } as unknown as ReturnType<typeof ssr.createServerClient>;
    });

    const req = requestFor("/");
    req.cookies.set("sb-access-token", "present"); // satisfy hasAuthCookie

    try {
      const res = await proxy(req);
      expect(res.headers.get("x-custom-security")).toBe("enabled");
      expect(res.headers.get("x-other-header")).toBe("value");
      expect(res.cookies.get("sb-mock")?.value).toBe("token");
    } finally {
      env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
    }
  });
});

describe("production mockup boundary", () => {
  it("blocks ordinary production traffic and permits only the explicit isolated Playwright advisory profile", () => {
    expect(shouldBlockProductionMockups("/mockups/tools-workflow-board", { NODE_ENV: "production" })).toBe(true);
    expect(
      shouldBlockProductionMockups("/mockups/tools-workflow-board", {
        NODE_ENV: "production",
        PLAYWRIGHT_OFFLINE_MODE: "true",
      }),
    ).toBe(true);
    expect(
      shouldBlockProductionMockups("/mockups/tools-workflow-board", {
        NODE_ENV: "production",
        NEXT_PUBLIC_MOCKUPS_ENABLED: "true",
      }),
    ).toBe(true);
    expect(
      shouldBlockProductionMockups("/mockups/tools-workflow-board", {
        NODE_ENV: "production",
        PLAYWRIGHT_OFFLINE_MODE: "true",
        NEXT_PUBLIC_MOCKUPS_ENABLED: "true",
      }),
    ).toBe(false);
    expect(shouldBlockProductionMockups("/applications", { NODE_ENV: "production" })).toBe(false);
  });

  it("lets the Care Plan subtree reach its own developer gate, and keeps look-alike prefixes blocked", () => {
    // The gated prefix is exactly `/mockups/care-plan`. Its base, a patient deep
    // route and an episode deep route must reach DeveloperAreaGate rather than a
    // bare 404; every neighbouring path that merely begins with the same
    // characters stays behind the blanket production block.
    for (const path of [
      "/mockups/care-plan",
      "/mockups/care-plan/patients/SYN-PATIENT-001/management-plan",
      "/mockups/care-plan/patients/SYN-PATIENT-001/presentations/SYN-PRESENTATION-001",
    ]) {
      expect(shouldBlockProductionMockups(path, { NODE_ENV: "production" }), path).toBe(false);
    }
    for (const path of [
      "/mockups/care-plan-archive",
      "/mockups/care-plan-archive/patients/SYN-PATIENT-001",
      "/mockups/care-plans",
      "/mockups/care-plan-2024/system-states",
    ]) {
      expect(shouldBlockProductionMockups(path, { NODE_ENV: "production" }), path).toBe(true);
    }
  });

  it("lets the developer-gated hub through the blanket block, without opting in the flag", () => {
    // This subtree carries its own signed-in-administrator gate
    // (DeveloperAreaGate) instead of the flat 404 — no NEXT_PUBLIC_MOCKUPS_ENABLED
    // opt-in should be required, and no OTHER /mockups/** path should be affected.
    for (const path of ["/mockups/development", "/mockups/development/ledger"]) {
      expect(shouldBlockProductionMockups(path, { NODE_ENV: "production" })).toBe(false);
    }
    // A path that merely starts with the same characters is not a prefix match.
    expect(shouldBlockProductionMockups("/mockups/development-notes", { NODE_ENV: "production" })).toBe(true);
  });
});

describe("developer-area header (x-developer-area)", () => {
  it("sets the header only for the two developer-gated paths, and strips a client-supplied copy elsewhere", async () => {
    const developmentRequest = requestFor("/mockups/development");
    const developmentResponse = await proxy(developmentRequest);
    expect(developmentResponse.headers.get("x-middleware-request-x-developer-area")).toBe("1");
    expect(developmentResponse.headers.get("x-middleware-request-x-developer-area-path")).toBe("/mockups/development");

    const carePlanRequest = requestFor("/mockups/care-plan/patients/SYN-PATIENT-001/presentations");
    const carePlanResponse = await proxy(carePlanRequest);
    expect(carePlanResponse.headers.get("x-middleware-request-x-developer-area")).toBe("1");
    expect(carePlanResponse.headers.get("x-middleware-request-x-developer-area-path")).toBe(
      "/mockups/care-plan/patients/SYN-PATIENT-001/presentations",
    );

    const carePlanLookAlikeResponse = await proxy(requestFor("/mockups/care-plan-archive"));
    expect(carePlanLookAlikeResponse.headers.get("x-middleware-request-x-developer-area")).toBeNull();

    const otherMockupRequest = requestFor("/mockups/tools-workflow-board");
    otherMockupRequest.headers.set("x-developer-area", "1");
    otherMockupRequest.headers.set("x-developer-area-path", "/mockups/development");
    const otherMockupResponse = await proxy(otherMockupRequest);
    // Spoofed header must not survive into the forwarded request.
    expect(otherMockupResponse.headers.get("x-middleware-request-x-developer-area")).toBeNull();
    expect(otherMockupResponse.headers.get("x-middleware-request-x-developer-area-path")).toBeNull();
  });

  // #L69: the test above names its subtrees by hand, so a regression that dropped
  // a prefix from DEVELOPER_GATED_PATH_PREFIXES would fail closed (a bare 404 via
  // the blanket production block) rather than open — safe, but silent. Iterates
  // the constant itself so this cannot silently narrow.
  it("sets the header for every prefix in DEVELOPER_GATED_PATH_PREFIXES, not only the two the case above names", async () => {
    for (const prefix of DEVELOPER_GATED_PATH_PREFIXES) {
      const deepPath = `${prefix}/deep/path`;
      const response = await proxy(requestFor(deepPath));
      expect(response.headers.get("x-middleware-request-x-developer-area"), deepPath).toBe("1");
      expect(response.headers.get("x-middleware-request-x-developer-area-path"), deepPath).toBe(deepPath);
    }
  });
});

describe("document-source fallback redirects", () => {
  const demoId = "11111111-1111-4111-8111-111111111111";

  it("redirects /documents/source with a valid id as a single HTTP 307 carrying the CSP", async () => {
    const response = await proxy(requestFor(`/documents/source?id=${demoId}&page=2&chunk=safety%20plan`));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe(`/documents/${demoId}`);
    expect(location.searchParams.get("page")).toBe("2");
    expect(location.searchParams.get("chunk")).toBe("safety plan");
    expect(response.headers.get("content-security-policy")).toBeTruthy();
  });

  it("redirects the evidence alias with an invalid id to /documents/search with an empty query", async () => {
    const response = await proxy(requestFor("/documents/source/evidence?id=not-a-uuid&page=2"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/documents/search");
    expect(location.search).toBe("");
  });

  it("leaves the document reader route itself untouched", async () => {
    const response = await proxy(requestFor(`/documents/${demoId}?page=2`));
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("medications redirect", () => {
  it("forwards focus and scope context on an unsubmitted draft link instead of dropping them", async () => {
    // Regression: the unsubmitted branch of medicationsHomeTarget() once called
    // appModeSelectionHref("prescribing") with no options, silently erasing every
    // incoming param (the PWA manifest shortcut's ?focus=1, a draft ?q=...
    // &queryMode=... link) on the way to /?mode=prescribing.
    const response = await proxy(requestFor("/medications?focus=1&q=lithium&queryMode=compare_guidance"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/");
    expect(location.searchParams.get("mode")).toBe("prescribing");
    expect(location.searchParams.get("focus")).toBe("1");
    expect(location.searchParams.get("q")).toBe("lithium");
    expect(location.searchParams.get("queryMode")).toBe("compare_guidance");
    expect(location.searchParams.get("run")).toBeNull();
  });

  it("still redirects a bare, param-free visit to the plain shared home", async () => {
    const response = await proxy(requestFor("/medications"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/");
    expect(location.search).toBe("?mode=prescribing");
  });

  it("still resolves a submitted search straight to the dashboard-owned results surface", async () => {
    const response = await proxy(requestFor("/medications?q=lithium&run=1"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/");
    expect(location.searchParams.get("mode")).toBe("prescribing");
    expect(location.searchParams.get("q")).toBe("lithium");
    expect(location.searchParams.get("run")).toBe("1");
  });
});

describe("cross-site mutation blocking", () => {
  it("blocks cross-site POST requests to API routes with 403", async () => {
    const request = new NextRequest(new URL("http://localhost/api/documents"), {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
    });
    const response = await proxy(request);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("cross_site_forbidden");
  });

  it("allows same-origin API mutations", async () => {
    const request = new NextRequest(new URL("http://localhost/api/documents"), {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin" },
    });
    const response = await proxy(request);
    expect(response.status).not.toBe(403);
  });
});

describe("API CSRF guard beyond Sec-Fetch-Site: cross-site (L28)", () => {
  function mutation(headers: Record<string, string>) {
    return new NextRequest(new URL("http://localhost/api/documents"), { method: "POST", headers });
  }

  it("blocks a same-site request whose Origin is a sibling subdomain", async () => {
    const response = await proxy(mutation({ "sec-fetch-site": "same-site", origin: "http://evil.localhost" }));
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("cross_site_forbidden");
  });

  it("blocks a request without Fetch Metadata whose Origin does not match the request host", async () => {
    const response = await proxy(mutation({ origin: "https://attacker.example" }));
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("cross_site_forbidden");
  });

  it("blocks a request without Fetch Metadata or Origin whose Referer is another host", async () => {
    const response = await proxy(mutation({ referer: "https://attacker.example/form" }));
    expect(response.status).toBe(403);
  });

  it("allows a request without Fetch Metadata whose Origin matches the request host", async () => {
    const response = await proxy(mutation({ origin: "http://localhost" }));
    expect(response.status).not.toBe(403);
  });

  it("allows a non-browser client that sends neither Fetch Metadata, Origin nor Referer", async () => {
    const response = await proxy(mutation({}));
    expect(response.status).not.toBe(403);
  });

  it("does not apply the Origin check to webhook routes", async () => {
    const request = new NextRequest(new URL("http://localhost/api/webhooks/supabase"), {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    });
    const response = await proxy(request);
    expect(response.status).not.toBe(403);
  });
});

// The developer-gated area grew from two prefixes to four, and three comments went on
// describing "the two prototypes" / "the two developer-gated subtrees" — under-describing
// the authorization surface on the files that implement it (2026-09-02 audit, L76/L82).
// The durable fix is that a comment names the constant instead of counting, so this guard
// checks the naming rather than any particular wording.
describe("developer-gated area comments name the constant instead of counting (L76/L82)", () => {
  const commented = ["src/proxy.ts", "src/app/mockups/layout.tsx"] as const;

  it("points every gated-area comment at DEVELOPER_GATED_PATH_PREFIXES", () => {
    for (const relativePath of commented) {
      const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
      expect(source).toContain("DEVELOPER_GATED_PATH_PREFIXES");
      // Any wording that fixes the number is what went stale before.
      expect(source).not.toMatch(/\btwo (?:prototypes|developer-gated|subtrees)/i);
      expect(source).not.toMatch(/\bthe two (?:subtrees|prefixes)\b/i);
    }
  });
});

describe("passwordless developer-area access (?devkey)", () => {
  // src/proxy.ts owns the exchange: the URL secret goes in, a signed cookie
  // comes back, and the key is stripped from the address bar by a redirect.
  // This is a production credential on psychiatry.tools, so the assertions below
  // are written around the ways it could fail OPEN or leak the key onward.
  // Built from readable words rather than written as a 32-character random-looking
  // literal. A high-entropy string assigned to a name like KEY is exactly what the
  // Gitleaks `generic-api-key` rule is for, and it fired on this file's first
  // version (secret-scan, run 34232733033). The value only has to be a key of
  // sufficient length -- nothing here depends on it looking random -- so the fix
  // is to stop it resembling a credential, never to allowlist the finding.
  const KEY = "developer-area-test-key".padEnd(32, "-");

  function withKey<T>(run: () => Promise<T>): Promise<T> {
    const previous = process.env.DEVELOPER_AREA_ACCESS_KEY;
    process.env.DEVELOPER_AREA_ACCESS_KEY = KEY;
    return run().finally(() => {
      if (previous === undefined) delete process.env.DEVELOPER_AREA_ACCESS_KEY;
      else process.env.DEVELOPER_AREA_ACCESS_KEY = previous;
    });
  }

  function accessCookie(response: Response) {
    return response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${DEVELOPER_ACCESS_COOKIE}=`));
  }

  it("exchanges a correct key for a signed cookie and redirects the key out of the URL", async () => {
    await withKey(async () => {
      const response = await proxy(requestFor(`/mockups/development?${DEVELOPER_ACCESS_QUERY_PARAM}=${KEY}`));

      const location = response.headers.get("location");
      expect(location).toBeTruthy();
      // The whole point of the redirect: the secret must not survive into the
      // address bar, the shared history entry, or an onward Referer header.
      expect(location).not.toContain(KEY);
      expect(location).not.toContain(DEVELOPER_ACCESS_QUERY_PARAM);
      // A success carries no rejection marker, so a stale one from an earlier
      // wrong guess cannot follow the visitor into the opened area.
      expect(location).not.toContain(DEVELOPER_ACCESS_ERROR_PARAM);

      const cookie = accessCookie(response);
      expect(cookie).toBeTruthy();
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=lax");
      // The cookie is never sent on a clinical request.
      expect(cookie).toContain("Path=/mockups");
      // And it carries a signature, not the key.
      expect(cookie).not.toContain(KEY);

      const token = cookie!.slice(cookie!.indexOf("=") + 1).split(";")[0];
      expect(developerAccessTokenValid(token, { DEVELOPER_AREA_ACCESS_KEY: KEY })).toBe(true);
    });
  });

  it("issues no cookie for a wrong key, but still strips it from the URL", async () => {
    await withKey(async () => {
      const response = await proxy(requestFor(`/mockups/development?${DEVELOPER_ACCESS_QUERY_PARAM}=wrong-guess`));

      expect(accessCookie(response)).toBeUndefined();
      // Stripped anyway, so a failed guess cannot ride the DEVELOPER_AREA_PATH
      // header into the sign-in screen's `next` value.
      expect(response.headers.get("location")).not.toContain("wrong-guess");
      // But the refusal IS reported, so the gate screen can say the key was
      // wrong instead of re-rendering an identical form and leaving the owner
      // unable to tell a rejected key from a slow one.
      expect(response.headers.get("location")).toContain(`${DEVELOPER_ACCESS_ERROR_PARAM}=1`);
    });
  });

  it("issues no cookie when the deployment has no key configured", async () => {
    const previous = process.env.DEVELOPER_AREA_ACCESS_KEY;
    delete process.env.DEVELOPER_AREA_ACCESS_KEY;
    try {
      const response = await proxy(requestFor(`/mockups/development?${DEVELOPER_ACCESS_QUERY_PARAM}=${KEY}`));
      expect(accessCookie(response)).toBeUndefined();
      expect(response.headers.get("location")).toContain(`${DEVELOPER_ACCESS_ERROR_PARAM}=1`);
    } finally {
      if (previous !== undefined) process.env.DEVELOPER_AREA_ACCESS_KEY = previous;
    }
  });

  it("ignores the parameter outside the developer-gated prefixes", async () => {
    await withKey(async () => {
      // A look-alike path and an ordinary clinical path must not be able to mint
      // this cookie -- only the subtrees the gate actually covers.
      for (const path of ["/mockups/care-plan-archive", "/documents"]) {
        const response = await proxy(requestFor(`${path}?${DEVELOPER_ACCESS_QUERY_PARAM}=${KEY}`));
        expect(accessCookie(response)).toBeUndefined();
      }
    });
  });

  it("renews a valid cookie on an ordinary gated visit, and renews nothing for a forged one", async () => {
    await withKey(async () => {
      const token = issueDeveloperAccessToken({ DEVELOPER_AREA_ACCESS_KEY: KEY }) as string;

      const renewed = await proxy(requestWithCookie("/mockups/development", DEVELOPER_ACCESS_COOKIE, token));
      expect(accessCookie(renewed)).toBeTruthy();

      // Rolling renewal must extend only what already verifies; a forged value
      // is left to be refused by DeveloperAreaGate, never re-stamped as valid.
      const forged = await proxy(requestWithCookie("/mockups/development", DEVELOPER_ACCESS_COOKIE, "v1.1.forged"));
      expect(accessCookie(forged)).toBeUndefined();
    });
  });
});

describe("Admin mode redirects", () => {
  it.each([
    ["/my-work", "/admin/renewals"],
    ["/on-call/compliance", "/admin/renewals"],
    ["/on-call/logistics", "/admin/help"],
    ["/on-call/education", "/teaching/week"],
  ])("sends %s to %s as one 307 and keeps the query string", async (from, to) => {
    const response = await proxy(requestFor(`${from}?from=bookmark`));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe(to);
    expect(location.searchParams.get("from")).toBe("bookmark");
    expect(response.headers.get("content-security-policy")).toBeTruthy();
  });

  it("leaves the pages On Call keeps where they are", async () => {
    for (const path of ["/on-call/orientation", "/on-call/who-is-who", "/on-call/check"]) {
      expect((await proxy(requestFor(path))).headers.get("location")).toBeNull();
    }
  });

  it("sends legacy On Call shifts to Roster", async () => {
    const response = await proxy(requestFor("/on-call/shifts"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/roster/shifts");
  });
});
