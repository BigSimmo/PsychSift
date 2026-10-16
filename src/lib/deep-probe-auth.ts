import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

// Shared operator gate for internal health/status detail. A caller proves it is an operator
// (not an anonymous internet client) by presenting HEALTH_DEEP_PROBE_SECRET via the
// `x-health-deep-token` header. Used by /api/health (deep Supabase probe) and
// /api/setup-status (detailed setup checks) so both surfaces gate internal error text and
// project posture behind the same secret. Constant-time compare; fails closed when the secret
// is unset or the token length/value differs.
function constantTimeTokenEquals(expectedSecret: string, receivedToken: string): boolean {
  const expected = Buffer.from(expectedSecret, "utf8");
  const received = Buffer.from(receivedToken, "utf8");
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

export function allowDeepHealthProbe(request: Request, environment?: Record<string, string | undefined>): boolean {
  const secret = environment ? environment.HEALTH_DEEP_PROBE_SECRET : env.HEALTH_DEEP_PROBE_SECRET;
  if (!secret) return false;
  const token = request.headers.get("x-health-deep-token");
  if (!token) return false;
  // Compare UTF-8 BYTE lengths, not JS string (UTF-16 code-unit) lengths: a crafted multi-byte
  // token with the same code-unit count but a different byte count would otherwise pass a
  // `token.length === secret.length` check and make timingSafeEqual throw on mismatched buffers
  // (an unhandled RangeError → crafted-header 500). Build the buffers first, then length-gate.
  if (constantTimeTokenEquals(secret, token)) return true;

  const previousSecret = (
    environment
      ? environment.HEALTH_DEEP_PROBE_SECRET_PREVIOUS
      : ((env as unknown as Record<string, string | undefined>).HEALTH_DEEP_PROBE_SECRET_PREVIOUS ??
        process.env.HEALTH_DEEP_PROBE_SECRET_PREVIOUS)
  )?.trim();
  if (!previousSecret) return false;
  return constantTimeTokenEquals(previousSecret, token);
}
