import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

// Shared operator gate for internal health/status detail. A caller proves it is an operator
// (not an anonymous internet client) by presenting HEALTH_DEEP_PROBE_SECRET via the
// `x-health-deep-token` header. Used by /api/health (deep Supabase probe) and
// /api/setup-status (detailed setup checks) so both surfaces gate internal error text and
// project posture behind the same secret. Constant-time compare; fails closed when the secret
// is unset or the token differs.
function constantTimeTokenEquals(expectedSecret: string, receivedToken: string): boolean {
  // Hash both inputs to a fixed 32-byte digest first, so the comparison never branches on the
  // length of either value and cannot throw on mismatched buffer sizes.
  const expected = createHash("sha256").update(expectedSecret, "utf8").digest();
  const received = createHash("sha256").update(receivedToken, "utf8").digest();
  return timingSafeEqual(expected, received);
}

export function allowDeepHealthProbe(
  request: Request,
  environment: Record<string, string | undefined> = process.env,
): boolean {
  const secret = environment.HEALTH_DEEP_PROBE_SECRET ?? env.HEALTH_DEEP_PROBE_SECRET;
  if (!secret) return false;
  const token = request.headers.get("x-health-deep-token");
  if (!token) return false;
  if (constantTimeTokenEquals(secret, token)) return true;

  const previousSecret = (
    environment.HEALTH_DEEP_PROBE_SECRET_PREVIOUS ??
    (env as unknown as Record<string, string | undefined>).HEALTH_DEEP_PROBE_SECRET_PREVIOUS
  )?.trim();
  if (!previousSecret) return false;
  return constantTimeTokenEquals(previousSecret, token);
}
