import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "../src/proxy";
import { proxyVerifiedLaunchUser } from "@/lib/work-mode-launch/server";

vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));

function requestFor(path: string, cookie?: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`), cookie ? { headers: { cookie } } : undefined);
}

function rewrittenTo(response: Response): string | null {
  const target = response.headers.get("x-middleware-rewrite");
  return target ? new URL(target).pathname : null;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy work-mode launch gate", () => {
  it("serves new-only screens while the work mode is launched (test default)", async () => {
    expect(rewrittenTo(await proxy(requestFor("/admin/pay")))).toBeNull();
  });

  it("404s new-only screens when the launch is off, and leaves existing screens", async () => {
    vi.stubEnv("WORK_MODE_LAUNCH", "off");
    expect(rewrittenTo(await proxy(requestFor("/admin/pay")))).toBe("/_work-mode-not-launched");
    expect(rewrittenTo(await proxy(requestFor("/admin/compliance")))).toBeNull();
    const hidden = await proxy(requestFor("/admin/pay"));
    expect(hidden.headers.get("content-security-policy")).toContain("script-src");
  });

  it("honours the device's classic preference instantly", async () => {
    const response = await proxy(requestFor("/cme/applications", "psychsift-work-mode=classic"));
    expect(rewrittenTo(response)).toBe("/_work-mode-not-launched");
  });
});

describe("proxyVerifiedLaunchUser", () => {
  it("treats a missing, unsigned or forged header as signed out", () => {
    expect(proxyVerifiedLaunchUser(null)).toBeNull();
    const forged = Buffer.from(JSON.stringify({ id: "x", appMetadata: { site_role: "administrator" } })).toString(
      "base64",
    );
    expect(proxyVerifiedLaunchUser(forged)).toBeNull();
    expect(proxyVerifiedLaunchUser(`${forged}.${Math.floor(Date.now() / 1000)}.bad`)).toBeNull();
  });
});

describe("proxyVerifiedLaunchUser with a signing key", () => {
  it("reads the id and app metadata the proxy signed", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key-for-signing-only");
    const { signProxyAuthPayload } = await import("@/lib/supabase/proxy-auth-crypto");
    const payload = Buffer.from(JSON.stringify({ id: "u1", appMetadata: { site_role: "administrator" } })).toString(
      "base64",
    );
    const signed = signProxyAuthPayload(payload);
    expect(proxyVerifiedLaunchUser(signed)).toEqual({ id: "u1", appMetadata: { site_role: "administrator" } });
  });
});
