import { describe, expect, it } from "vitest";

import {
  DEVELOPER_ACCESS_COOKIE_MAX_AGE_SECONDS,
  DEVELOPER_ACCESS_ERROR_PARAM,
  developerAccessKeyMatches,
  developerKeyUnlockUrl,
  parseDeveloperGateTarget,
  developerAccessTokenValid,
  issueDeveloperAccessToken,
  resolveDeveloperAccessKey,
} from "../src/lib/developer-area/link-access";

// The passwordless route into the developer-gated /mockups subtrees. It is a
// real production credential on psychiatry.tools -- the thing standing between
// an unauthenticated visitor and the task ledger, the hazard notes, and the Care
// Plan prototype -- so every way it could fail
// OPEN is asserted here, not just the happy path.

// Built from readable words rather than written as a 32-character random-looking
// literal. A high-entropy string assigned to a name like KEY is exactly what the
// Gitleaks `generic-api-key` rule is for, and it fired on this file's first
// version (secret-scan, run 34232733033). The value only has to be a key of
// sufficient length -- nothing here depends on it looking random -- so the fix
// is to stop it resembling a credential, never to allowlist the finding.
const KEY = "developer-area-test-key".padEnd(32, "-"); // exactly the 32-character floor
const OTHER_KEY = "developer-area-other-key".padEnd(32, "-");
const configured = { DEVELOPER_AREA_ACCESS_KEY: KEY };

describe("resolveDeveloperAccessKey", () => {
  it("returns the trimmed key when configured at sufficient length", () => {
    expect(resolveDeveloperAccessKey({ DEVELOPER_AREA_ACCESS_KEY: `  ${KEY}  ` })).toBe(KEY);
  });

  it("treats an unset, blank, or under-strength key as unconfigured", () => {
    expect(resolveDeveloperAccessKey({})).toBeNull();
    expect(resolveDeveloperAccessKey({ DEVELOPER_AREA_ACCESS_KEY: "   " })).toBeNull();
    // One character short of the floor. A weak secret in a URL must be refused
    // outright rather than accepted as "better than nothing".
    expect(resolveDeveloperAccessKey({ DEVELOPER_AREA_ACCESS_KEY: KEY.slice(0, 31) })).toBeNull();
  });
});

describe("issueDeveloperAccessToken", () => {
  it("mints a verifiable token under the configured key", () => {
    const token = issueDeveloperAccessToken(configured);
    expect(token).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]+$/);
    expect(developerAccessTokenValid(token, configured)).toBe(true);
  });

  it("mints nothing when no key is configured, rather than an unsigned token", () => {
    expect(issueDeveloperAccessToken({})).toBeNull();
    expect(issueDeveloperAccessToken({ DEVELOPER_AREA_ACCESS_KEY: "too-short" })).toBeNull();
  });
});

describe("developerAccessTokenValid", () => {
  it("rejects a token signed under a different key (rotation revokes every device)", () => {
    const token = issueDeveloperAccessToken(configured);
    expect(developerAccessTokenValid(token, { DEVELOPER_AREA_ACCESS_KEY: OTHER_KEY })).toBe(false);
  });

  it("rejects a tampered signature and a tampered issue time", () => {
    const now = 1_760_000_000_000;
    const token = issueDeveloperAccessToken(configured, now) as string;
    const [version, issuedAt, signature] = token.split(".");

    expect(developerAccessTokenValid(`${version}.${issuedAt}.${signature}x`, configured, now)).toBe(false);
    // Re-dating a genuine token is the attack the signature covers the issue
    // time for: without it, an expired cookie could be renewed by its holder.
    expect(developerAccessTokenValid(`${version}.${Number(issuedAt) + 10}.${signature}`, configured, now)).toBe(false);
  });

  it("rejects malformed, empty, and wrong-version values", () => {
    for (const value of ["", "v1", "v1.123", "v2.123.sig", "...", "v1..sig", "v1.notanumber.sig"]) {
      expect(developerAccessTokenValid(value, configured)).toBe(false);
    }
    expect(developerAccessTokenValid(undefined, configured)).toBe(false);
    expect(developerAccessTokenValid(null, configured)).toBe(false);
  });

  it("rejects every token when no key is configured (fail closed)", () => {
    const token = issueDeveloperAccessToken(configured);
    expect(developerAccessTokenValid(token, {})).toBe(false);
  });

  it("enforces the expiry server-side, not by trusting the browser to drop the cookie", () => {
    const issuedAt = 1_760_000_000_000;
    const token = issueDeveloperAccessToken(configured, issuedAt) as string;
    const justInside = issuedAt + (DEVELOPER_ACCESS_COOKIE_MAX_AGE_SECONDS - 60) * 1000;
    const justOutside = issuedAt + (DEVELOPER_ACCESS_COOKIE_MAX_AGE_SECONDS + 60) * 1000;

    expect(developerAccessTokenValid(token, configured, justInside)).toBe(true);
    expect(developerAccessTokenValid(token, configured, justOutside)).toBe(false);
  });

  it("rejects a token stamped far in the future", () => {
    const now = 1_760_000_000_000;
    const postDated = issueDeveloperAccessToken(configured, now + 86_400_000) as string;
    expect(developerAccessTokenValid(postDated, configured, now)).toBe(false);
  });
});

describe("developerAccessKeyMatches", () => {
  it("accepts the exact configured key and nothing else", () => {
    expect(developerAccessKeyMatches(KEY, configured)).toBe(true);
    expect(developerAccessKeyMatches(OTHER_KEY, configured)).toBe(false);
    // A prefix must not pass: the comparison is length-checked before the
    // constant-time compare, so a truncated guess cannot match.
    expect(developerAccessKeyMatches(KEY.slice(0, 20), configured)).toBe(false);
  });

  it("matches nothing when unconfigured, including the empty string", () => {
    expect(developerAccessKeyMatches(KEY, {})).toBe(false);
    expect(developerAccessKeyMatches("", {})).toBe(false);
    expect(developerAccessKeyMatches(undefined, configured)).toBe(false);
  });
});

// The client-safe half of the credential: the URL shape the gate screen's key
// field submits, and the verdict it reads back. These run in a Client Component,
// so they are asserted here against `link-access-shared.ts` directly -- the
// module `link-access.ts` re-exports rather than re-declares.
describe("parseDeveloperGateTarget", () => {
  it("returns the requested path unchanged when no rejection marker is present", () => {
    expect(parseDeveloperGateTarget("/admin/developer-hub/ledger")).toEqual({
      target: "/admin/developer-hub/ledger",
      keyRejected: false,
    });
  });

  it("reports the proxy's rejection and strips the marker from the retry target", () => {
    expect(parseDeveloperGateTarget(`/admin/developer-hub?${DEVELOPER_ACCESS_ERROR_PARAM}=1`)).toEqual({
      target: "/admin/developer-hub",
      keyRejected: true,
    });
  });

  it("keeps the page's own query while removing only the marker", () => {
    expect(parseDeveloperGateTarget(`/admin/developer-hub?tab=risk&${DEVELOPER_ACCESS_ERROR_PARAM}=1`)).toEqual({
      target: "/admin/developer-hub?tab=risk",
      keyRejected: true,
    });
  });

  it("falls back to the area root for anything outside the gated subtrees", () => {
    // `next` arrives in a request header, and the target built from it is handed
    // to location.replace carrying the typed secret. A value that escapes to
    // another origin does not merely redirect — it posts the key to whoever owns
    // that origin.
    const hostile = [
      "//evil.example/admin/developer-hub",
      "https://evil.example",
      "mockups/development",
      "",
      // Browsers normalise `\\` to `/` for special schemes and strip tab, CR and
      // LF before parsing, so every one of these defeated the old
      // `startsWith("//")` denylist and resolved to https://evil.example/. The
      // allowlist is what closes them; these four are the regression.
      String.raw`/\evil.example`,
      "/\tevil.example",
      "/\nevil.example",
      "/\revil.example",
      // Look-alike prefixes are not members of the allowlist either.
      "/admin/developer-hub-archive",
      "/documents",
      "/mockups",
    ];
    for (const value of hostile) {
      expect(parseDeveloperGateTarget(value).target).toBe("/admin/developer-hub");
    }
    expect(parseDeveloperGateTarget(null).target).toBe("/admin/developer-hub");
  });

  it("refuses to carry a rejected path's query string over to the fallback", () => {
    // Dropping the path but keeping its query would let a hostile `next` still
    // steer the page it lands on.
    expect(parseDeveloperGateTarget("https://evil.example/?tab=risk")).toEqual({
      target: "/admin/developer-hub",
      keyRejected: false,
    });
  });

  it("admits every gated subtree, and their descendants", () => {
    for (const allowed of ["/admin/developer-hub", "/admin/developer-hub/ledger"]) {
      expect(parseDeveloperGateTarget(allowed).target).toBe(allowed);
    }
  });
});

describe("developerKeyUnlockUrl", () => {
  it("attaches the typed key to the page the visitor asked for", () => {
    const url = developerKeyUnlockUrl("/admin/developer-hub", KEY);
    expect(url).toBe(`/admin/developer-hub?devkey=${encodeURIComponent(KEY)}`);
  });

  it("preserves the page's own query parameters alongside the key", () => {
    const url = new URL(developerKeyUnlockUrl("/admin/developer-hub?tab=risk", KEY), "https://psychiatry.tools");
    expect(url.pathname).toBe("/admin/developer-hub");
    expect(url.searchParams.get("tab")).toBe("risk");
    expect(url.searchParams.get("devkey")).toBe(KEY);
  });

  it("does not carry a previous attempt's rejection marker into the retry", () => {
    const url = developerKeyUnlockUrl(`/admin/developer-hub?${DEVELOPER_ACCESS_ERROR_PARAM}=1`, KEY);
    expect(url).not.toContain(DEVELOPER_ACCESS_ERROR_PARAM);
  });

  it("escapes the key rather than letting it alter the URL's shape", () => {
    // A mistyped key containing `&` or `#` must stay one parameter value, not
    // become a second parameter or a fragment that silently truncates it.
    const url = new URL(developerKeyUnlockUrl("/admin/developer-hub", "a&b=c#d"), "https://psychiatry.tools");
    expect(url.searchParams.get("devkey")).toBe("a&b=c#d");
  });
});
