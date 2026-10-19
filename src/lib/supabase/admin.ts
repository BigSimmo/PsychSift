import { createClient } from "@supabase/supabase-js";
import { requireServerEnv } from "@/lib/env";
import { instrumentSupabaseClientForTracing } from "@/lib/observability/supabase-tracing";
import type { Database } from "./database.types";

// Cache the admin client as module-level singletons so that every API request
// reuses the same instance (and its underlying HTTP agent) rather than allocating
// a fresh one on every call. Mirrors the openAIClient singleton in openai.ts.
// The service-role client carries no user-specific session state, so sharing it
// across requests is safe. Clients bound to a request AbortSignal are never cached.
export const DEFAULT_SUPABASE_ADMIN_TIMEOUT_MS = 30_000;

export type CreateAdminClientOptions = {
  /**
   * Request timeout in milliseconds.
   * Defaults to 30,000 ms. Pass null, 0, or false to disable deadline (e.g. for worker batch jobs).
   */
  timeoutMs?: number | null | false;
  /**
   * Force allocation of a new instance instead of returning the shared singleton.
   */
  fresh?: boolean;
  /** Bind this client to one request. Signal-bound clients are never cached. */
  signal?: AbortSignal;
};

let defaultAdminClient: ReturnType<typeof createClient<Database>> | null = null;
let unboundedAdminClient: ReturnType<typeof createClient<Database>> | null = null;

export function createTimeoutFetch(
  timeoutMs: number | null | false | undefined,
  baseFetch: typeof fetch = fetch,
  requestSignal?: AbortSignal,
): typeof fetch {
  if (
    timeoutMs === null ||
    timeoutMs === false ||
    timeoutMs === 0 ||
    (typeof timeoutMs === "number" && (!Number.isFinite(timeoutMs) || timeoutMs < 0))
  ) {
    if (!requestSignal) return baseFetch;
    return (input, init) => {
      const existingSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      const signal = existingSignal ? AbortSignal.any([existingSignal, requestSignal]) : requestSignal;
      return baseFetch(input, { ...init, signal });
    };
  }
  const effectiveTimeout = timeoutMs ?? DEFAULT_SUPABASE_ADMIN_TIMEOUT_MS;
  return (input, init) => {
    const timeoutSignal = AbortSignal.timeout(effectiveTimeout);
    const existingSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = AbortSignal.any([
      timeoutSignal,
      ...(existingSignal ? [existingSignal] : []),
      ...(requestSignal ? [requestSignal] : []),
    ]);
    return baseFetch(input, { ...init, signal });
  };
}

export function resetAdminClientForTesting(): void {
  defaultAdminClient = null;
  unboundedAdminClient = null;
}

export function createAdminClient(options?: CreateAdminClientOptions) {
  const timeoutMs = options?.timeoutMs;
  const isDefaultTimeout = timeoutMs === undefined || timeoutMs === DEFAULT_SUPABASE_ADMIN_TIMEOUT_MS;
  const isUnbounded = timeoutMs === null || timeoutMs === false || timeoutMs === 0;

  if (!options?.fresh && !options?.signal) {
    if (isDefaultTimeout && defaultAdminClient) return defaultAdminClient;
    if (isUnbounded && unboundedAdminClient) return unboundedAdminClient;
  }

  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = requireServerEnv();
  const effectiveTimeout = isUnbounded ? undefined : (timeoutMs ?? DEFAULT_SUPABASE_ADMIN_TIMEOUT_MS);

  const client = createClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    ...(effectiveTimeout !== undefined
      ? {
          db: {
            timeout: effectiveTimeout,
          },
        }
      : {}),
    global: {
      fetch: createTimeoutFetch(timeoutMs, fetch, options?.signal),
    },
  });

  // Constructor-level DB instrumentation (shared with SSR clients) plus admin auth spans.
  // No-op when DSN is unset or SENTRY_TRACES_SAMPLE_RATE=0; never attaches filters/bodies.
  instrumentSupabaseClientForTracing(client);

  if (!options?.fresh && !options?.signal) {
    if (isDefaultTimeout) defaultAdminClient = client;
    else if (isUnbounded) unboundedAdminClient = client;
  }

  return client;
}
