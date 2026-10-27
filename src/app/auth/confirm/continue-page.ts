import type { EmailOtpType } from "@supabase/supabase-js";

// The page a GET to /auth/confirm shows instead of spending the link. Mail scanners (Outlook Safe
// Links and others) open every link before the person does; verifying on GET let them use up the
// one-time code, so the real tap then asked for a fresh link. Scanners follow links but do not
// submit forms, so the code is only spent by the POST this page's button sends. Plain HTML, no
// script: it renders under the proxy's CSP (`form-action 'self'`, inline styles allowed).

const TITLES: Record<EmailOtpType, string> = {
  recovery: "Continue to reset your password",
  signup: "Continue to confirm your email",
  email: "Continue to sign in",
  magiclink: "Continue to sign in",
  invite: "Continue to accept your invitation",
  email_change: "Continue to confirm your new email address",
};

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// Referrer policy is `same-origin`, not `no-referrer`: with `no-referrer` browsers send `Origin: null`
// on the form post, which the POST handler's same-origin check would refuse.
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

export function continuePageTitle(type: EmailOtpType): string {
  return TITLES[type];
}

// No app stylesheet loads here, so colours are CSS system colours (light/dark aware) rather than raw
// literals, which the design-system contract forbids outside the token files.
export function continuePage({ tokenHash, type, next }: { tokenHash: string; type: EmailOtpType; next: string }) {
  const title = escapeHtml(continuePageTitle(type));
  const field = (name: string, value: string) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
  const html = `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="same-origin"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;color-scheme:light dark;background:Canvas;color:CanvasText}
main{max-width:26rem;padding:2rem;text-align:center}h1{font-size:1.375rem;margin:0 0 .75rem}p{margin:0 0 1.5rem;line-height:1.5}
button{font:inherit;font-weight:600;padding:.75rem 2rem;border:0;border-radius:.5rem;background:AccentColor;color:AccentColorText;cursor:pointer}
button:focus-visible{outline:3px solid Highlight;outline-offset:2px}</style></head>
<body><main><h1>${title}</h1><p>Press Continue to finish. This extra step stops email security scanners from using up your link.</p>
<form method="post" action="/auth/confirm">${field("token_hash", tokenHash)}${field("type", type)}${field("next", next)}
<button type="submit">Continue</button></form></main></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "same-origin",
    },
  });
}
