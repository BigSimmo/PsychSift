import "server-only";
import { timingSafeEqual } from "node:crypto";

// Shared, constant-time secret gate for inbound machine-to-machine webhooks
// (/api/webhooks/*). Mirrors the byte-length-safe compare used by
// src/lib/deep-probe-auth.ts and supabase/functions/indexing-v3-agent: build the
// UTF-8 buffers first and length-gate before timingSafeEqual, so a crafted
// multi-byte token with the same code-unit count cannot make timingSafeEqual
// throw a RangeError (crafted-header 500). Fails closed on any mismatch.

export function timingSafeSecretEqual(received: string, expected: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const receivedBytes = Buffer.from(received, "utf8");
  if (expectedBytes.length !== receivedBytes.length) return false;
  return timingSafeEqual(expectedBytes, receivedBytes);
}

type PresentedSecretOptions = {
  // Extra header carrying the raw secret (checked before Authorization: Bearer).
  headerName?: string;
  // Allow the secret to travel as a `?token=` query parameter. Only enable for
  // a provider that can configure a target URL but not headers (Railway can send
  // custom headers, so its route keeps this off).
  allowQueryToken?: boolean;
};

export function presentedWebhookSecret(request: Request, options: PresentedSecretOptions = {}): string {
  const headerName = options.headerName ?? "x-webhook-secret";
  const headerSecret = request.headers.get(headerName);
  if (headerSecret) return headerSecret.trim();

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;

  if (options.allowQueryToken) {
    try {
      const token = new URL(request.url).searchParams.get("token");
      if (token) return token.trim();
    } catch {
      // Malformed request URL — treat as no presented secret.
    }
  }
  return "";
}

export type WebhookAuthResult =
  | { ok: true }
  // `misconfigured` = the server has no secret set, so the endpoint must fail
  // closed with 503 (not 401): there is nothing to authenticate against yet.
  | { ok: false; reason: "misconfigured" | "unauthorized" };

export function verifyWebhookSecret(
  request: Request,
  expected: string | undefined,
  options: PresentedSecretOptions = {},
): WebhookAuthResult {
  if (!expected) return { ok: false, reason: "misconfigured" };
  const presented = presentedWebhookSecret(request, options);
  if (!presented) return { ok: false, reason: "unauthorized" };
  return timingSafeSecretEqual(presented, expected) ? { ok: true } : { ok: false, reason: "unauthorized" };
}

/**
 * Strip sensitive token query parameters from a webhook URL for safe logging or error payloads.
 */
export function sanitizeWebhookUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.searchParams.has("token")) {
      url.searchParams.set("token", "[REDACTED]");
    }
    return url.toString();
  } catch {
    return rawUrl.replace(/([?&]token=)[^&]+/gi, "$1[REDACTED]");
  }
}
