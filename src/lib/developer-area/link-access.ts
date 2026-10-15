// Explicit, not incidental. This module is self-guarding today only because
// `node:crypto` fails to bundle for the browser — and it now re-exports the
// client-safe helpers from `link-access-shared.ts`, which makes it an inviting
// import target for a future Client Component. Make the boundary a stated rule
// rather than a side effect of what it happens to import.
import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Passwordless, link-based access to the developer-gated `/mockups` subtrees.
 *
 * The owner asked for a Developer Section that does not ask him to sign in, and
 * the two obvious answers were both wrong. Deleting `DeveloperAreaGate` would
 * publish the task ledger, the hazard notes, and the Care Plan prototype to
 * anyone who visits `psychiatry.tools` — that is exactly #L30, reintroduced
 * deliberately. Keeping only the Supabase sign-in
 * leaves the magic-link round trip he asked to be rid of.
 *
 * So this is a third credential, alongside the administrator claim and never
 * replacing it: a secret carried in the URL once, exchanged by `src/proxy.ts`
 * for a long-lived signed cookie, after which the subtree opens with no
 * interaction at all on that device.
 *
 * **The cookie is not the key.** It carries an HMAC-SHA256 signature over its
 * own issue time, keyed by `DEVELOPER_AREA_ACCESS_KEY`, so a stolen cookie
 * cannot be turned back into the key, and rotating the key in Railway revokes
 * every device at once — the only revocation this design has, which is why it
 * is written down here rather than left to be rediscovered.
 *
 * **It fails closed in every unset or under-strength case.** No key configured,
 * a key below `MIN_DEVELOPER_ACCESS_KEY_LENGTH`, a malformed token, a token
 * signed under a different key: all resolve to "not granted", and the visitor
 * gets the ordinary sign-in screen. A short key is rejected rather than
 * accepted-with-a-warning because this secret travels in a URL, where it is
 * visible in a browser's history and in any screen share.
 */

/** Cookie the proxy issues once the URL secret verifies. */
export const DEVELOPER_ACCESS_COOKIE = "psychsift_developer_access";

/**
 * Re-exported, not re-declared. The query-parameter name and the URL shape live
 * in `link-access-shared.ts` because the gate screen's key field is a Client
 * Component and this file imports `node:crypto`; see that file for why the split
 * exists at all. Callers already importing them from here keep working.
 */
export {
  DEVELOPER_ACCESS_ERROR_PARAM,
  DEVELOPER_ACCESS_QUERY_PARAM,
  developerKeyUnlockUrl,
  parseDeveloperGateTarget,
} from "@/lib/developer-area/link-access-shared";

/**
 * Cookie paths. Each cookie is scoped to one developer-gated subtree so the
 * credential is not sent with unrelated clinical or API requests.
 */
export const DEVELOPER_ACCESS_COOKIE_PATHS = [
  "/admin/developer-hub",
  "/mockups/development",
  "/mockups/care-plan",
] as const;

/**
 * One year. Deliberately inside the ~400-day ceiling Chrome and Safari clamp
 * `Set-Cookie` lifetimes to, so the stated expiry is the real one rather than a
 * ten-year value the browser silently truncates. `src/proxy.ts` re-issues the
 * cookie on every verified request, so a device used at least once a year never
 * sees the sign-in screen again — which is the whole point of the feature.
 */
export const DEVELOPER_ACCESS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Minimum accepted key length. The setup docs generate a 64-character
 * URL-safe hexadecimal value with `openssl rand -hex 32`; anything shorter is
 * treated as unconfigured.
 */
export const MIN_DEVELOPER_ACCESS_KEY_LENGTH = 32;

/** Version tag inside the token, so a future format change is distinguishable rather than ambiguous. */
const TOKEN_VERSION = "v1";

/**
 * The configured secret, or null when the feature is off.
 *
 * Injectable rather than reading `process.env` at module scope so the guard can
 * be tested without a live environment, matching `developerGateBypassAllowed`.
 */
export function resolveDeveloperAccessKey(
  environment: Record<string, string | undefined> = process.env,
): string | null {
  const trimmed = environment.DEVELOPER_AREA_ACCESS_KEY?.trim();
  if (!trimmed || trimmed.length < MIN_DEVELOPER_ACCESS_KEY_LENGTH) return null;
  return trimmed;
}

/** The exact bytes the signature covers: version and issue time together, so neither can move. */
function signedMessage(issuedAtSeconds: number) {
  return `${TOKEN_VERSION}.${issuedAtSeconds}`;
}

/**
 * Mints the cookie value for a verified visitor.
 * Format: `v1.<issuedAtSeconds>.<base64urlSignature>`.
 * Returns null when no key is configured (fail closed — never an unsigned token).
 */
export function issueDeveloperAccessToken(
  environment: Record<string, string | undefined> = process.env,
  nowMs: number = Date.now(),
): string | null {
  const key = resolveDeveloperAccessKey(environment);
  if (!key) return null;
  const issuedAtSeconds = Math.floor(nowMs / 1000);
  const signature = createHmac("sha256", key).update(signedMessage(issuedAtSeconds)).digest("base64url");
  return `${TOKEN_VERSION}.${issuedAtSeconds}.${signature}`;
}

/** Constant-time equality; never let comparison timing reveal how much of a forgery was right. */
function signatureMatches(provided: string, expected: string): boolean {
  try {
    const a = Buffer.from(provided, "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Whether a cookie value is a token this deployment issued and still honours.
 *
 * A token older than `DEVELOPER_ACCESS_COOKIE_MAX_AGE_SECONDS` is rejected even
 * if the browser kept sending it: the expiry must be enforced by the server that
 * minted it, not left to the client that stores it.
 */
export function developerAccessTokenValid(
  token: string | undefined | null,
  environment: Record<string, string | undefined> = process.env,
  nowMs: number = Date.now(),
): boolean {
  const key = resolveDeveloperAccessKey(environment);
  if (!key || !token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, issuedAtRaw, signature] = parts;
  if (version !== TOKEN_VERSION || !issuedAtRaw || !signature) return false;
  if (!/^\d+$/.test(issuedAtRaw)) return false;

  const issuedAtSeconds = Number(issuedAtRaw);
  if (!Number.isSafeInteger(issuedAtSeconds)) return false;

  const ageSeconds = Math.floor(nowMs / 1000) - issuedAtSeconds;
  if (ageSeconds > DEVELOPER_ACCESS_COOKIE_MAX_AGE_SECONDS) return false;
  // A token stamped in the future is a clock skew or a forgery attempt; a small
  // tolerance covers the former without accepting an indefinitely post-dated one.
  if (ageSeconds < -300) return false;

  const expected = createHmac("sha256", key).update(signedMessage(issuedAtSeconds)).digest("base64url");
  return signatureMatches(signature, expected);
}

/** Whether a secret presented in a URL is the configured key. Constant-time, and false when unset. */
export function developerAccessKeyMatches(
  presented: string | undefined | null,
  environment: Record<string, string | undefined> = process.env,
): boolean {
  const key = resolveDeveloperAccessKey(environment);
  if (!key || !presented) return false;
  return signatureMatches(presented, key);
}
