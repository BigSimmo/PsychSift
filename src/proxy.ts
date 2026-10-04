import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { appModeHomeHref, appModeSelectionHref } from "@/lib/app-modes";
import { apiMutationCsrfVerdict, isCsrfGuardedApiRequest } from "@/lib/api-csrf";
import { consolidatedModeHomeTarget, unsubmittedModeSearchTarget } from "@/lib/consolidated-mode-home-redirect";
import { documentSourceRedirectTarget, isDocumentSourcePath } from "@/lib/document-source-redirect";
import { env } from "@/lib/env";
import { legacyHomeRedirectUrl } from "@/lib/legacy-home-redirect";
import { DEVELOPER_AREA_HEADER, DEVELOPER_AREA_PATH_HEADER, isDeveloperGatedPath } from "@/lib/developer-area/headers";
import {
  DEVELOPER_ACCESS_COOKIE,
  DEVELOPER_ACCESS_COOKIE_MAX_AGE_SECONDS,
  DEVELOPER_ACCESS_COOKIE_PATH,
  DEVELOPER_ACCESS_ERROR_PARAM,
  DEVELOPER_ACCESS_QUERY_PARAM,
  developerAccessKeyMatches,
  developerAccessTokenValid,
  issueDeveloperAccessToken,
} from "@/lib/developer-area/link-access";
import { readSearchNavigationContext } from "@/lib/search-navigation-context";
import { buildContentSecurityPolicy, resolveRuntimeFlags } from "@/lib/security-headers";
import { signProxyAuthPayload } from "@/lib/supabase/proxy-auth-crypto";

export const PROXY_AUTH_USER_HEADER = "x-proxy-auth-user";

// Next 16 renamed the `middleware` file convention to `proxy` (see
// node_modules/next/dist/docs/.../file-conventions/proxy.md). Proxy defaults to
// the Node.js runtime, which the Supabase client requires.
//
// Two jobs:
//   1. Content-Security-Policy nonce. A fresh per-request nonce is generated and
//      threaded into the SSR request (`x-nonce` + the CSP header, which Next.js
//      parses to stamp its framework/bundle scripts) and onto the response so the
//      browser enforces it. This is why the CSP header lives here and not in
//      next.config.ts: a nonce cannot be a build-time constant. Using a nonce
//      opts pages into dynamic rendering (app/layout.tsx reads the nonce), which
//      is inherent to nonce-based CSP.
//   2. Session refresh. Keep the user's @supabase/ssr session cookie fresh on
//      page navigations so persistent logins survive refreshes. It is a no-op
//      unless the public Supabase env is configured AND an `sb-` auth cookie is
//      present, so demo / local-no-auth traffic is untouched. Cookie-authenticated
//      API requests still pass through this refresh path because route handlers
//      cannot write rotated SSR cookies back to the browser themselves.

/**
 * Retired paths that forward, query string intact, to the surface that replaced
 * them. Resolved here as one 307 rather than left to the page's own
 * `redirect()`, which under the streaming `(search-app)` layout emits a
 * client-side meta refresh — a second of empty shell. Each page keeps its
 * redirect as a backstop for anything the matcher misses.
 */
const staticRouteRedirects: Record<string, string> = {
  // Dictionary's Search and Browse were one catalogue behind two destinations
  // and are now one route; `view`, `letter`, `topic` and `kind` mean the same
  // thing there, so the query string travels unchanged.
  "/dictionary/browse": "/dictionary/search",
  // My shifts moved from On Call into its own Roster mode. Old bookmarks and
  // deep links keep working; old APIs re-export the new ones instead (see
  // `src/app/api/on-call/shifts/route.ts`).
  "/on-call/shifts": "/roster/shifts",
  "/on-call/calendar": "/roster/calendar",
  // The one mockup path that still redirects in production rather than 404ing
  // through `shouldBlockProductionMockups`. `mockups/README.md`, `docs/site-map.md`
  // and the site-map GENERATOR (`scripts/generate-site-map.ts`, which hardcodes the
  // sentence) all name this route by hand, so `sitemap:check` cannot notice the entry
  // going away. Retiring it means moving all four together.
  "/mockups/document-search-command": "/documents/search",
  // Keep the existing On Call teaching records reachable until a service approves transfer.
  // Admin mode, update 1 (2026-09-26). My Work became Admin and its home moved to
  // `/admin`; the two On Call pages Admin received moved with it. The query string
  // travels, and the browser keeps a `#on-call-entry-<id>` fragment across the 307,
  // so a bookmarked row still lands on its anchor. Admin adds redirects only for
  // the pages it received (spec); Roster's PR adds its own beside these.
  "/my-work": "/admin/renewals",
  "/on-call/compliance": "/admin/renewals",
  "/on-call/logistics": "/admin/help",
};

/**
 * Where `/medications` forwards — a fast-path mirror of the two branches in
 * `src/app/(search-app)/medications/page.tsx`.
 *
 * Medication is consolidated the same way as the modes `consolidatedModeHomeTarget`
 * covers below, but is deliberately kept OUT of that shared map: there is no
 * `/medications/search` route, so the map's generic `${pathname}/search`
 * submitted-target logic would send a submitted medication search to a page that
 * doesn't exist. Medication's submitted search already resolves correctly today,
 * straight to the dashboard-owned `/?mode=prescribing&q=…&run=1` surface — this
 * only adds the missing unsubmitted branch, resolved here for the same reason as
 * every other redirect in this file: a page-level `redirect()` under the
 * streaming `(search-app)` layout emits a client-side meta refresh (a second of
 * empty shell) instead of a 307. `medications/page.tsx` keeps its own redirect as
 * a backstop, built from the exact same `appModeHomeHref`/`appModeSelectionHref`
 * calls used here, so the fast path and the backstop can never disagree.
 *
 * Fully additive: this touches nothing `consolidatedModeHomeTarget` or
 * `unsubmittedModeSearchTarget` read or export, so it carries zero risk to the
 * modes already using that shared mechanism.
 */
function medicationsHomeTarget(pathname: string, search: URLSearchParams): string | null {
  if (pathname !== "/medications") return null;

  const params = new URLSearchParams(search);
  const query = (params.get("q")?.trim() || params.get("query")?.trim()) ?? "";
  const focus = params.get("focus") === "1";
  const submitted = query.length > 0 && params.get("run") === "1";
  const navigationContext = readSearchNavigationContext(params);

  if (!submitted) {
    // A draft link (e.g. the PWA shortcut's `?focus=1`, or a query typed but not
    // yet run) still carries navigation context that must survive the redirect —
    // dropping it here previously erased `focus` and scope context on links like
    // the manifest shortcut and `?q=…&queryMode=…` drafts.
    return appModeSelectionHref("prescribing", {
      query,
      focus,
      queryMode: navigationContext.queryMode,
      scopeFilters: navigationContext.scopeFilters,
      scopeRef: navigationContext.scopeRef,
    });
  }

  return appModeHomeHref("prescribing", {
    query,
    focus,
    run: true,
    queryMode: navigationContext.queryMode,
    scopeFilters: navigationContext.scopeFilters,
    scopeRef: navigationContext.scopeRef,
  });
}

const publicPwaPaths = new Set(["/sw.js", "/offline.html", "/manifest.webmanifest", "/apple-icon", "/icon.svg"]);

export function isPublicPwaPath(pathname: string) {
  return publicPwaPaths.has(pathname) || pathname.startsWith("/icons/");
}

// Same runtime flags next.config.ts uses for the static headers, so the nonce'd
// CSP matches the rest of the policy (unsafe-eval in dev, HTTPS upgrade off local
// http). Evaluated once at module load.
const { isDevelopment, isLocalHttpRuntime } = resolveRuntimeFlags();

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // PWA bootstrap assets are public and deliberately independent from a user's
  // auth session. Let next.config.ts apply their stable resource-specific headers
  // without generating a page nonce or refreshing Supabase cookies.
  if (isPublicPwaPath(pathname)) return NextResponse.next();

  // A fresh, unguessable nonce per request (see Next.js CSP guide). Buffer+base64
  // matches the documented pattern and keeps the value header-safe.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildContentSecurityPolicy({ isDevelopment, isLocalHttpRuntime, nonce });

  if (request.nextUrl.pathname === "/api/upload") {
    const declaredLength = Number(request.headers.get("content-length"));
    const uploadEnvelopeBytes = env.MAX_UPLOAD_MB * 1024 * 1024 + 1024 * 1024;
    if (Number.isFinite(declaredLength) && declaredLength > uploadEnvelopeBytes) {
      const response = NextResponse.json(
        { error: "Upload request is too large.", code: "payload_too_large" },
        { status: 413 },
      );
      response.headers.set("content-security-policy", csp);
      response.headers.set("cache-control", "private, no-store");
      return response;
    }
  }

  // Fetch Metadata plus an Origin/Referer host check (see `@/lib/api-csrf` for why
  // `Sec-Fetch-Site: cross-site` alone is not enough).
  if (isCsrfGuardedApiRequest(request.method, pathname)) {
    const verdict = apiMutationCsrfVerdict(request.headers, request.nextUrl.host);
    if (!verdict.allowed) {
      const response = NextResponse.json(
        { error: "Cross-site request blocked.", code: "cross_site_forbidden" },
        { status: 403 },
      );
      response.headers.set("content-security-policy", csp);
      return response;
    }
  }

  // Request headers Next.js reads during SSR: `x-nonce` for our own inline
  // <script>, and the CSP header from which Next extracts the nonce for its
  // scripts. Rebuilt from the *current* request each call so session-cookie
  // mutations below still propagate to the render.
  const requestHeadersWithNonce = (authenticatedUserHeader?: string | null) => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("content-security-policy", csp);
    // Untrusted: strip unconditionally so a client cannot set this header itself
    // and spoof past the parent `/mockups` layout's production gate on a route
    // that is not actually one of the developer-gated subtrees listed in
    // DEVELOPER_GATED_PATH_PREFIXES. Deliberately not re-listed here: the
    // enumeration went stale when a fourth prefix was added and the comment was
    // not (2026-09-02 audit, L76). Read the constant.
    headers.delete(DEVELOPER_AREA_HEADER);
    headers.delete(DEVELOPER_AREA_PATH_HEADER);
    headers.delete(PROXY_AUTH_USER_HEADER);
    if (isDeveloperGatedPath(pathname)) {
      headers.set(DEVELOPER_AREA_HEADER, "1");
      headers.set(DEVELOPER_AREA_PATH_HEADER, `${pathname}${request.nextUrl.search}`);
    }
    if (authenticatedUserHeader) {
      headers.set(PROXY_AUTH_USER_HEADER, authenticatedUserHeader);
    }
    return headers;
  };
  // Rolling renewal of the passwordless developer-area cookie. Browsers clamp
  // `Set-Cookie` lifetimes to roughly 400 days, so a cookie issued once would
  // quietly expire and put the sign-in screen back in front of the owner about a
  // year later — the exact outcome this feature exists to prevent. Re-stamping it
  // on every verified visit means a device used at least once a year never needs
  // the link again. It renews only what already verifies: an absent, expired, or
  // forged cookie yields null here and falls through to `DeveloperAreaGate`.
  const developerAccessRenewal =
    isDeveloperGatedPath(pathname) && developerAccessTokenValid(request.cookies.get(DEVELOPER_ACCESS_COOKIE)?.value)
      ? issueDeveloperAccessToken()
      : null;

  // Every response the browser sees must carry the enforced CSP header — and, on
  // a gated path held open by a valid access cookie, the renewed cookie. Stamped
  // here rather than on one early-returned response so the renewal cannot skip
  // the Supabase session refresh below: an administrator who is ALSO using the
  // link must keep having their session cookie rotated like everyone else.
  const withCsp = (response: NextResponse) => {
    response.headers.set("content-security-policy", csp);
    if (developerAccessRenewal) setDeveloperAccessCookie(response, developerAccessRenewal, request);
    return response;
  };

  // `?devkey=…` exchanges the secret for the long-lived signed cookie and
  // redirects with it removed, so the key never lingers in the address bar, in
  // shared history, or in an onward Referer header. This must run before
  // compatibility redirects, which otherwise preserve the query string and
  // could forward the secret to their target.
  if (isDeveloperGatedPath(pathname) && request.nextUrl.searchParams.has(DEVELOPER_ACCESS_QUERY_PARAM)) {
    const presented = request.nextUrl.searchParams.get(DEVELOPER_ACCESS_QUERY_PARAM);
    const url = request.nextUrl.clone();
    url.searchParams.delete(DEVELOPER_ACCESS_QUERY_PARAM);
    const redirectTarget = staticRouteRedirects[pathname];
    if (redirectTarget) url.pathname = redirectTarget;
    const token = developerAccessKeyMatches(presented) ? issueDeveloperAccessToken() : null;
    // Say so when the secret did not verify. Without this the redirect is
    // byte-identical to a success the browser has not finished acting on, and a
    // mistyped key looks exactly like a working one — the gate screen simply
    // reappears. The marker carries no secret: it is a verdict on a value its
    // reader has just typed. It is removed on success so a stale rejection from
    // an earlier attempt cannot ride along into the opened area.
    url.searchParams.delete(DEVELOPER_ACCESS_ERROR_PARAM);
    if (!token) url.searchParams.set(DEVELOPER_ACCESS_ERROR_PARAM, "1");
    const response = withCsp(NextResponse.redirect(url));
    if (token) setDeveloperAccessCookie(response, token, request);
    return response;
  }

  const legacyHomeTarget = legacyHomeRedirectUrl(request.nextUrl, request.method);
  if (legacyHomeTarget) return withCsp(NextResponse.redirect(legacyHomeTarget));

  const redirectTarget = staticRouteRedirects[pathname];

  if (redirectTarget) {
    const url = request.nextUrl.clone();
    url.pathname = redirectTarget;
    return withCsp(NextResponse.redirect(url));
  }

  // Issue #024: resolve the document-source fallbacks here as a single HTTP 307
  // instead of letting the page's server redirect() stream a 200 whose redirect
  // completes client-side through an `_rsc` navigation — WebKit raises
  // access-control pageerrors on that chain. The target is rebuilt from
  // sanitised components of this request's own query, so it cannot become an
  // open redirect. The page remains as a backstop for any request the matcher
  // misses.
  // Consolidated mode homes: every mode but Favourites, Tools and Medication now
  // shares one home, so its bare path forwards — to `/?mode=<id>` unsubmitted, or
  // to `<mode>/search` when the link carries a submitted query (or, for Sources, a
  // catalogue filter key, which is shareable without `run=1`). Resolved here for
  // the same reason as the document-source fallbacks below — a page `redirect()`
  // under the streaming `(search-app)` layout emits a client-side meta refresh (a
  // full second of empty shell) rather than a 307. The page keeps its own redirect
  // as a backstop for anything this misses.
  const consolidatedHomeTarget = consolidatedModeHomeTarget(pathname, request.nextUrl.searchParams);

  if (consolidatedHomeTarget) {
    const url = request.nextUrl.clone();
    const [targetPathname, targetSearch = ""] = consolidatedHomeTarget.split("?");
    url.pathname = targetPathname;
    url.search = targetSearch;
    return withCsp(NextResponse.redirect(url));
  }

  // Medication (`/medications`): consolidated the same way, but via its own
  // bespoke resolver above rather than the `consolidatedModeHomePaths` map — see
  // `medicationsHomeTarget`'s doc comment for why.
  const medicationsTarget = medicationsHomeTarget(pathname, request.nextUrl.searchParams);

  if (medicationsTarget) {
    const url = request.nextUrl.clone();
    const [targetPathname, targetSearch = ""] = medicationsTarget.split("?");
    url.pathname = targetPathname;
    url.search = targetSearch;
    return withCsp(NextResponse.redirect(url));
  }

  // The same forward for an unsubmitted `<mode>/search`: those four routes have no
  // browse view, so an empty query would render the retired mode home a second time.
  const unsubmittedSearchTarget = unsubmittedModeSearchTarget(pathname, request.nextUrl.searchParams);

  if (unsubmittedSearchTarget) {
    const url = request.nextUrl.clone();
    const [targetPathname, targetSearch = ""] = unsubmittedSearchTarget.split("?");
    url.pathname = targetPathname;
    url.search = targetSearch;
    return withCsp(NextResponse.redirect(url));
  }

  if (isDocumentSourcePath(pathname)) {
    const url = request.nextUrl.clone();
    const target = documentSourceRedirectTarget(url.searchParams);
    const [targetPathname, targetSearch = ""] = target.split("?");
    url.pathname = targetPathname;
    url.search = targetSearch;
    return withCsp(NextResponse.redirect(url));
  }

  if (shouldBlockProductionMockups(pathname)) {
    return withCsp(new NextResponse(null, { status: 404 }));
  }

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const hasAuthCookie = request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-"));
  if (!url || !key || !hasAuthCookie) {
    return withCsp(NextResponse.next({ request: { headers: requestHeadersWithNonce() } }));
  }

  let userHeaderValue: string | null = null;
  let response = NextResponse.next({ request: { headers: requestHeadersWithNonce() } });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, responseHeaders) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers: requestHeadersWithNonce(userHeaderValue) } });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(responseHeaders)) response.headers.set(name, value);
      },
    },
  });

  // Refresh the session. Per @supabase/ssr guidance, do not run other logic
  // between createServerClient and getClaims — a stale token here would sign the
  // user out on the next request.
  const claimsResult = await supabase.auth.getClaims();
  const claims = claimsResult?.data?.claims;
  if (claims && typeof claims === "object" && typeof claims.sub === "string" && claims.sub) {
    const userPayload = {
      id: claims.sub,
      appMetadata:
        claims.app_metadata && typeof claims.app_metadata === "object"
          ? (claims.app_metadata as Record<string, unknown>)
          : {},
    };
    const rawPayload = Buffer.from(JSON.stringify(userPayload), "utf8").toString("base64");
    userHeaderValue = signProxyAuthPayload(rawPayload);
    const previousResponse = response as NextResponse | null;
    const previousCookies = previousResponse?.cookies.getAll() ?? [];
    const previousHeaders = previousResponse ? new Headers(previousResponse.headers) : new Headers();
    const refreshedResponse = NextResponse.next({ request: { headers: requestHeadersWithNonce(userHeaderValue) } });
    for (const [k, v] of previousHeaders.entries()) {
      // `Headers.entries()` does not reliably preserve Set-Cookie attributes.
      // Re-apply cookies through the cookie store after this copy instead.
      if (k.toLowerCase() === "set-cookie") continue;
      refreshedResponse.headers.set(k, v);
    }
    for (const cookie of previousCookies) {
      refreshedResponse.cookies.set(cookie);
    }
    response = refreshedResponse;
  }
  return withCsp(response ?? NextResponse.next({ request: { headers: requestHeadersWithNonce() } }));
}

/**
 * Writes the developer-area access cookie onto a response.
 *
 * `secure` is derived from the request's own protocol rather than pinned true:
 * a local `http://` dev server must be able to hold the cookie too, and a
 * `Secure` cookie set over http is silently dropped by the browser. Every real
 * deployment is https, so this is https in practice.
 */
function setDeveloperAccessCookie(response: NextResponse, token: string, request: NextRequest) {
  response.cookies.set(DEVELOPER_ACCESS_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: DEVELOPER_ACCESS_COOKIE_PATH,
    maxAge: DEVELOPER_ACCESS_COOKIE_MAX_AGE_SECONDS,
  });
}

export function shouldBlockProductionMockups(
  pathname: string,
  environment: Record<string, string | undefined> = process.env,
) {
  if (!pathname.startsWith("/mockups") || environment.NODE_ENV !== "production") return false;

  // Every subtree listed in DEVELOPER_GATED_PATH_PREFIXES carries its own
  // signed-in-administrator gate (`DeveloperAreaGate`, applied in each subtree's
  // layout via the x-developer-area header set above), so let them through this
  // blanket block and let that gate run instead of a bare 404. The prefixes are
  // named once, in `src/lib/developer-area/headers.ts`, and not re-listed here:
  // this comment kept naming a smaller set for months after a fourth prefix was
  // added (2026-09-02 audit, L76). The match is exact-or-slash, so a look-alike path
  // such as `/mockups/care-plan-archive` is NOT let through. Every other
  // /mockups/** path is unaffected.
  if (isDeveloperGatedPath(pathname)) return false;

  // Mockups remain unavailable in every normal production process. The one
  // exception is the repository-owned, isolated Playwright server when its
  // advisory project explicitly opts into mockup coverage. Instrumentation
  // separately refuses PLAYWRIGHT_OFFLINE_MODE outside the inert loopback and
  // isolated .next-playwright profile.
  return !(environment.PLAYWRIGHT_OFFLINE_MODE === "true" && environment.NEXT_PUBLIC_MOCKUPS_ENABLED === "true");
}

export const config = {
  // API routes always run through the proxy, even when the last path segment
  // looks like a static image. Extension skips apply only to non-API assets.
  matcher: [
    "/api/:path*",
    "/((?!api(?:/|$)|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
