import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { PublicApiError, jsonError } from "@/lib/http";
import { isAdministratorAppMetadata } from "@/lib/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyProxyAuthHeader } from "@/lib/supabase/proxy-auth-crypto";

type AdminClient = ReturnType<typeof createAdminClient>;

export type AuthenticatedUser = {
  id: string;
  appMetadata: Record<string, unknown>;
};

export type OptionalAuthenticationResult =
  { status: "absent" } | { status: "valid"; user: AuthenticatedUser } | { status: "invalid" };

type AuthenticationRequirement = {
  administrator?: boolean;
};

export type AuthenticatedUserContext = {
  user: AuthenticatedUser;
  publicationClient: PublicationClient;
};

type PublicationClient = {
  auth: {
    getUser: () => PromiseLike<{
      data: { user: { id: string; app_metadata?: Record<string, unknown>; banned_until?: string | null } | null };
      error: unknown;
    }>;
  };
  rpc: unknown;
};

function readCookies(cookieHeader: string | null): Map<string, string> {
  if (!cookieHeader) return new Map<string, string>();

  const cookies = new Map<string, string>();
  for (const rawPart of cookieHeader.split(";")) {
    const trimmed = rawPart.trim();
    const firstEq = trimmed.indexOf("=");
    if (firstEq <= 0) continue;

    const name = trimmed.slice(0, firstEq).trim();
    const encodedValue = trimmed.slice(firstEq + 1).trim();
    if (!name) continue;

    try {
      cookies.set(name, decodeURIComponent(encodedValue));
    } catch {
      cookies.set(name, encodedValue);
    }
  }
  return cookies;
}

function extractBearerAccessToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const headerToken = match?.[1]?.trim();
  return headerToken || null;
}

function configuredSupabaseProjectRef(): string | null {
  if (env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      const hostname = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.toLowerCase();
      const match = hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
      if (match?.[1]) return match[1];
    } catch {
      // Invalid public URLs are rejected by env parsing; retain the explicit-ref fallback for tests and local tooling.
    }
  }

  const explicitRef = env.SUPABASE_PROJECT_REF?.trim().toLowerCase();
  return explicitRef && /^[a-z0-9]+$/.test(explicitRef) ? explicitRef : null;
}

function configuredSessionCookieName(): string | null {
  const projectRef = configuredSupabaseProjectRef();
  return projectRef ? `sb-${projectRef}-auth-token` : null;
}

function extractCurrentCookieSessionAccessToken(request: Request): string | null {
  const cookies = readCookies(request.headers.get("cookie"));
  const cookieName = configuredSessionCookieName();
  const value = cookieName ? cookies.get(cookieName) : undefined;
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    const accessToken = typeof parsed?.access_token === "string" ? parsed.access_token.trim() : "";
    if (accessToken) return accessToken;
  } catch {
    // The current SSR format can be base64-encoded; the server client validates it below.
  }

  return null;
}

function extractLegacyCookieSessionAccessToken(request: Request): string | null {
  return readCookies(request.headers.get("cookie")).get("sb-access-token")?.trim() || null;
}

/** Blank or whitespace-only cookie values are leftovers, not presented credentials. */
function cookieValueIsPresented(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function hasCurrentSessionCookie(request: Request): boolean {
  const cookies = readCookies(request.headers.get("cookie"));
  const cookieName = configuredSessionCookieName();
  if (!cookieName) {
    // Without a configured project, a presented Supabase session cannot be validated and must fail closed.
    return [...cookies.entries()].some(
      ([name, value]) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name) && cookieValueIsPresented(value),
    );
  }
  return [...cookies.entries()].some(
    ([name, value]) =>
      cookieValueIsPresented(value) &&
      (name === cookieName || (name.startsWith(`${cookieName}.`) && /^\d+$/.test(name.slice(cookieName.length + 1)))),
  );
}

function hasLegacySessionCookie(request: Request): boolean {
  return cookieValueIsPresented(readCookies(request.headers.get("cookie")).get("sb-access-token"));
}

function extractSessionAccessToken(request: Request): string | null {
  return (
    extractBearerAccessToken(request) ??
    extractCurrentCookieSessionAccessToken(request) ??
    extractLegacyCookieSessionAccessToken(request)
  );
}

/**
 * A blocked account still holds a valid access token until it expires, so a live lookup that
 * finds the account banned refuses it rather than trusting the token (PP-04, 26 Oct 2026).
 */
function isBannedNow(user: { banned_until?: string | null }, now = Date.now()): boolean {
  if (!user.banned_until) return false;
  const until = Date.parse(user.banned_until);
  // An unreadable ban date still means the account was blocked, so it fails closed.
  return Number.isNaN(until) || until > now;
}

async function getUserFromAccessToken(supabase: AdminClient, token: string): Promise<AuthenticatedUser | null> {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.id || isBannedNow(data.user)) return null;
  return { id: data.user.id, appMetadata: data.user.app_metadata ?? {} };
}

export class AuthenticationError extends PublicApiError {
  constructor(message = "Authentication required.") {
    super(message, 401, { code: "authentication_required" });
    this.name = "AuthenticationError";
  }
}

export function unauthorizedResponse(error?: AuthenticationError) {
  void error;
  // Route through the shared error envelope so 401s carry a stable `code`/`message`
  // like every other API failure (and inherit its `Cache-Control: private, no-store`).
  // `log: false` keeps a routine unauthenticated request from being recorded as a
  // server-side error.
  return jsonError(new AuthenticationError(), 401, { log: false });
}

/**
 * Resolve the user from the `@supabase/ssr` cookie session. The
 * `sb-<ref>-auth-token` cookie it writes is base64-encoded (and chunked when
 * large), which `extractCurrentCookieSessionAccessToken`'s plain-JSON parser cannot read, so
 * this uses the ssr server client to decode + validate it. Returns null when
 * the public env is absent or no `sb-` cookie is present.
 */
async function getUserFromRequestCookies(request: Request): Promise<AuthenticatedUser | null> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const cookieHeader = request.headers.get("cookie");
  if (!url || !key || !cookieHeader || !cookieHeader.includes("sb-")) {
    return null;
  }

  const client = createServerClient(url, key, {
    cookies: {
      getAll() {
        return parseCookieHeader(cookieHeader).map(({ name, value }) => ({ name, value: value ?? "" }));
      },
      setAll() {
        // Read-only during the route-handler auth check; the proxy refreshes cookies.
      },
    },
  });

  const { data, error } = await client.auth.getUser();
  if (error || !data.user?.id || isBannedNow(data.user)) {
    return null;
  }
  return { id: data.user.id, appMetadata: data.user.app_metadata ?? {} };
}

function publicationClientFromBearerToken(bearerToken: string) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new AuthenticationError("Authentication is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${bearerToken}` } },
  });
}

function publicationClientFromCookies(request: Request) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const cookieHeader = request.headers.get("cookie");
  if (!url || !key || !cookieHeader) throw new AuthenticationError("Authentication is not configured.");
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return parseCookieHeader(cookieHeader).map(({ name, value }) => ({ name, value: value ?? "" }));
      },
      setAll() {
        // Route-handler publication commands never refresh browser cookies.
      },
    },
  });
}

export const PROXY_AUTH_USER_HEADER = "x-proxy-auth-user";

export function extractProxyAuthenticatedUser(request: Request): AuthenticatedUser | null {
  const raw = request.headers.get(PROXY_AUTH_USER_HEADER);
  if (!raw) return null;
  try {
    const verifiedPayload = verifyProxyAuthHeader(raw);
    if (!verifiedPayload) return null;
    const json = Buffer.from(verifiedPayload, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.id === "string" &&
      parsed.id &&
      typeof parsed.appMetadata === "object" &&
      parsed.appMetadata !== null
    ) {
      return { id: parsed.id, appMetadata: parsed.appMetadata as Record<string, unknown> };
    }
  } catch {
    // Malformed header or invalid signature, ignore
  }
  return null;
}

export async function resolveOptionalAuthentication(
  request: Request,
  supabase: AdminClient,
): Promise<OptionalAuthenticationResult> {
  if (request.headers.has("authorization")) {
    const bearerToken = extractBearerAccessToken(request);
    if (!bearerToken) return { status: "invalid" };

    const bearerUser = await getUserFromAccessToken(supabase, bearerToken);
    return bearerUser ? { status: "valid", user: bearerUser } : { status: "invalid" };
  }

  // Fast path: Forwarded verified claims from Next.js proxy
  const proxyUser = extractProxyAuthenticatedUser(request);
  if (proxyUser) {
    return { status: "valid", user: proxyUser };
  }

  const currentCookieToken = extractCurrentCookieSessionAccessToken(request);
  if (currentCookieToken) {
    const currentCookieUser = await getUserFromAccessToken(supabase, currentCookieToken);
    return currentCookieUser ? { status: "valid", user: currentCookieUser } : { status: "invalid" };
  }

  if (hasCurrentSessionCookie(request)) {
    const currentCookieUser = await getUserFromRequestCookies(request);
    return currentCookieUser ? { status: "valid", user: currentCookieUser } : { status: "invalid" };
  }

  const legacyCookieToken = extractLegacyCookieSessionAccessToken(request);
  if (legacyCookieToken) {
    const legacyCookieUser = await getUserFromAccessToken(supabase, legacyCookieToken);
    return legacyCookieUser ? { status: "valid", user: legacyCookieUser } : { status: "invalid" };
  }

  return hasLegacySessionCookie(request) ? { status: "invalid" } : { status: "absent" };
}

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isStateChangingRequest(request: Request): boolean {
  return !READ_ONLY_METHODS.has(request.method.toUpperCase());
}

/** Mirrors the order in `resolveOptionalAuthentication`: a bearer header is checked live already. */
function usedProxyClaims(request: Request): boolean {
  return !request.headers.has("authorization") && extractProxyAuthenticatedUser(request) !== null;
}

export async function requireAuthenticatedUser(
  request: Request,
  supabase: AdminClient,
  requirement: AuthenticationRequirement = {},
): Promise<AuthenticatedUser> {
  const authentication = await resolveOptionalAuthentication(request, supabase);
  if (authentication.status !== "valid") {
    throw new AuthenticationError(
      authentication.status === "invalid" ? "Invalid authentication credentials." : undefined,
    );
  }
  let { user } = authentication;
  if (requirement.administrator || (isStateChangingRequest(request) && usedProxyClaims(request))) {
    // Administrator routes never trust proxy-forwarded claims. A missing live
    // Auth user fails closed (401) instead of keeping a signed header. Saves and
    // deletes recheck the same way: the proxy verifies the access token locally,
    // so a signed-out or blocked session would otherwise keep writing until the
    // token expires, up to an hour later (PP-04, 26 Oct 2026).
    const token = extractSessionAccessToken(request);
    const freshUser =
      (token ? await getUserFromAccessToken(supabase, token) : null) ?? (await getUserFromRequestCookies(request));
    if (!freshUser) {
      throw new AuthenticationError();
    }
    user = freshUser;
  }
  if (requirement.administrator && !isAdministratorAppMetadata(user.appMetadata)) {
    throw new PublicApiError("Administrator access required.", 403, { code: "administrator_required" });
  }
  return user;
}

/**
 * Resolve an authenticated user together with the exact request-scoped client
 * whose JWT/cookies populate auth.uid() inside publication RPCs. The service
 * client may validate a presented token, but is never returned as mutation
 * authority. A presented invalid Authorization header cannot fall back to a
 * cookie session.
 */
export async function requireAuthenticatedUserContext(
  request: Request,
  supabase: AdminClient,
  requirement: AuthenticationRequirement = {},
): Promise<AuthenticatedUserContext> {
  let user: AuthenticatedUser | null = null;
  let publicationClient: PublicationClient;

  if (request.headers.has("authorization")) {
    const bearerToken = extractBearerAccessToken(request);
    if (!bearerToken) throw new AuthenticationError("Invalid authentication credentials.");
    user = await getUserFromAccessToken(supabase, bearerToken);
    if (!user) throw new AuthenticationError("Invalid authentication credentials.");
    publicationClient = publicationClientFromBearerToken(bearerToken);
  } else {
    const legacyCookieToken = extractLegacyCookieSessionAccessToken(request);
    if (hasCurrentSessionCookie(request)) {
      publicationClient = publicationClientFromCookies(request);
      const result = await publicationClient.auth.getUser();
      if (result.error || !result.data.user?.id || isBannedNow(result.data.user)) {
        throw new AuthenticationError("Invalid authentication credentials.");
      }
      user = { id: result.data.user.id, appMetadata: result.data.user.app_metadata ?? {} };
    } else if (legacyCookieToken) {
      user = await getUserFromAccessToken(supabase, legacyCookieToken);
      if (!user) throw new AuthenticationError("Invalid authentication credentials.");
      publicationClient = publicationClientFromBearerToken(legacyCookieToken);
    } else {
      throw new AuthenticationError();
    }
  }

  if (requirement.administrator && !isAdministratorAppMetadata(user.appMetadata)) {
    throw new PublicApiError("Administrator access required.", 403, { code: "administrator_required" });
  }
  return { user, publicationClient };
}

export async function getOptionalAuthenticatedUser(
  request: Request,
  supabase: AdminClient,
): Promise<AuthenticatedUser | null> {
  const authentication = await resolveOptionalAuthentication(request, supabase);
  if (authentication.status === "invalid") {
    throw new AuthenticationError("Invalid authentication credentials.");
  }
  return authentication.status === "valid" ? authentication.user : null;
}

// Retained for callers that only need a single token string.
export { extractSessionAccessToken };
