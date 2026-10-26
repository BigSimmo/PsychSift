/**
 * Server-side deadline for the Supabase sign-in check (performance audit 2026-10-26, H1).
 *
 * The proxy and server-rendered pages ask Supabase who the reader is before they render.
 * Those calls had no time limit: with Supabase's auth server accepting connections but not
 * answering, every signed-in page waited more than 100 s while signed-out pages loaded in
 * 0.2 s. A per-request fetch timeout alone is not enough, because auth-js retries a failed
 * token refresh with backoff for up to 30 s, and a timeout that answers with an error status
 * instead would make auth-js drop the session and sign the reader out.
 *
 * So the whole check is raced against one deadline. When it expires the caller proceeds as
 * signed out for this one request, the in-flight auth requests are aborted so nothing keeps
 * running in the background, and any cookie write that arrives late is ignored so a stalled
 * refresh can never clear or rotate the reader's session cookies. The reader stays signed in
 * on the browser and the next request tries again.
 */

/** How long a server-side sign-in check may take before the request proceeds as signed out. */
export const SERVER_AUTH_DEADLINE_MS = 4_000;

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

export type ServerAuthDeadline = {
  /** Pass as the Supabase client's `global.fetch`; auth requests abort when the deadline expires. */
  fetch: typeof fetch;
  /** True once the deadline has expired. Cookie writers check this and drop late writes. */
  readonly expired: boolean;
  /**
   * Runs one sign-in check against the deadline. Resolves with the check's own result, or
   * with `fallback` (and `timedOut: true`) when the deadline expires first.
   */
  run<T>(check: () => PromiseLike<T>, fallback: T): Promise<{ value: T; timedOut: boolean }>;
};

export function createServerAuthDeadline(
  timeoutMs: number = SERVER_AUTH_DEADLINE_MS,
  baseFetch: typeof fetch = (input, init) => fetch(input, init),
): ServerAuthDeadline {
  const controller = new AbortController();
  let expired = false;

  const expire = () => {
    expired = true;
    controller.abort(new DOMException("Supabase sign-in check timed out", "TimeoutError"));
  };

  const deadlineFetch: typeof fetch = (input, init) => {
    if (!requestUrl(input).includes("/auth/v1/")) return baseFetch(input, init);
    if (expired) return Promise.reject(controller.signal.reason);
    const existingSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = existingSignal ? AbortSignal.any([existingSignal, controller.signal]) : controller.signal;
    return baseFetch(input, { ...init, signal });
  };

  return {
    fetch: deadlineFetch,
    get expired() {
      return expired;
    },
    run<T>(check: () => PromiseLike<T>, fallback: T) {
      if (expired) return Promise.resolve({ value: fallback, timedOut: true });
      return new Promise<{ value: T; timedOut: boolean }>((resolve, reject) => {
        const timer = setTimeout(() => {
          expire();
          resolve({ value: fallback, timedOut: true });
        }, timeoutMs);
        Promise.resolve()
          .then(check)
          .then(
            (value) => {
              clearTimeout(timer);
              resolve({ value, timedOut: false });
            },
            (error: unknown) => {
              clearTimeout(timer);
              if (expired) resolve({ value: fallback, timedOut: true });
              else reject(error);
            },
          );
      });
    },
  };
}

type AuthLike = {
  getUser?: (...args: never[]) => PromiseLike<unknown>;
  getClaims?: (...args: never[]) => PromiseLike<unknown>;
};

const timedOutAuthError = () => ({ name: "AuthRetryableFetchError", message: "Sign-in check timed out", status: 0 });

/**
 * Bounds a server Supabase client's `auth.getUser()` and `auth.getClaims()` with the deadline,
 * in place, so every server page and helper that checks sign-in gets the limit without each
 * call site changing. A timed-out check resolves the same way a failed one does (no user, an
 * error), and every caller already treats that as signed out.
 */
export function boundServerAuthChecks<C extends object>(client: C, deadline: ServerAuthDeadline): C {
  const auth = (client as { auth?: unknown }).auth as AuthLike | undefined;
  if (!auth || typeof auth !== "object") return client;

  if (typeof auth.getUser === "function") {
    const getUser = auth.getUser.bind(auth) as (...args: unknown[]) => PromiseLike<unknown>;
    (auth as Record<string, unknown>).getUser = async (...args: unknown[]) =>
      (await deadline.run(() => getUser(...args), { data: { user: null }, error: timedOutAuthError() })).value;
  }
  if (typeof auth.getClaims === "function") {
    const getClaims = auth.getClaims.bind(auth) as (...args: unknown[]) => PromiseLike<unknown>;
    (auth as Record<string, unknown>).getClaims = async (...args: unknown[]) =>
      (await deadline.run(() => getClaims(...args), { data: null, error: timedOutAuthError() })).value;
  }
  return client;
}
