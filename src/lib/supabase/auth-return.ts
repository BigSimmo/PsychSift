import type { SetAllCookies } from "@supabase/ssr";
import { NextResponse } from "next/server";

import { isPasswordResetPath, PASSWORD_RECOVERY_COOKIE } from "@/lib/supabase/password-recovery-authorization";

// Shared by the two routes an auth email or provider returns to: /auth/callback (PKCE `?code=`)
// and /auth/confirm (`?token_hash=`). Both must send the browser to the same place, refuse the
// same open redirects and carry the same session cookies, so the rules live here once.

/**
 * The origin to send the browser back to.
 *
 * 🔴 **NOT `new URL(request.url).origin` — THAT IS THE ADDRESS THIS SERVER BOUND TO, NOT THE HOST
 * THE BROWSER ASKED FOR, AND READING THE CODE WILL NOT TELL YOU SO.** Measured 2026-09-07 against
 * this project's live `next dev` on port 4215:
 *
 *     curl -s -D - http://localhost:4215/auth/callback
 *     location: http://0.0.0.0:4215/?auth_error=missing_auth_code
 *
 * Next builds `request.url` as `${protocol}://${routerServerContext?.hostname}${req.url}`
 * (`node_modules/next/dist/server/route-modules/route-module.js:384`) unless
 * `experimental.trustHostHeader` is set, which `next.config.ts` does not set. The dev server binds
 * `0.0.0.0` and the container runs `next start -H 0.0.0.0`, so the hostname is `0.0.0.0` in both.
 * Every redirect out of this route — the success path and all five failure paths — therefore sent
 * the browser to an address it cannot open.
 *
 * ⚠️ **DELIBERATELY NOT `resolveMetadataBase()`, THOUGH IT PARSES THE SAME HEADERS.** That helper
 * answers a different question and carries a stance that is right there and wrong here:
 * `src/app/layout.tsx:79-88` hands it an empty `Headers()` in production with
 * `allowRequestOrigin: false`, and `tests/production-metadata-source.test.ts:43-51` pins that as
 * "does not trust request-controlled host headers in production". For metadata that is correct — a
 * forged host would poison canonical URLs and og:image for everyone. For a redirect it is not: the
 * host the browser used IS the destination we owe it, and a forged host redirects only the forger.
 * It would also resolve to `undefined` when `NEXT_PUBLIC_SITE_URL` and `RAILWAY_PUBLIC_DOMAIN` are
 * both unset, and neither is in `scripts/check-env-parity.mjs`'s expected Railway variables.
 *
 * The header precedence matches `src/lib/api-csrf.ts` `addressedHosts()`, which already treats
 * these as the addressed host because Railway terminates TLS in front of the app.
 *
 * A forged host cannot be cached and replayed at a third party: 307 is not heuristically cacheable
 * (RFC 7231 §6.1), and this route is `force-dynamic`.
 */
export function callerOrigin(request: Request) {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  // No Host at all is the in-process caller, not a browser. Judge by the URL, as this route did
  // before the header was consulted, so the fallback cannot silently become "no origin".
  if (!host) return requestUrl.origin;

  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https" ? `${forwardedProtocol}:` : requestUrl.protocol;

  try {
    return new URL(`${protocol}//${host}`).origin;
  } catch {
    return requestUrl.origin;
  }
}

const NEXT_PROBE_ORIGIN = "https://callback.invalid";

/**
 * Only same-origin paths are honoured, to avoid an open redirect. A plain "starts with one
 * slash" test let `/\evil.example` through: browsers read a backslash as a slash, so it is the
 * protocol-relative `//evil.example`. Backslashes and control characters are refused outright,
 * and what remains is parsed against a placeholder origin, which must survive unchanged.
 */
export function sameOriginNext(rawNext: string | null): string {
  if (!rawNext || !rawNext.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(rawNext)) return "/";
  try {
    const target = new URL(rawNext, NEXT_PROBE_ORIGIN);
    if (target.origin !== NEXT_PROBE_ORIGIN) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}

/**
 * Back to the validated `next` with `auth_error` added, so recovery (and other deep links) can
 * still render their retry UI instead of dumping the user on `/` with a hidden error.
 */
export function authFailureRedirect(next: string, origin: string, reason: string) {
  const target = new URL(next, origin);
  if (target.origin !== new URL(origin).origin) {
    return NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent(reason)}`);
  }
  // Prefer encodeURIComponent (%20) over URLSearchParams (+): AuthProvider and
  // existing callback fixtures decode both, but the prior helper used %20.
  const separator = target.search ? "&" : "?";
  return NextResponse.redirect(
    `${target.origin}${target.pathname}${target.search}${separator}auth_error=${encodeURIComponent(reason)}${target.hash}`,
  );
}

/** Collects the session cookies and anti-cache headers the server client writes, for the final redirect. */
export function createAuthMutationCollector() {
  const authCookies: Parameters<SetAllCookies>[0] = [];
  const authHeaders = new Headers();
  const setAllCookies: SetAllCookies = (cookiesToSet, responseHeaders) => {
    authCookies.push(...cookiesToSet);
    for (const [name, value] of Object.entries(responseHeaders)) authHeaders.set(name, value);
  };
  const withAuthMutations = (response: NextResponse) => {
    for (const { name, value, options } of authCookies) response.cookies.set(name, value, options);
    authHeaders.forEach((value, name) => response.headers.set(name, value));
    return response;
  };
  return { setAllCookies, withAuthMutations };
}

/**
 * Mark recovery-bound sessions so /auth/reset-password can require more than
 * a leftover signed-in session before changing credentials.
 */
export function markPasswordRecovery(response: NextResponse, next: string, origin: string) {
  if (!isPasswordResetPath(next)) return;
  response.cookies.set(PASSWORD_RECOVERY_COOKIE, "1", {
    httpOnly: false,
    maxAge: 15 * 60,
    path: "/",
    sameSite: "lax",
    secure: origin.startsWith("https://"),
  });
}
