// tests/api-csrf-premise.test.ts
//
// `apiMutationCsrfVerdict` deliberately ALLOWS a request carrying no Fetch Metadata, no Origin
// and no Referer, on the reasoning that such a request did not come from a browser (curl,
// server-to-server, the ingestion worker), and that `SameSite=Lax` session cookies are what
// actually stop cross-site request forgery. `tests/api-csrf.test.ts:121` pins that behaviour.
//
// The 2026-09-17 external audit flagged it (finding C13), and also that `X-Forwarded-Host` is
// trusted with no allowlist, so a caller setting both that header and a matching `Origin` vouches
// for itself. Checked, and neither is worth a code change today:
//
//   - A browser cannot set `X-Forwarded-Host` on a cross-site fetch; it is not a header script can
//     add without a preflight this app does not grant. Exploiting it needs a non-browser client,
//     which already passes under the rule above.
//   - Railway terminates TLS in front of the app, so the forwarded host IS the host the browser
//     used. Pinning the trusted set to a configured canonical host is possible, but it changes
//     how every production request is judged and cannot be verified from outside that topology.
//
// The administrator upload also supports native bearer clients. Unlike a session cookie, an
// Authorization header is not attached automatically to a cross-site form submission; browser
// fetches that set it need CORS permission. Browser metadata must still be checked for both
// credential forms. Upload therefore applies the shared verdict inside its handler as well as
// through the proxy; private-access-routes.test.ts exercises hostile bearer and cookie requests.
//
// Keep new direct Authorization readers review-visible. The single explicit upload case below
// must retain its route-level rejection before authentication, MFA verification and writes.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const API_ROOT = resolve(process.cwd(), "src/app/api");

/** Handlers CSRF applies to. A GET is not a state change and is out of scope by construction. */
const MUTATION_HANDLER = /export\s+(?:async\s+)?(?:function\s+)?(POST|PUT|PATCH|DELETE)\b/;
const READS_AUTHORIZATION = /headers\s*(?:\.get\(|\[)\s*["'`]authorization["'`]/i;

function routeFiles(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      found.push(...routeFiles(path));
      continue;
    }
    if (entry === "route.ts" || entry === "route.tsx") found.push(path);
  }
  return found;
}

/**
 * Webhooks are exempt in `api-csrf.ts` itself and authenticate by shared secret on purpose: they
 * are called by Railway, never by a browser, and carry no session cookie to forge.
 */
function isWebhook(rel: string): boolean {
  return rel.includes("/webhooks/");
}

describe("the premise the CSRF fallback rests on", () => {
  const routes = routeFiles(API_ROOT).map((path) => ({
    rel: relative(process.cwd(), path).replaceAll("\\", "/"),
    source: readFileSync(path, "utf8"),
  }));

  it("finds the API routes at all", () => {
    // A scan over an empty set passes for ever. If the route tree moves, this fails and someone
    // re-points it, rather than the suite quietly asserting nothing.
    expect(routes.length).toBeGreaterThan(20);
    expect(routes.some(({ source }) => MUTATION_HANDLER.test(source))).toBe(true);
  });

  it("requires explicit route-level CSRF protection for the administrator bearer upload", () => {
    const upload = routes.find(({ rel }) => rel === "src/app/api/upload/route.ts")!.source;
    expect(upload).toContain('import { apiMutationCsrfVerdict } from "@/lib/api-csrf"');
    const handler = upload.indexOf("export async function POST");
    const guard = upload.indexOf("apiMutationCsrfVerdict(request.headers, new URL(request.url).host)", handler);
    const rejection = upload.indexOf('code: "cross_site_forbidden"', guard);
    const auth = upload.indexOf("await requireAuthenticatedUser", handler);
    expect(guard).toBeGreaterThan(handler);
    expect(rejection).toBeGreaterThan(guard);
    expect(rejection).toBeLessThan(auth);
    expect(upload.slice(guard, auth)).toContain("if (!csrf.allowed)");
  });

  it("has no other mutating route that directly reads an Authorization header", () => {
    const offenders = routes
      .filter(({ rel }) => !isWebhook(rel))
      // Upload accepts a native bearer client, verifies recent administrator MFA, and applies
      // the same CSRF verdict in the handler. Its rejection paths are exercised in
      // private-access-routes.test.ts; it is not exempt from the proxy guard.
      .filter(({ rel }) => rel !== "src/app/api/upload/route.ts")
      .filter(({ source }) => MUTATION_HANDLER.test(source) && READS_AUTHORIZATION.test(source))
      .map(({ rel }) => rel);

    expect(
      offenders,
      "A new mutating route directly reads an Authorization header. Review its credential and CSRF " +
        "boundary and prove browser-origin rejection before adding an explicit case. Native bearer " +
        "support must not bypass the proxy or the route-level CSRF guard.",
    ).toEqual([]);
  });

  it("still allows the bare non-browser request it is written to allow", async () => {
    // Pinned here as well as in api-csrf.test.ts so the two halves of the argument sit together:
    // this is only safe WHILE the case above holds.
    const { apiMutationCsrfVerdict } = await import("@/lib/api-csrf");
    expect(apiMutationCsrfVerdict(new Headers(), "psychiatry.tools")).toEqual({ allowed: true });
    expect(apiMutationCsrfVerdict(new Headers({ "sec-fetch-site": "cross-site" }), "psychiatry.tools")).toEqual({
      allowed: false,
      reason: "cross_site",
    });
  });
});
