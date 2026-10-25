import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// The Supabase browser library (about 70 KB gzip with auth, storage, realtime and
// postgrest) lives in this module so AuthProvider can load it after first paint
// instead of every page parsing it before it can draw. See src/lib/supabase/client.tsx.

let cached: { configKey: string; client: SupabaseClient } | null = null;

/** Deadline for one request to the auth server (sign-in, sign-out, session check, token refresh). */
const AUTH_REQUEST_TIMEOUT_MS = 15_000;

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/**
 * Gives each auth-server request a deadline. A connection that stalls without failing would
 * otherwise hold `auth.signOut()` open forever, and with it the local session removal and the
 * device-data wipe that follow; with the deadline the request fails, auth-js drops the local
 * session as it does for any network failure, and sign-out finishes. Only auth requests are
 * capped: document uploads and data queries keep the browser's own timing. Browsers without
 * `AbortSignal.timeout` (or `AbortSignal.any`, when the caller passes its own signal) keep the
 * uncapped request rather than failing it.
 */
export function withAuthRequestTimeout(
  baseFetch: typeof fetch = (input, init) => fetch(input, init),
  timeoutMs: number = AUTH_REQUEST_TIMEOUT_MS,
): typeof fetch {
  return (input, init) => {
    if (!requestUrl(input).includes("/auth/v1/") || typeof AbortSignal.timeout !== "function") {
      return baseFetch(input, init);
    }
    const existingSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (existingSignal && typeof AbortSignal.any !== "function") return baseFetch(input, init);
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = existingSignal ? AbortSignal.any([existingSignal, timeoutSignal]) : timeoutSignal;
    return baseFetch(input, { ...init, signal });
  };
}

export function browserSupabaseClientFor(url: string, publishableKey: string): SupabaseClient {
  const configKey = `${url}:${publishableKey}`;
  if (cached?.configKey === configKey) return cached.client;
  // @supabase/ssr browser client persists the session in cookies shared with the
  // server (proxy + route handlers), so logins survive refreshes and the API can
  // read the session. PKCE code flow returns via /auth/callback.
  const client = createBrowserClient(url, publishableKey, { global: { fetch: withAuthRequestTimeout() } });
  cached = { configKey, client };
  return client;
}
