// Central definition of the security response headers applied to every route
// (wired into next.config.ts `headers()`). Kept in its own module so the header
// contract can be unit-tested — see tests/security-headers.test.ts.
//
// IMPORTANT — do NOT add `Cross-Origin-Embedder-Policy: require-corp` here.
// Under require-corp the browser blocks every cross-origin subresource that
// lacks a CORP/CORS opt-in. Document page images and the PDF embed are served
// from Supabase Storage signed URLs (*.supabase.co, a different origin), and
// those responses do not send a CORP header — so COEP require-corp makes every
// image preview fail to render ("Image preview failed"). Nothing in the browser
// app relies on cross-origin isolation (no SharedArrayBuffer / crossOriginIsolated
// usage), so COEP is omitted rather than reintroducing that failure mode.

import { expectedSupabaseProject } from "./supabase/project";

export type SecurityHeader = { key: string; value: string };

export type SecurityHeaderFlags = {
  // Next.js dev server: allows `unsafe-eval` in the script-src for React refresh.
  isDevelopment: boolean;
  // Local http runtime (dev or Playwright against http://localhost): skip
  // HTTPS-only hardening (upgrade-insecure-requests, HSTS) that would break http.
  isLocalHttpRuntime: boolean;
};

// Single source of truth for the runtime flags that shape the policy. Both the
// static headers (next.config.ts) and the per-request nonce CSP (src/proxy.ts)
// derive from this, so the HSTS/upgrade-insecure-requests gating stays in lockstep
// with the script-src gating instead of drifting between two hand-copied copies.
export function resolveRuntimeFlags(): SecurityHeaderFlags {
  const isDevelopment = process.env.NODE_ENV === "development";
  return {
    isDevelopment,
    isLocalHttpRuntime: isDevelopment || process.env.PLAYWRIGHT_BASE_URL?.startsWith("http://localhost:") === true,
  };
}

export type ContentSecurityPolicyOptions = SecurityHeaderFlags & {
  // Per-request nonce (base64) generated in src/proxy.ts. script-src allow-lists
  // this nonce instead of 'unsafe-inline', so only scripts carrying it execute.
  nonce: string;
  // Exact Supabase origins the browser may load from; defaults to supabaseBrowserOrigins().
  supabaseOrigins?: readonly string[];
};

// This app's own Supabase origins: the production project plus the staging
// project when SUPABASE_STAGING_PROJECT_REF declares one. These are the same
// hosts next.config.ts remotePatterns allows. The wildcard *.supabase.co would
// also let an injected <img> or fetch reach any other (attacker-owned) project.
export function supabaseBrowserOrigins(
  stagingRef: string | undefined = process.env.SUPABASE_STAGING_PROJECT_REF,
): string[] {
  const refs: string[] = [expectedSupabaseProject.ref];
  const staging = stagingRef?.trim();
  if (staging && /^[a-z0-9]{20}$/.test(staging) && !refs.includes(staging)) refs.push(staging);
  return refs.map((ref) => `https://${ref}.supabase.co`);
}

export function buildContentSecurityPolicy({
  isDevelopment,
  isLocalHttpRuntime,
  nonce,
  supabaseOrigins = supabaseBrowserOrigins(),
}: ContentSecurityPolicyOptions): string {
  // Production: nonce + 'strict-dynamic' is the modern strict-CSP shape. CSP3
  // browsers ignore host allow-lists AND 'unsafe-inline' for scripts, running
  // only the nonce'd bootstrap (and scripts it loads). Next.js reads the nonce
  // from the request CSP header and stamps its own framework/bundle/flight
  // scripts automatically; the one hand-authored inline script (theme-flash guard
  // in app/layout.tsx) carries the nonce explicitly via the `x-nonce` header.
  //
  // Development: keep 'unsafe-inline' + 'unsafe-eval' and NO 'strict-dynamic'.
  // The Turbopack dev server injects HMR/runtime and route-chunk <script src>
  // tags that are not nonce-tagged; 'strict-dynamic' would disable the 'self'
  // allow-list and block every one of them (blank page + broken interactions).
  // Dev is not the shipped security boundary, so it retains the pre-migration
  // policy. style-src keeps 'unsafe-inline' in both (Next's font + inline styles
  // are not nonce-tagged); only production script-src is nonce-gated.
  const scriptSrc = isDevelopment
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; `;
  const upgradeInsecureRequests = isLocalHttpRuntime ? "" : "upgrade-insecure-requests; ";
  const supabase = supabaseOrigins.join(" ");

  return (
    "default-src 'self'; " +
    "base-uri 'self'; " +
    "object-src 'none'; " +
    "frame-ancestors 'none'; " +
    "form-action 'self'; " +
    upgradeInsecureRequests +
    // img-src/media-src are scoped to this app's Supabase Storage origin that serves
    // the signed-URL images (document pages) — the app loads no other cross-origin
    // media, so a bare `https:` (or any other Supabase project) would needlessly
    // widen the exfil surface. connect-src must include that origin for the
    // signed-URL/API fetches. OpenAI calls are server-side only, so the browser gets
    // no provider origin (2026-07-13 audit).
    `img-src 'self' data: blob: ${supabase}; ` +
    `media-src 'self' ${supabase}; ` +
    // No Sentry ingest origin: error tracking is server/edge only
    // (src/sentry.{server,edge}.config.ts) and docs/error-tracking.md forbids a
    // browser SDK, so the three wildcard `*.ingest*.sentry.io` origins allowed an
    // egress channel from the clinical origin that nothing used (2026-09-02 audit,
    // L34). Re-add them only together with a browser SDK and its privacy review.
    `connect-src 'self' ${supabase}; ` +
    "worker-src 'self'; " +
    "manifest-src 'self'; " +
    scriptSrc +
    "style-src 'self' 'unsafe-inline'"
  );
}

// Fallback policy for the image-suffixed paths src/proxy.ts's matcher skips
// (wired into next.config.ts `headers()`). Those paths are meant to be static
// images, but a dynamic page route given such a segment (e.g. /documents/x.png)
// still renders HTML; without this it would ship with no CSP at all. It has no
// nonce, so no script runs there, while images (and inline-styled SVG) still load.
export function buildStaticAssetContentSecurityPolicy(): string {
  return (
    "default-src 'none'; " +
    "img-src 'self' data:; " +
    "style-src 'unsafe-inline'; " +
    "base-uri 'none'; " +
    "form-action 'none'; " +
    "frame-ancestors 'none'"
  );
}

// Static security headers applied to every route via next.config.ts. NOTE:
// Content-Security-Policy is intentionally NOT here — it carries a per-request
// nonce and is emitted from src/proxy.ts (see buildContentSecurityPolicy).
export function buildSecurityHeaders(flags: SecurityHeaderFlags): SecurityHeader[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    // Origin only, even within the site: a full page address can carry search text in ?q=,
    // which strict-origin-when-cross-origin would send on every same-site request (privacy audit CA-06).
    { key: "Referrer-Policy", value: "strict-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-site" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    // No Cross-Origin-Embedder-Policy — see module header note.
    // Microphone stays denied while Clinical Ask dictation has no user entry point
    // (PR #2360 removed the composer controls; CLINICAL_ASK_ENABLED defaults to
    // false). Re-grant `(self)` only together with a governed dictation surface.
    // Camera is granted to this origin only: the in-app QR check-in scanner
    // (#ZTDZ4Z) reads a session code with video-only getUserMedia, and `camera=()`
    // made the browser refuse it without ever asking the user.
    { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
    { key: "Origin-Agent-Cluster", value: "?1" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    ...(flags.isLocalHttpRuntime
      ? []
      : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
  ];
}
